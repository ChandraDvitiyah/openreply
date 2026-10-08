import { prisma } from "@/lib/db/client";
import type { WorkspaceContext } from "@/lib/workspace-access";
import type { PostInput } from "./validation";
import { mutationSchema, postInputSchema } from "./validation";
import type { z } from "zod";
import { inferMediaType, readPublishingOptions } from "./capabilities";
import type { Prisma } from "@/app/generated/prisma/client";
import { asStringArray } from "@/lib/utils/string-list";
import { isBackblazeMediaUrl, ownsSchedulerMedia } from "./storage";

export class SchedulerError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

async function checkMedia(
  context: WorkspaceContext,
  urls: string[],
  db: Prisma.TransactionClient,
) {
  for (const url of urls) {
    if (
      process.env.B2_BUCKET_NAME &&
      isBackblazeMediaUrl(url) &&
      new URL(url).pathname.startsWith(
        `/file/${process.env.B2_BUCKET_NAME}/`,
      ) &&
      !ownsSchedulerMedia(context.workspaceId, url)
    )
      throw new SchedulerError("Choose a media file from this workspace.");
  }
  const removed = await db.scheduledMediaCleanup.findFirst({
    where: {
      workspaceId: context.workspaceId,
      url: { in: urls },
      state: { in: ["DELETING", "DELETED"] },
    },
  });
  if (removed)
    throw new SchedulerError(
      "This upload has been removed after publication. Upload the file again before saving this post.",
      409,
    );
}
async function contentData(
  context: WorkspaceContext,
  input: PostInput,
  db: Prisma.TransactionClient,
) {
  await checkMedia(
    context,
    [...input.mediaUrls, input.publishingOptions.coverUrl].filter(Boolean),
    db,
  );
  const account =
    input.platform === "INSTAGRAM"
      ? await db.instagramAccount.findFirst({
          where: { id: input.accountId, workspaceId: context.workspaceId },
          select: { username: true },
        })
      : await db.facebookPage.findFirst({
          where: { id: input.accountId, workspaceId: context.workspaceId },
          select: { name: true },
        });
  if (!account)
    throw new SchedulerError(
      "This account is no longer connected to your workspace.",
    );
  const scheduledAt =
    input.intent === "now"
      ? new Date()
      : input.intent === "schedule"
        ? new Date(input.scheduledAt!)
        : null;
  return {
    title: input.title,
    caption: input.caption,
    platform: input.platform,
    kind: input.kind,
    mediaUrls: input.mediaUrls,
    publishingOptions: input.publishingOptions,
    preparation: {},
    timezone: input.timezone,
    scheduledAt,
    availableAt: scheduledAt,
    status: scheduledAt ? ("SCHEDULED" as const) : ("DRAFT" as const),
    accountName: "username" in account ? `@${account.username}` : account.name,
    instagramAccountId: input.platform === "INSTAGRAM" ? input.accountId : null,
    facebookPageId: input.platform === "FACEBOOK" ? input.accountId : null,
    attempts: 0,
    processingChecks: 0,
    containerId: null,
    publishStartedAt: null,
    externalPostId: null,
    publishedAt: null,
    mediaCleanupQueuedAt: null,
    leaseOwner: null,
    leaseExpiresAt: null,
    lastError: null,
  };
}

async function createPostInTransaction(
  context: WorkspaceContext,
  input: PostInput,
  db: Prisma.TransactionClient,
) {
  const data = {
    ...(await contentData(context, input, db)),
    workspaceId: context.workspaceId,
    createdById: context.userId,
    clientRequestId: input.clientRequestId ?? null,
  };
  if (!input.clientRequestId) return db.scheduledPost.create({ data });
  // A retried HTTP request must never create a second publishing job. The
  // database unique constraint remains authoritative across concurrent calls.
  const post = await db.scheduledPost.upsert({
    where: {
      workspaceId_clientRequestId: {
        workspaceId: context.workspaceId,
        clientRequestId: input.clientRequestId,
      },
    },
    create: data,
    update: {},
  });
  if (
    post.title !== input.title ||
    post.caption !== input.caption ||
    post.kind !== input.kind ||
    post.platform !== input.platform ||
    JSON.stringify(post.mediaUrls) !== JSON.stringify(input.mediaUrls) ||
    JSON.stringify(readPublishingOptions(post.publishingOptions)) !==
      JSON.stringify(input.publishingOptions) ||
    (post.instagramAccountId ?? post.facebookPageId) !== input.accountId ||
    post.timezone !== input.timezone ||
    (input.intent === "draft" && post.scheduledAt !== null) ||
    (input.intent !== "draft" && !post.scheduledAt) ||
    (input.intent === "schedule" &&
      post.scheduledAt?.getTime() !== Date.parse(input.scheduledAt!))
  ) {
    throw new SchedulerError(
      "Your previous save succeeded with different content. Refresh and open the saved post to edit it.",
      409,
    );
  }
  return post;
}

