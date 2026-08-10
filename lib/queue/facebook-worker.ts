import type { Job } from "bullmq";
import { prisma } from "@/lib/db/client";
import { decryptToken } from "@/lib/meta/oauth";
import {
  sendFacebookCommentPrivateReply,
  sendFacebookMessage,
} from "@/lib/meta/facebook";
import type {
  ProcessFacebookCommentJob,
  ProcessFacebookMessageJob,
} from "@/lib/queue/client";
import { matchKeywords } from "@/lib/utils/keyword-matcher";
import { asStringArray } from "@/lib/utils/string-list";
import {
  releaseWorkspaceDMReservation,
  reserveWorkspaceDMSend,
} from "@/lib/billing/usage";

type FacebookAutomationWithPage = Awaited<
  ReturnType<typeof findFacebookAutomations>
>[number];

function findFacebookAutomations(
  pageId: string,
  type: "MESSENGER_AUTORESPONDER" | "COMMENT_TO_MESSAGE",
  postId?: string
) {
  return prisma.facebookAutomation.findMany({
    where: {
      type,
      isActive: true,
      facebookPage: { pageId },
      ...(type === "COMMENT_TO_MESSAGE"
        ? { OR: [{ matchAnyPost: true }, { postId }] }
        : {}),
    },
    include: { facebookPage: true },
    orderBy: { createdAt: "asc" },
  });
}

async function deliverFacebookAutomation(args: {
  automation: FacebookAutomationWithPage;
  triggerId: string;
  triggerText: string;
  triggerType: "MESSAGE" | "COMMENT";
  senderId: string;
  senderName?: string;
  send: (accessToken: string, reply: string) => Promise<unknown>;
  attemptsMade: number;
}) {
  const { automation, triggerId, triggerText } = args;
  const match = automation.matchAnyWord
    ? { matched: true, matchedKeyword: null }
    : matchKeywords(
        triggerText,
        asStringArray(automation.keywords),
        automation.wholeWordMatch
      );
  if (!match.matched) return;

  const existing = await prisma.facebookMessageLog.findUnique({
    where: { automationId_triggerId: { automationId: automation.id, triggerId } },
  });
  if (existing?.status === "SENT" || existing?.status === "SKIPPED_PLAN_LIMIT") {
    return;
  }

  const usage = await reserveWorkspaceDMSend(automation.workspaceId);
  if (!usage.allowed) {
    await prisma.facebookMessageLog.upsert({
      where: { automationId_triggerId: { automationId: automation.id, triggerId } },
      create: {
        workspaceId: automation.workspaceId,
        automationId: automation.id,
        facebookPageId: automation.facebookPageId,
        senderId: args.senderId,
        senderName: args.senderName,
        triggerId,
        triggerText,
        triggerType: args.triggerType,
        matchedKeyword: match.matchedKeyword,
        status: "SKIPPED_PLAN_LIMIT",
        errorMessage: `Monthly DM limit reached (${usage.limit})`,
      },
      update: { status: "SKIPPED_PLAN_LIMIT" },
    });
    return;
  }

  let accessToken: string;
  try {
    accessToken = decryptToken(automation.facebookPage.accessToken);
  } catch (error) {
    await releaseWorkspaceDMReservation(automation.workspaceId, usage.periodStart);
    throw error;
  }

  const personalizedReply = automation.replyMessage
    .replaceAll("{name}", args.senderName ?? "there")
    .replaceAll("{username}", args.senderName ?? "there");

  await prisma.facebookMessageLog.upsert({
    where: { automationId_triggerId: { automationId: automation.id, triggerId } },
    create: {
      workspaceId: automation.workspaceId,
      automationId: automation.id,
      facebookPageId: automation.facebookPageId,
      senderId: args.senderId,
      senderName: args.senderName,
      triggerId,
      triggerText,
      triggerType: args.triggerType,
      matchedKeyword: match.matchedKeyword,
      status: "PENDING",
    },
    update: { status: "PENDING", errorMessage: null },
  });

  try {
    await args.send(accessToken, personalizedReply);
    await prisma.facebookMessageLog.update({
      where: { automationId_triggerId: { automationId: automation.id, triggerId } },
      data: {
        status: "SENT",
        sentAt: new Date(),
        attempts: args.attemptsMade + 1,
        errorMessage: null,
      },
    });
  } catch (error) {
    await releaseWorkspaceDMReservation(automation.workspaceId, usage.periodStart);
    await prisma.facebookMessageLog.update({
      where: { automationId_triggerId: { automationId: automation.id, triggerId } },
      data: {
        status: "FAILED",
        attempts: args.attemptsMade + 1,
        errorMessage: error instanceof Error ? error.message : "Unknown error",
      },
    });
    throw error;
  }
}

export async function processFacebookMessage(
  job: Job<ProcessFacebookMessageJob>
) {
  const { pageId, senderId, messageId, messageText } = job.data;
  const automations = await findFacebookAutomations(
    pageId,
    "MESSENGER_AUTORESPONDER"
  );
  for (const automation of automations) {
    await deliverFacebookAutomation({
      automation,
      triggerId: `message:${messageId}`,
      triggerText: messageText,
      triggerType: "MESSAGE",
      senderId,
      attemptsMade: job.attemptsMade,
      send: (accessToken, reply) =>
        sendFacebookMessage(pageId, accessToken, senderId, reply),
    });
  }
}

export async function processFacebookComment(
  job: Job<ProcessFacebookCommentJob>
) {
  const { pageId, senderId, senderName, commentId, commentText, postId } = job.data;
  const automations = await findFacebookAutomations(
    pageId,
    "COMMENT_TO_MESSAGE",
    postId
  );
  for (const automation of automations) {
    await deliverFacebookAutomation({
      automation,
      triggerId: `comment:${commentId}`,
      triggerText: commentText,
      triggerType: "COMMENT",
      senderId,
      senderName,
      attemptsMade: job.attemptsMade,
      send: (accessToken, reply) =>
        sendFacebookCommentPrivateReply(commentId, accessToken, reply),
    });
  }
}
