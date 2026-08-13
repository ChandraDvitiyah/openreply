import { prisma } from "@/lib/db/client";
import {
  FACEBOOK_COMMENT_JOB_NAME,
  FACEBOOK_MESSAGE_JOB_NAME,
  INBOUND_DM_JOB_NAME,
  POSTBACK_JOB_NAME,
  getDMQueue,
} from "@/lib/queue/client";
import {
  parseFacebookCommentEvents,
  parseFacebookMessageEvents,
} from "@/lib/meta/facebook-webhook";
import {
  parseCommentEvents,
  parseMessageEvents,
  parsePostbackEvents,
} from "@/lib/meta/webhook";

export async function enqueueWebhookPayload(payload: unknown): Promise<{
  workspaceId: string | null;
  jobsQueued: number;
}> {
  const queue = getDMQueue();
  let workspaceId: string | null = null;
  let jobsQueued = 0;

  const rememberInstagramWorkspace = async (instagramId: string) => {
    if (workspaceId) return;
    const account = await prisma.instagramAccount.findUnique({
      where: { instagramId },
      select: { workspaceId: true },
    });
    workspaceId = account?.workspaceId ?? null;
  };

  for (const event of parseCommentEvents(
    payload as Parameters<typeof parseCommentEvents>[0]
  )) {
    await rememberInstagramWorkspace(event.instagramAccountId);
    await queue.add(
      "process-comment",
      { ...event, source: "WEBHOOK" },
      { jobId: `comment_${event.instagramAccountId}_${event.commentId}` }
    );
    jobsQueued += 1;
  }

  for (const event of parsePostbackEvents(
    payload as Parameters<typeof parsePostbackEvents>[0]
  )) {
    await rememberInstagramWorkspace(event.instagramAccountId);
    await queue.add(POSTBACK_JOB_NAME, event, {
      jobId: `postback_${event.instagramAccountId}_${event.userId}_${(
        event.mid ?? event.payload
      ).replace(/:/g, "_")}`,
    });
    jobsQueued += 1;
  }

  for (const event of parseMessageEvents(
    payload as Parameters<typeof parseMessageEvents>[0]
  )) {
    await rememberInstagramWorkspace(event.instagramAccountId);
    await queue.add(INBOUND_DM_JOB_NAME, event, {
      jobId: `inbounddm_${event.instagramAccountId}_${event.messageId.replace(
        /:/g,
        "_"
      )}`,
    });
    jobsQueued += 1;
  }

  for (const event of parseFacebookCommentEvents(
    payload as Parameters<typeof parseFacebookCommentEvents>[0]
  )) {
    const page = await prisma.facebookPage.findUnique({
      where: { pageId: event.pageId },
      select: { workspaceId: true },
    });
    if (!page) continue;
    workspaceId ??= page.workspaceId;
    await queue.add(FACEBOOK_COMMENT_JOB_NAME, event, {
      jobId: `fbcomment_${event.pageId}_${event.commentId.replace(/:/g, "_")}`,
    });
    jobsQueued += 1;
  }

  for (const event of parseFacebookMessageEvents(
    payload as Parameters<typeof parseFacebookMessageEvents>[0]
  )) {
    const page = await prisma.facebookPage.findUnique({
      where: { pageId: event.pageId },
      select: { workspaceId: true },
    });
    if (!page) continue;
    workspaceId ??= page.workspaceId;
    await queue.add(FACEBOOK_MESSAGE_JOB_NAME, event, {
      jobId: `fbmessage_${event.pageId}_${event.messageId.replace(/:/g, "_")}`,
    });
    jobsQueued += 1;
  }

  return { workspaceId, jobsQueued };
}

export async function replayFailedWebhookEvents(limit = 100) {
  const failedEvents = await prisma.webhookEvent.findMany({
    // Meta delivery actions are time-sensitive. Recover current outages, but
    // never surprise people by replaying an ancient failed webhook months later.
    where: {
      status: "FAILED",
      createdAt: { gte: new Date(Date.now() - 24 * 60 * 60_000) },
    },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true, payload: true },
  });

  let replayed = 0;
  let failed = 0;
  for (const event of failedEvents) {
    const claimed = await prisma.webhookEvent.updateMany({
      where: { id: event.id, status: "FAILED" },
      data: { status: "PENDING", errorMessage: null },
    });
    if (claimed.count !== 1) continue;

    try {
      const result = await enqueueWebhookPayload(event.payload);
      await prisma.webhookEvent.update({
        where: { id: event.id },
        data: {
          workspaceId: result.workspaceId ?? undefined,
          status: "PROCESSED",
          processedAt: new Date(),
        },
      });
      replayed += 1;
    } catch (error) {
      await prisma.webhookEvent.update({
        where: { id: event.id },
        data: {
          status: "FAILED",
          errorMessage:
            error instanceof Error ? error.message : "Unknown replay error",
          processedAt: new Date(),
        },
      });
      failed += 1;
    }
  }

  return { scanned: failedEvents.length, replayed, failed };
}
