import {
  DurableWorker,
  getDMQueue,
  FACEBOOK_COMMENT_JOB_NAME,
  FACEBOOK_MESSAGE_JOB_NAME,
  INBOUND_DM_JOB_NAME,
  POSTBACK_JOB_NAME,
  type DmQueueJob,
  type ProcessCommentJob,
  type ProcessInboundDmJob,
  type ProcessPostbackJob,
  type ProcessFacebookCommentJob,
  type ProcessFacebookMessageJob,
  type QueueJob,
} from "./client";
import {
  processFacebookComment,
  processFacebookMessage,
} from "@/lib/queue/facebook-worker";
import { prisma } from "@/lib/db/client";
import {
  MetaApiError,
  sendCommentReply,
  sendDirectMessage,
  sendDirectMessageWithLinkButton,
  sendPrivateReply,
  sendPrivateReplyWithButton,
  sendPrivateReplyWithLinkButton,
} from "@/lib/meta/client";
import { decryptToken } from "@/lib/meta/oauth";
import { matchKeywords } from "@/lib/utils/keyword-matcher";
import { reserveDMSlot } from "@/lib/utils/rate-limiter";
import {
  releaseWorkspaceDMReservation,
  reserveWorkspaceDMSend,
} from "@/lib/billing/usage";
import { recordWorkerAlert } from "@/lib/ops/worker-health";
import {
  buildTrackedUrl,
  renderMessageWithTracking,
  renderMessageWithoutLink,
} from "@/lib/tracking/message";
import { asStringArray } from "@/lib/utils/string-list";
import { DEFAULT_PUBLIC_REPLY_MESSAGE } from "@/lib/constants";

const BACKOFF_DELAYS = [5 * 60 * 1000, 15 * 60 * 1000, 45 * 60 * 1000];