async function mutatePostInTransaction(
  context: WorkspaceContext,
  id: string,
  input: z.infer<typeof mutationSchema>,
  db: Prisma.TransactionClient,
) {
  const post = await db.scheduledPost.findFirst({
    where: { id, workspaceId: context.workspaceId },
  });
  if (!post) throw new SchedulerError("Post not found.", 404);
  if (post.revision !== input.revision)
    throw new SchedulerError(
      "This post changed. Refresh before editing it.",
      409,
    );
  if (input.action === "duplicate") {
    const options = readPublishingOptions(post.publishingOptions);
    const media = asStringArray(post.mediaUrls);
    const unavailable = await db.scheduledMediaCleanup.findMany({
      where: {
        workspaceId: context.workspaceId,
        url: { in: [...media, options.coverUrl] },
        state: { in: ["DELETING", "DELETED"] },
      },
      select: { url: true },
    });
    const removed = new Set(unavailable.map((row) => row.url));
    const indexes = media
      .map((_, i) => i)
      .filter((i) => !removed.has(media[i]));
    const copiedMedia = indexes.map((i) => media[i]);
    const copiedOptions = {
      ...options,
      mediaTypes:
        copiedMedia.length === media.length
          ? options.mediaTypes
          : indexes.map(
              (i) => options.mediaTypes[i] ?? inferMediaType(media[i]),
            ),
      altTexts:
        copiedMedia.length === media.length
          ? options.altTexts
          : indexes.map((i) => options.altTexts[i] ?? ""),
      coverUrl: removed.has(options.coverUrl) ? "" : options.coverUrl,
    };
    await checkMedia(
      context,
      [...copiedMedia, copiedOptions.coverUrl].filter(Boolean),
      db,
    );
    return db.scheduledPost.create({
      data: {
        workspaceId: context.workspaceId,
        createdById: context.userId,
        platform: post.platform,
        instagramAccountId: post.instagramAccountId,
        facebookPageId: post.facebookPageId,
        accountName: post.accountName,
        title: `${post.title.slice(0, 113)} (copy)`,
        caption: post.caption,
        kind: post.kind,
        mediaUrls: copiedMedia,
        publishingOptions: copiedOptions,
        timezone: post.timezone,
      },
    });
  }
  if (["PUBLISHING", "PUBLISHED"].includes(post.status))
    throw new SchedulerError(
      "A publishing or published post cannot be changed.",
      409,
    );
  let data;
  if (
    input.action === "confirm-published" ||
    input.action === "confirm-not-published"
  ) {
    if (post.status !== "NEEDS_REVIEW")
      throw new SchedulerError(
        "Only uncertain deliveries require confirmation.",
        409,
      );
    data =
      input.action === "confirm-published"
        ? {
            status: "PUBLISHED" as const,
            publishedAt: new Date(),
            lastError:
              "Publication confirmed manually after checking the account.",
          }
        : {
            status: "FAILED" as const,
            publishStartedAt: null,
            containerId: null,
            preparation: {},
            externalPostId: null,
            lastError: "Confirmed not published. You can edit or retry safely.",
          };
  } else {
    if (post.status === "NEEDS_REVIEW" || post.publishStartedAt)
      throw new SchedulerError(
        "Check the social account and resolve the uncertain delivery before changing this post.",
        409,
      );
    if (input.action === "cancel") {
      data = { status: "CANCELLED" as const, availableAt: null };
    } else if (input.action === "retry") {
      if (post.status !== "FAILED")
        throw new SchedulerError("Only failed posts can be retried.", 409);
      const parsed = postInputSchema.parse({
        ...post,
        clientRequestId: post.clientRequestId ?? undefined,
        accountId: post.instagramAccountId ?? post.facebookPageId ?? "",
        scheduledAt: null,
        intent: "now",
      });
      data = await contentData(context, parsed, db);
    } else {
      if (!input.post) throw new SchedulerError("Post content is required.");
      data = await contentData(context, input.post, db);
    }
  }
  // Status + revision guards serialize edits, cancellation, and worker claims.
  const changed = await db.scheduledPost.updateMany({
    where: {
      id,
      workspaceId: context.workspaceId,
      revision: input.revision,
      status: post.status,
    },
    data: { ...data, revision: { increment: 1 } },
  });
  if (!changed.count)
    throw new SchedulerError(
      "This post changed. Refresh before editing it.",
      409,
    );
  return db.scheduledPost.findUniqueOrThrow({ where: { id } });
}

// Serialize content references against cleanup's deletion claim.
export async function createPost(context: WorkspaceContext, input: PostInput) {
  return prisma.$transaction((db) =>
    createPostInTransaction(context, input, db),
  );
}
export async function mutatePost(
  context: WorkspaceContext,
  id: string,
  input: z.infer<typeof mutationSchema>,
) {
  return prisma.$transaction((db) =>
    mutatePostInTransaction(context, id, input, db),
  );
}
