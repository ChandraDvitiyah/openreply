import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/client";
import { decryptToken } from "@/lib/meta/oauth";
import { metaPublisher, PublishingError } from "./publisher";
import type { Prisma } from "@/app/generated/prisma/client";

const LEASE_MS = 10 * 60_000;
const MAX_ATTEMPTS = 3;
export async function runSchedulerTick(
  options: {
    db?: typeof prisma;
    publisher?: Omit<typeof metaPublisher, "publicationStatus"> &
      Partial<Pick<typeof metaPublisher, "publicationStatus">>;
    decrypt?: typeof decryptToken;
  } = {},
) {
  const db = options.db ?? prisma;
  const publisher = options.publisher ?? metaPublisher;
  const decrypt = options.decrypt ?? decryptToken;
  const now = new Date();
  // A crash before the outbound publish is safe to recover. A crash after the
  // durable outbound marker needs human reconciliation, never a blind retry.
  await db.scheduledPost.updateMany({
    where: {
      status: "PUBLISHING",
      leaseExpiresAt: { lt: now },
      publishStartedAt: { not: null },
    },
    data: {
      status: "NEEDS_REVIEW",
      leaseOwner: null,
      leaseExpiresAt: null,
      lastError:
        "Delivery was interrupted after publishing began. Check your social account and confirm whether it was published.",
      revision: { increment: 1 },
    },
  });
  await db.scheduledPost.updateMany({
    where: {
      status: "PUBLISHING",
      leaseExpiresAt: { lt: now },
      publishStartedAt: null,
    },
    data: {
      status: "SCHEDULED",
      availableAt: now,
      leaseOwner: null,
      leaseExpiresAt: null,
      revision: { increment: 1 },
    },
  });
  const candidate = await db.scheduledPost.findFirst({
    where: { status: "SCHEDULED", availableAt: { lte: now } },
    orderBy: [{ availableAt: "asc" }, { createdAt: "asc" }],
  });
  if (!candidate) return false;
  const owner = randomUUID();
  const claimed = await db.scheduledPost.updateMany({
    where: {
      id: candidate.id,
      revision: candidate.revision,
      status: "SCHEDULED",
      availableAt: { lte: now },
    },
    data: {
      status: "PUBLISHING",
      leaseOwner: owner,
      leaseExpiresAt: new Date(Date.now() + LEASE_MS),
      revision: { increment: 1 },
    },
  });
  if (!claimed.count) return false;
  const owned = {
    id: candidate.id,
    status: "PUBLISHING" as const,
    leaseOwner: owner,
  };
  let post = candidate;
  let publishStarted = Boolean(candidate.publishStartedAt);
  async function waitForMedia() {
    if (post.processingChecks >= 120)
      throw new PublishingError(
        "Media processing timed out. Check the social account before retrying.",
        false,
        !publishStarted,
      );
    await checkpoint({
      status: "SCHEDULED",
      processingChecks: { increment: 1 },
      availableAt: new Date(Date.now() + 30_000),
      leaseOwner: null,
      leaseExpiresAt: null,
    });
  }
  async function checkpoint(data: Prisma.ScheduledPostUpdateManyMutationInput) {
    const updated = await db.scheduledPost.updateMany({ where: owned, data });
    if (!updated.count)
      throw new PublishingError(
        "Publishing lease lost. Check the social account before retrying.",
        false,
        false,
      );
  }
  try {
    const account =
      candidate.platform === "INSTAGRAM"
        ? await db.instagramAccount.findFirst({
            where: {
              id: candidate.instagramAccountId ?? "",
              workspaceId: candidate.workspaceId,
            },
          })
        : await db.facebookPage.findFirst({
            where: {
              id: candidate.facebookPageId ?? "",
              workspaceId: candidate.workspaceId,
            },
          });
    if (!account)
      throw new PublishingError(
        "Account disconnected. Connect it in Settings, then edit this post to select the account.",
      );
    let token: string;
    try {
      token = decrypt(account.accessToken);
    } catch {
      throw new PublishingError(
        "Unable to read the account connection. Reconnect it in Settings.",
      );
    }
    if (
      "tokenExpiresAt" in account &&
      account.tokenExpiresAt &&
      account.tokenExpiresAt <= now
    )
      throw new PublishingError(
        "Connection expired. Reconnect the account in Settings, then retry.",
      );
    const accountId =
      "instagramId" in account ? account.instagramId : account.pageId;
    if (post.publishStartedAt) {
      const prepared = post.preparation as { accepted?: boolean };
      if (!prepared?.accepted || !publisher.publicationStatus)
        throw new PublishingError(
          "A previous publish attempt needs delivery confirmation. Check the social account before retrying.",
          false,
          false,
        );
      const status = await publisher.publicationStatus(post, token);
      if (status === "IN_PROGRESS") {
        await waitForMedia();
        return true;
      }
      if (status !== "PUBLISHED")
        throw new PublishingError(
          "Meta could not confirm video publication. Check the social account before retrying.",
          false,
          false,
        );
      await checkpoint({
        status: "PUBLISHED",
        publishedAt: new Date(),
        lastError: null,
        leaseOwner: null,
        leaseExpiresAt: null,
        revision: { increment: 1 },
      });
      return true;
    }
    if (
      post.platform === "INSTAGRAM" ||
      ["REEL", "CAROUSEL", "STORY_IMAGE", "STORY_VIDEO"].includes(post.kind)
    ) {
      // Persist the container before publishing. A manual retry recreates
      // expired or invalid containers; preparation itself does not publish.
      if (!post.containerId) {
        const containerId = await publisher.prepare(
          post,
          token,
          accountId,
          async (preparation) => {
            await checkpoint({ preparation });
            post = { ...post, preparation };
          },
        );
        if (!containerId) {
          await waitForMedia();
          return true;
        }
        await checkpoint({ containerId });
        post = { ...post, containerId };
      }
      // Facebook upload acknowledgement is enough to finish the upload.
      // Finish starts processing; readiness is checked after acceptance.
      const status =
        post.platform === "FACEBOOK"
          ? "FINISHED"
          : await publisher.containerStatus(
              post.containerId!,
              token,
              post.platform,
            );
      if (status === "IN_PROGRESS") {
        await waitForMedia();
        return true;
      }
      if (status === "PUBLISHED")
        throw new PublishingError(
          "Meta reports this container was already published. Check your account to confirm delivery.",
          false,
          false,
        );
      if (status !== "FINISHED")
        throw new PublishingError(
          "Meta could not process this media. Check its format and public URL before retrying.",
        );
    }
    await checkpoint({ publishStartedAt: new Date() });
    publishStarted = true;
    const externalPostId = await publisher.publish(post, token, accountId);
    if (
      post.platform === "FACEBOOK" &&
      ["VIDEO", "REEL", "STORY_VIDEO"].includes(post.kind)
    ) {
      const preparation = { ...(post.preparation as object), accepted: true };
      await checkpoint({
        preparation,
        externalPostId,
        containerId: post.kind === "VIDEO" ? externalPostId : post.containerId,
        processingChecks: 0,
        status: "SCHEDULED",
        availableAt: new Date(Date.now() + 30_000),
        leaseOwner: null,
        leaseExpiresAt: null,
      });
      return true;
    }
    await checkpoint({
      status: "PUBLISHED",
      externalPostId,
      publishedAt: new Date(),
      lastError: null,
      leaseOwner: null,
      leaseExpiresAt: null,
      revision: { increment: 1 },
    });
  } catch (error) {
    const failure =
      error instanceof PublishingError
        ? error
        : new PublishingError(
            "Publishing was interrupted. Please check the account connection and try again.",
            true,
            false,
          );
    const uncertain =
      Boolean(candidate.publishStartedAt) ||
      (publishStarted && !failure.rejected) ||
      failure.message.includes("already published");
    const attempts = post.attempts + 1;
    const retry = !uncertain && failure.retryable && attempts < MAX_ATTEMPTS;
    await checkpoint({
      status: uncertain ? "NEEDS_REVIEW" : retry ? "SCHEDULED" : "FAILED",
      attempts,
      lastError: failure.message,
      availableAt: retry ? new Date(Date.now() + attempts * 60_000) : null,
      ...(uncertain ? {} : { publishStartedAt: null }),
      leaseOwner: null,
      leaseExpiresAt: null,
      revision: { increment: 1 },
    });
  }
  return true;
}