function formatError(error: unknown): string {
  if (error instanceof MetaApiError) {
    // Include the subcode and fbtrace_id: for generic errors (e.g. code 1,
    // "An unknown error has occurred") the subcode is what disambiguates the
    // real cause, and the trace id is what Meta support needs to look it up.
    const code =
      error.subcode !== undefined
        ? `${error.code}/${error.subcode}`
        : `${error.code}`;
    const trace = error.fbTraceId ? ` [trace ${error.fbTraceId}]` : "";
    return `Meta API Error ${code}: ${error.message}${trace}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Unknown error";
}

// Meta occasionally returns a temporary platform error while rendering an
// otherwise-valid button template. Retrying preserves the intended CTA; an
// immediate inline-link fallback makes a transient outage permanently degrade
// the user's message. On the final durable-queue attempt we still fall back so the
// recipient gets the promised link instead of nothing.
const TRANSIENT_META_ERROR_CODES = new Set([1, 2, 4, 17, 368]);

function shouldRetryButtonTemplate(error: unknown, job: QueueJob): boolean {
  if (
    !(error instanceof MetaApiError) ||
    !TRANSIENT_META_ERROR_CODES.has(error.code)
  ) {
    return false;
  }

  const maxAttempts = job.opts?.attempts ?? 3;
  return job.attemptsMade + 1 < maxAttempts;
}

function buildInlineLinkFallback({
  message,
  commenterName,
  trackedUrl,
}: {
  message: string;
  commenterName?: string | null;
  trackedUrl: string;
}): string {
  const body =
    renderMessageWithoutLink({ message, commenterName }) || "Here's your link:";
  return `${body}\n\n${trackedUrl}`;
}

/**
 * Pick one reply-DM variant at random. Falls back to the legacy single
 * dmMessage when no variants are stored, mirroring the public-reply pool.
 */
function pickDmMessage(automation: {
  dmMessage: string;
  dmMessages?: unknown;
}): string {
  const pool = asStringArray(automation.dmMessages).filter(
    (message) => message.trim().length > 0
  );
  if (pool.length === 0) return automation.dmMessage;
  return pool[Math.floor(Math.random() * pool.length)];
}

async function processComment(job: QueueJob<ProcessCommentJob>): Promise<void> {
  const {
    instagramAccountId,
    commentId,
    commentText,
    commenterId,
    commenterName,
    mediaId,
  } = job.data;
  const requeueAttempt = job.data.requeueAttempt ?? 0;

  const automations = await prisma.automation.findMany({
    where: {
      // Both comment-triggered types run here; a comment-to-comment campaign
      // only posts the public reply (its DM leg is skipped below).
      type: { in: ["COMMENT_TO_DM", "COMMENT_TO_COMMENT"] },
      // Match a specific post, any-post campaigns, or reels materialized by
      // persistent "every future reel" targeting.
      OR: [
        { postId: mediaId },
        { matchAnyPost: true },
        {
          autoAddNewReels: true,
          mediaTargets: { some: { mediaId } },
        },
      ],
      isActive: true,
      instagramAccount: {
        instagramId: instagramAccountId,
      },
    },
    include: {
      instagramAccount: true,
      workspace: true,
      trackedLinks: {
        select: {
          slug: true,
          destinationUrl: true,
        },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  for (const automation of automations) {
    // "Any word" campaigns fire on every comment; otherwise require a keyword hit.
    const matchResult = automation.matchAnyWord
      ? { matched: true, matchedKeyword: null }
      : matchKeywords(
          commentText,
          asStringArray(automation.keywords),
          automation.wholeWordMatch
        );

    if (!matchResult.matched) {
      continue;
    }

    const existingLog = await prisma.dmLog.findUnique({
      where: {
        automationId_commentId: {
          automationId: automation.id,
          commentId,
        },
      },
    });

    // A comment-to-comment campaign never sends a DM — the public reply is its
    // entire delivery.
    const isCommentOnly = automation.type === "COMMENT_TO_COMMENT";
    const alreadyDmd = !isCommentOnly && existingLog?.status === "SENT";
    const alreadyPublicReplied = Boolean(existingLog?.publicReplySentAt);
    const needsDm = !isCommentOnly && !alreadyDmd;

    // Skip only when there is genuinely nothing left to do. A comment whose DM
    // already sent but whose public reply never posted (e.g. it hit a rate
    // limit) must still come back so the public reply can be retried.
    if (existingLog?.status === "SKIPPED_PLAN_LIMIT") continue;
    if (isCommentOnly) {
      // Nothing left once the public reply has posted.
      if (alreadyPublicReplied) continue;
    } else if (
      alreadyDmd &&
      (alreadyPublicReplied || !automation.publicReplyEnabled)
    ) {
      continue;
    }

    if (!automation.instagramAccount.accessToken) {
      await prisma.dmLog.upsert({
        where: {
          automationId_commentId: {
            automationId: automation.id,
            commentId,
          },
        },
        create: {
          workspaceId: automation.workspaceId,
          automationId: automation.id,
          instagramAccountId: automation.instagramAccountId,
          commenterId,
          commenterName,
          commentText,
          commentId,
          matchedKeyword: matchResult.matchedKeyword,
          status: "FAILED",
          errorMessage: "No Instagram access token available",
        },
        update: {
          status: "FAILED",
          errorMessage: "No Instagram access token available",
        },
      });
      continue;
    }

    let accessToken: string;
    try {
      accessToken = decryptToken(automation.instagramAccount.accessToken);
    } catch {
      await prisma.dmLog.upsert({
        where: {
          automationId_commentId: {
            automationId: automation.id,
            commentId,
          },
        },
        create: {
          workspaceId: automation.workspaceId,
          automationId: automation.id,
          instagramAccountId: automation.instagramAccountId,
          commenterId,
          commenterName,
          commentText,
          commentId,
          matchedKeyword: matchResult.matchedKeyword,
          status: "FAILED",
          errorMessage: "Failed to decrypt Instagram access token",
        },
        update: {
          status: "FAILED",
          errorMessage: "Failed to decrypt Instagram access token",
        },
      });
      continue;
    }

    // Ensure a log row exists before the public reply leg (which updates it).
    // Only (re)set PENDING when the DM will actually be attempted, so a prior
    // SENT is never clobbered while we come back just to retry the public reply.
    if (!existingLog) {
      await prisma.dmLog.create({
        data: {
          workspaceId: automation.workspaceId,
          automationId: automation.id,
          instagramAccountId: automation.instagramAccountId,
          commenterId,
          commenterName,
          commentText,
          commentId,
          matchedKeyword: matchResult.matchedKeyword,
          status: "PENDING",
          attempts: job.attemptsMade + 1,
        },
      });
    } else if (needsDm) {
      await prisma.dmLog.update({
        where: {
          automationId_commentId: { automationId: automation.id, commentId },
        },
        data: {
          status: "PENDING",
          attempts: job.attemptsMade + 1,
          matchedKeyword: matchResult.matchedKeyword,
          errorMessage: null,
        },
      });
    }

    // Public reply leg — decoupled from the DM and posted first so a DM failure
    // (e.g. a non-follower whose messaging is restricted) never suppresses it.
    // Idempotent across retries via publicReplySentAt.
    const publicReplyMessages = asStringArray(automation.publicReplyMessages);
    const replyPool =
      publicReplyMessages.length > 0
        ? publicReplyMessages
        : automation.publicReplyMessage
          ? [automation.publicReplyMessage]
          : automation.publicReplyEnabled
            ? [DEFAULT_PUBLIC_REPLY_MESSAGE]
            : [];
    if (
      automation.publicReplyEnabled &&
      replyPool.length > 0 &&
      !existingLog?.publicReplySentAt
    ) {
      try {
        const chosen = replyPool[Math.floor(Math.random() * replyPool.length)];
        const publicReply = renderMessageWithTracking({
          message: chosen,
          commenterName,
          trackedLinks: automation.trackedLinks,
        });
        await sendCommentReply(accessToken, commentId, publicReply);
        await prisma.dmLog.update({
          where: {
            automationId_commentId: { automationId: automation.id, commentId },
          },
          data: {
            publicReplySentAt: new Date(),
            publicReplyError: null,
            // For a comment-to-comment campaign the public reply is the whole
            // delivery, so mark the log SENT on success (there is no DM leg to
            // do it later).
            ...(isCommentOnly ? { status: "SENT" } : {}),
          },
        });
      } catch (error) {
        console.error(
          "[DM Worker] Public comment reply failed:",
          formatError(error)
        );
        await prisma.dmLog
          .update({
            where: {
              automationId_commentId: { automationId: automation.id, commentId },
            },
            data: {
              publicReplyError: formatError(error),
              ...(isCommentOnly
                ? { status: "FAILED", attempts: job.attemptsMade + 1 }
                : {}),
            },
          })
          .catch(() => {});
        // A comment-to-comment campaign has no DM leg to fall back on, so a
        // failed public reply is a failed delivery — rethrow to let the queue
        // retry with backoff. For comment-to-DM the reply is best-effort and
        // must not block the DM, so we swallow it as before.
        if (isCommentOnly) throw error;
      }
    }

    // DM already sent on an earlier pass; the public reply retry above was all
    // this run needed. Don't re-send the DM.
    if (!needsDm) continue;

    const usage = await reserveWorkspaceDMSend(automation.workspaceId);
    if (!usage.allowed) {
      await prisma.dmLog.update({
        where: {
          automationId_commentId: {
            automationId: automation.id,
            commentId,
          },
        },
        data: {
          status: "SKIPPED_PLAN_LIMIT",
          matchedKeyword: matchResult.matchedKeyword,
          errorMessage: `Monthly DM limit reached (${usage.limit})`,
        },
      });
      continue;
    }

    let rateLimit;
    try {
      rateLimit = await reserveDMSlot(instagramAccountId, requeueAttempt);
    } catch (error) {
      await releaseWorkspaceDMReservation(
        automation.workspaceId,
        usage.periodStart
      );
      await prisma.dmLog.update({
        where: {
          automationId_commentId: {
            automationId: automation.id,
            commentId,
          },
        },
        data: {
          status: "FAILED",
          attempts: job.attemptsMade + 1,
          errorMessage: formatError(error),
        },
      });
      throw error;
    }

    if (!rateLimit.allowed) {
      await releaseWorkspaceDMReservation(
        automation.workspaceId,
        usage.periodStart
      );

      if (rateLimit.shouldSkip) {
        await prisma.dmLog.update({
          where: {
            automationId_commentId: {
              automationId: automation.id,
              commentId,
            },
          },
          data: {
            status: "SKIPPED_RATE_LIMIT",
            matchedKeyword: matchResult.matchedKeyword,
            errorMessage: "Hourly Instagram DM rate limit reached",
          },
        });
        continue;
      }

      if (rateLimit.shouldRequeue) {
        await prisma.dmLog.update({
          where: {
            automationId_commentId: {
              automationId: automation.id,
              commentId,
            },
          },
          data: {
            status: "PENDING",
            matchedKeyword: matchResult.matchedKeyword,
            errorMessage: "Hourly rate limit hit; retry scheduled",
          },
        });

        await getDMQueue().add(
          "process-comment",
          {
            ...job.data,
            requeueAttempt: requeueAttempt + 1,
          },
          {
            delay: rateLimit.requeueDelayMs,
            jobId: `comment_${instagramAccountId}_${commentId}_retry_${requeueAttempt + 1}`,
          }
        );
        continue;
      }
    }

    // With an opening DM, the private reply is a button message; tapping it
    // fires a postback that delivers the reveal (see processPostback). Without
    // one, we send the reveal text directly as today.
    const useOpeningDm =
      automation.openingDmEnabled &&
      Boolean(automation.openingDmMessage) &&
      Boolean(automation.openingDmButtonLabel);

    // Pick one reply-DM variant for this send; reused across the button and
    // fallback paths so the logged/sent message stays consistent.
    const dmMessageText = pickDmMessage(automation);

    try {
      if (useOpeningDm) {
        const openingText = renderMessageWithTracking({
          message: automation.openingDmMessage as string,
          commenterName,
          trackedLinks: [],
        });
        await sendPrivateReplyWithButton(
          accessToken,
          automation.instagramAccount.instagramId,
          commentId,
          openingText,
          automation.openingDmButtonLabel as string,
          `reveal:${automation.id}`
        );
      } else if (automation.trackedLinks[0]) {
        // Try button template first; if Meta rejects it, fall back to inline link.
        const bodyText =
          renderMessageWithoutLink({
            message: dmMessageText,
            commenterName,
          }) || "Here's your link:";
        const trackedUrl = buildTrackedUrl(automation.trackedLinks[0].slug);

        try {
          await sendPrivateReplyWithLinkButton(
            accessToken,
            automation.instagramAccount.instagramId,
            commentId,
            bodyText,
            automation.linkButtonLabel || "Open link",
            trackedUrl
          );
        } catch (buttonError) {
          if (shouldRetryButtonTemplate(buttonError, job)) {
            console.warn(
              "[DM Worker] Button template temporarily unavailable; retrying job:",
              formatError(buttonError)
            );
            throw buttonError;
          }

          // A permanent rejection (or the final retry) still delivers the
          // promised link, on its own line so Instagram renders it cleanly.
          console.log(
            "[DM Worker] Button template rejected, falling back to inline link:",
            formatError(buttonError)
          );
          const fallbackMessage = buildInlineLinkFallback({
            message: dmMessageText,
            commenterName,
            trackedUrl,
          });
          await sendPrivateReply(
            accessToken,
            automation.instagramAccount.instagramId,
            commentId,
            fallbackMessage
          );
        }
      } else {
        const dmMessage = renderMessageWithTracking({
          message: dmMessageText,
          commenterName,
          trackedLinks: automation.trackedLinks,
        });
        await sendPrivateReply(
          accessToken,
          automation.instagramAccount.instagramId,
          commentId,
          dmMessage
        );
      }

      await prisma.dmLog.update({
        where: {
          automationId_commentId: {
            automationId: automation.id,
            commentId,
          },
        },
        data: {
          status: "SENT",
          dmSentAt: new Date(),
          errorMessage: null,
        },
      });
    } catch (error) {
      await releaseWorkspaceDMReservation(
        automation.workspaceId,
        usage.periodStart
      );

      await prisma.dmLog.update({
        where: {
          automationId_commentId: {
            automationId: automation.id,
            commentId,
          },
        },
        data: {
          status: "FAILED",
          attempts: job.attemptsMade + 1,
          errorMessage: formatError(error),
        },
      });
      throw error;
    }
  }
}

/**
 * Deliver the reveal message after a user taps an opening DM's button.
 * The postback payload is `reveal:<automationId>`; the sender is the user's
 * IGSID (same id as their comment author id), which we DM directly.
 */
async function processPostback(job: QueueJob<ProcessPostbackJob>): Promise<void> {
  const { instagramAccountId, userId, payload } = job.data;

  if (!payload.startsWith("reveal:")) return;
  const automationId = payload.slice("reveal:".length);

  const automation = await prisma.automation.findFirst({
    where: { id: automationId, isActive: true },
    include: {
      instagramAccount: true,
      workspace: true,
      trackedLinks: {
        select: { slug: true, destinationUrl: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (
    !automation ||
    automation.instagramAccount.instagramId !== instagramAccountId ||
    !automation.instagramAccount.accessToken
  ) {
    return;
  }

  // Duplicate sends are enabled: every button tap re-sends the reveal
  // instead of only firing once per person.
  const dedupeId = `reveal:${userId}`;

  // Personalize {username} from the opening DM log for this user, if present.
  const openingLog = await prisma.dmLog.findFirst({
    where: { automationId: automation.id, commenterId: userId },
    select: { commenterName: true },
  });
  const commenterName = openingLog?.commenterName ?? null;

  let accessToken: string;
  try {
    accessToken = decryptToken(automation.instagramAccount.accessToken);
  } catch {
    return;
  }

  const usage = await reserveWorkspaceDMSend(automation.workspaceId);
  if (!usage.allowed) {
    await prisma.dmLog.upsert({
      where: {
        automationId_commentId: { automationId: automation.id, commentId: dedupeId },
      },
      create: {
        workspaceId: automation.workspaceId,
        automationId: automation.id,
        instagramAccountId: automation.instagramAccountId,
        commenterId: userId,
        commenterName,
        commentText: "(button tap)",
        commentId: dedupeId,
        status: "SKIPPED_PLAN_LIMIT",
        errorMessage: `Monthly DM limit reached (${usage.limit})`,
      },
      update: { status: "SKIPPED_PLAN_LIMIT" },
    });
    return;
  }

  const primaryLink = automation.trackedLinks[0];

  // Pick one reply-DM variant for this send; reused across the button and
  // fallback paths so the delivered message stays consistent.
  const dmMessageText = pickDmMessage(automation);

  try {
    if (primaryLink) {
      // Try button template first; if Meta rejects it, fall back to inline link.
      const bodyText =
        renderMessageWithoutLink({
          message: dmMessageText,
          commenterName,
        }) || "Here's your link:";
      const trackedUrl = buildTrackedUrl(primaryLink.slug);

      try {
        await sendDirectMessageWithLinkButton(
          accessToken,
          automation.instagramAccount.instagramId,
          userId,
          bodyText,
          automation.linkButtonLabel || "Open link",
          trackedUrl
        );
      } catch (buttonError) {
        if (shouldRetryButtonTemplate(buttonError, job)) {
          console.warn(
            "[DM Worker] Postback button temporarily unavailable; retrying job:",
            formatError(buttonError)
          );
          throw buttonError;
        }

        // A permanent rejection (or the final retry) still delivers a clean,
        // tappable URL rather than dropping the reveal entirely.
        console.log(
          "[DM Worker] Button template rejected in postback, falling back to inline link:",
          formatError(buttonError)
        );
        const fallbackMessage = buildInlineLinkFallback({
          message: dmMessageText,
          commenterName,
          trackedUrl,
        });
        await sendDirectMessage(
          accessToken,
          automation.instagramAccount.instagramId,
          userId,
          fallbackMessage
        );
      }
    } else {
      const revealMessage = renderMessageWithTracking({
        message: dmMessageText,
        commenterName,
        trackedLinks: automation.trackedLinks,
      });
      await sendDirectMessage(
        accessToken,
        automation.instagramAccount.instagramId,
        userId,
        revealMessage
      );
    }
    await prisma.dmLog.upsert({
      where: {
        automationId_commentId: { automationId: automation.id, commentId: dedupeId },
      },
      create: {
        workspaceId: automation.workspaceId,
        automationId: automation.id,
        instagramAccountId: automation.instagramAccountId,
        commenterId: userId,
        commenterName,
        commentText: "(button tap)",
        commentId: dedupeId,
        status: "SENT",
        dmSentAt: new Date(),
      },
      update: { status: "SENT", dmSentAt: new Date(), errorMessage: null },
    });
  } catch (error) {
    await releaseWorkspaceDMReservation(automation.workspaceId, usage.periodStart);
    await prisma.dmLog.upsert({
      where: {
        automationId_commentId: { automationId: automation.id, commentId: dedupeId },
      },
      create: {
        workspaceId: automation.workspaceId,
        automationId: automation.id,
        instagramAccountId: automation.instagramAccountId,
        commenterId: userId,
        commenterName,
        commentText: "(button tap)",
        commentId: dedupeId,
        status: "FAILED",
        errorMessage: formatError(error),
      },
      update: { status: "FAILED", errorMessage: formatError(error) },
    });
    throw error;
  }
}

/**
 * Handle an inbound DM for DM auto-responder campaigns. Matches the message
 * text against each active auto-responder's keywords and, on a hit, replies to
 * the sender directly. Mirrors the comment path's dedup / usage / rate-limit
 * handling, but keyed on the message id instead of a comment id, and without the
 * public-reply or opening-DM legs (there is no post comment to reply to).
 */
async function processInboundDm(job: QueueJob<ProcessInboundDmJob>): Promise<void> {
  const { instagramAccountId, senderId, messageId, messageText } = job.data;
  const requeueAttempt = job.data.requeueAttempt ?? 0;

  // A synthetic comment id keeps a DM send unique per inbound message, reusing
  // the DmLog [automationId, commentId] constraint for idempotency.
  const dedupeId = `dm:${messageId}`;

  const automations = await prisma.automation.findMany({
    where: {
      type: "DM_AUTORESPONDER",
      isActive: true,
      instagramAccount: {
        instagramId: instagramAccountId,
      },
    },
    include: {
      instagramAccount: true,
      workspace: true,
      trackedLinks: {
        select: {
          slug: true,
          destinationUrl: true,
        },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  for (const automation of automations) {
    // "Any word" auto-responders reply to every DM; otherwise require a hit.
    const matchResult = automation.matchAnyWord
      ? { matched: true, matchedKeyword: null }
      : matchKeywords(
          messageText,
          asStringArray(automation.keywords),
          automation.wholeWordMatch
        );

    if (!matchResult.matched) continue;

    const existingLog = await prisma.dmLog.findUnique({
      where: {
        automationId_commentId: { automationId: automation.id, commentId: dedupeId },
      },
    });

    // Already replied to this exact message; nothing to do.
    if (existingLog?.status === "SENT") continue;
    if (existingLog?.status === "SKIPPED_PLAN_LIMIT") continue;

    if (!automation.instagramAccount.accessToken) continue;

    let accessToken: string;
    try {
      accessToken = decryptToken(automation.instagramAccount.accessToken);
    } catch {
      continue;
    }

    const usage = await reserveWorkspaceDMSend(automation.workspaceId);
    if (!usage.allowed) {
      await prisma.dmLog.upsert({
        where: {
          automationId_commentId: {
            automationId: automation.id,
            commentId: dedupeId,
          },
        },
        create: {
          workspaceId: automation.workspaceId,
          automationId: automation.id,
          instagramAccountId: automation.instagramAccountId,
          commenterId: senderId,
          commentText: messageText,
          commentId: dedupeId,
          matchedKeyword: matchResult.matchedKeyword,
          status: "SKIPPED_PLAN_LIMIT",
          errorMessage: `Monthly DM limit reached (${usage.limit})`,
        },
        update: { status: "SKIPPED_PLAN_LIMIT" },
      });
      continue;
    }

    let rateLimit;
    try {
      rateLimit = await reserveDMSlot(instagramAccountId, requeueAttempt);
    } catch (error) {
      await releaseWorkspaceDMReservation(
        automation.workspaceId,
        usage.periodStart
      );
      throw error;
    }

    if (!rateLimit.allowed) {
      await releaseWorkspaceDMReservation(
        automation.workspaceId,
        usage.periodStart
      );

      if (rateLimit.shouldSkip) {
        await prisma.dmLog.upsert({
          where: {
            automationId_commentId: {
              automationId: automation.id,
              commentId: dedupeId,
            },
          },
          create: {
            workspaceId: automation.workspaceId,
            automationId: automation.id,
            instagramAccountId: automation.instagramAccountId,
            commenterId: senderId,
            commentText: messageText,
            commentId: dedupeId,
            matchedKeyword: matchResult.matchedKeyword,
            status: "SKIPPED_RATE_LIMIT",
            errorMessage: "Hourly Instagram DM rate limit reached",
          },
          update: { status: "SKIPPED_RATE_LIMIT" },
        });
        continue;
      }

      if (rateLimit.shouldRequeue) {
        await getDMQueue().add(
          INBOUND_DM_JOB_NAME,
          {
            ...job.data,
            requeueAttempt: requeueAttempt + 1,
          },
          {
            delay: rateLimit.requeueDelayMs,
            jobId: `inbounddm_${instagramAccountId}_${messageId.replace(
              /:/g,
              "_"
            )}_retry_${requeueAttempt + 1}`,
          }
        );
        continue;
      }
    }

    const primaryLink = automation.trackedLinks[0];

    // Pick one reply-DM variant for this send; reused across the button and
    // fallback paths so the delivered message stays consistent.
    const dmMessageText = pickDmMessage(automation);

    try {
      if (primaryLink) {
        // Try button template first; if Meta rejects it, fall back to inline link.
        const bodyText =
          renderMessageWithoutLink({
            message: dmMessageText,
            commenterName: null,
          }) || "Here's your link:";
        const trackedUrl = buildTrackedUrl(primaryLink.slug);

        try {
          await sendDirectMessageWithLinkButton(
            accessToken,
            automation.instagramAccount.instagramId,
            senderId,
            bodyText,
            automation.linkButtonLabel || "Open link",
            trackedUrl
          );
        } catch (buttonError) {
          if (shouldRetryButtonTemplate(buttonError, job)) {
            console.warn(
              "[DM Worker] Auto-responder button temporarily unavailable; retrying job:",
              formatError(buttonError)
            );
            throw buttonError;
          }

          console.log(
            "[DM Worker] Button template rejected in auto-responder, falling back to inline link:",
            formatError(buttonError)
          );
          const fallbackMessage = buildInlineLinkFallback({
            message: dmMessageText,
            commenterName: null,
            trackedUrl,
          });
          await sendDirectMessage(
            accessToken,
            automation.instagramAccount.instagramId,
            senderId,
            fallbackMessage
          );
        }
      } else {
        const replyMessage = renderMessageWithTracking({
          message: dmMessageText,
          commenterName: null,
          trackedLinks: automation.trackedLinks,
        });
        await sendDirectMessage(
          accessToken,
          automation.instagramAccount.instagramId,
          senderId,
          replyMessage
        );
      }

      await prisma.dmLog.upsert({
        where: {
          automationId_commentId: {
            automationId: automation.id,
            commentId: dedupeId,
          },
        },
        create: {
          workspaceId: automation.workspaceId,
          automationId: automation.id,
          instagramAccountId: automation.instagramAccountId,
          commenterId: senderId,
          commentText: messageText,
          commentId: dedupeId,
          matchedKeyword: matchResult.matchedKeyword,
          status: "SENT",
          dmSentAt: new Date(),
        },
        update: { status: "SENT", dmSentAt: new Date(), errorMessage: null },
      });
    } catch (error) {
      await releaseWorkspaceDMReservation(
        automation.workspaceId,
        usage.periodStart
      );
      await prisma.dmLog.upsert({
        where: {
          automationId_commentId: {
            automationId: automation.id,
            commentId: dedupeId,
          },
        },
        create: {
          workspaceId: automation.workspaceId,
          automationId: automation.id,
          instagramAccountId: automation.instagramAccountId,
          commenterId: senderId,
          commentText: messageText,
          commentId: dedupeId,
          matchedKeyword: matchResult.matchedKeyword,
          status: "FAILED",
          attempts: job.attemptsMade + 1,
          errorMessage: formatError(error),
        },
        update: {
          status: "FAILED",
          attempts: job.attemptsMade + 1,
          errorMessage: formatError(error),
        },
      });
      throw error;
    }
  }
}

async function processJob(job: QueueJob<DmQueueJob>): Promise<void> {
  if (job.name === FACEBOOK_MESSAGE_JOB_NAME) {
    return processFacebookMessage(job as QueueJob<ProcessFacebookMessageJob>);
  }
  if (job.name === FACEBOOK_COMMENT_JOB_NAME) {
    return processFacebookComment(job as QueueJob<ProcessFacebookCommentJob>);
  }
  if (job.name === POSTBACK_JOB_NAME) {
    return processPostback(job as QueueJob<ProcessPostbackJob>);
  }
  if (job.name === INBOUND_DM_JOB_NAME) {
    return processInboundDm(job as QueueJob<ProcessInboundDmJob>);
  }
  return processComment(job as QueueJob<ProcessCommentJob>);
}

async function recordWorkerFailure(
  job: QueueJob<DmQueueJob> | undefined,
  error: Error
) {
  try {
    const instagramAccountId =
      job && "instagramAccountId" in job.data
        ? job.data.instagramAccountId
        : undefined;
    const facebookPageId =
      job && "pageId" in job.data ? job.data.pageId : undefined;
    const commentId =
      job && "commentId" in job.data ? job.data.commentId : null;
    await recordWorkerAlert({
      level: "error",
      message: `DM worker job ${job?.id ?? "unknown"} failed: ${error.message}`,
      jobId: job?.id,
      instagramAccountId,
      facebookPageId,
      commentId: commentId ?? undefined,
    });
  } catch (recordError) {
    console.error(
      "[DM Worker] Failed to record worker failure:",
      formatError(recordError)
    );
  }
}

export function createDMWorker(): DurableWorker {
  const worker = new DurableWorker(processJob, {
    concurrency: 5,
    settings: {
      backoffStrategy: (attemptsMade: number) =>
        BACKOFF_DELAYS[Math.min(attemptsMade - 1, BACKOFF_DELAYS.length - 1)],
    },
  });

  worker.on("completed", (job: QueueJob<DmQueueJob>) => {
    console.log(`[DM Worker] Job ${job.id} completed`);
  });

  worker.on("failed", (job: QueueJob<DmQueueJob>, err: Error) => {
    console.error(
      `[DM Worker] Job ${job?.id} failed (attempt ${job?.attemptsMade}):`,
      err.message
    );
    void recordWorkerFailure(job, err);
  });

  worker.on("error", (err: Error) => {
    console.error("[DM Worker] Worker error:", err.message);
    void recordWorkerAlert({
      level: "error",
      message: `DM worker process error: ${err.message}`,
    })
      .catch((recordError) => {
        console.error(
          "[DM Worker] Failed to record worker process error:",
          formatError(recordError)
        );
      });
  });

  return worker;
}
