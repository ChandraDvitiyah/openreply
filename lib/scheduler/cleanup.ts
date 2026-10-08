import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/client";
import { asStringArray } from "@/lib/utils/string-list";
import { readPublishingOptions } from "./capabilities";
import {
  deleteSchedulerMedia,
  ownsSchedulerMedia,
  schedulerStorageConfigured,
  schedulerStorageBucketName,
} from "./storage";

// Allow Meta's confirmed publication to settle and every upload URL to expire.
export const MEDIA_CLEANUP_GRACE_MS = 16 * 60_000;
export async function runMediaCleanupTick(
  options: { db?: typeof prisma; remove?: typeof deleteSchedulerMedia } = {},
) {
  const db = options.db ?? prisma;
  const remove = options.remove ?? deleteSchedulerMedia;
  if (!options.remove && !schedulerStorageConfigured()) return false;
  const bucketName = options.remove
    ? process.env.B2_BUCKET_NAME
    : await schedulerStorageBucketName();
  const now = new Date();
  const published = await db.scheduledPost.findMany({
    where: {
      status: "PUBLISHED",
      publishedAt: { lte: new Date(now.getTime() - MEDIA_CLEANUP_GRACE_MS) },
      mediaCleanupQueuedAt: null,
    },
    take: 20,
    orderBy: { publishedAt: "asc" },
  });
  for (const post of published) {
    const urls = [
      ...asStringArray(post.mediaUrls),
      readPublishingOptions(post.publishingOptions).coverUrl,
    ].filter((url) => ownsSchedulerMedia(post.workspaceId, url, bucketName));
    await db.$transaction(async (tx) => {
      for (const url of new Set(urls))
        await tx.scheduledMediaCleanup.upsert({
          where: { url },
          create: { url, workspaceId: post.workspaceId, availableAt: now },
          update: {},
        });
      await tx.scheduledPost.update({
        where: { id: post.id },
        data: { mediaCleanupQueuedAt: now },
      });
    });
  }
  // A crash during deletion must resume deletion, keeping the file locked against reuse.
  const candidate = await db.scheduledMediaCleanup.findFirst({
    where: {
      OR: [
        { state: "PENDING", availableAt: { lte: now } },
        { state: "DELETING", leaseExpiresAt: { lt: now } },
      ],
    },
    orderBy: { availableAt: "asc" },
  });
  if (!candidate) return published.length > 0;
  const owner = randomUUID();
  const claimed = await db.$transaction(async (tx) => {
    const otherPosts = await tx.scheduledPost.findMany({
      where: {
        workspaceId: candidate.workspaceId,
        OR: [
          { status: { not: "PUBLISHED" } },
          {
            publishedAt: {
              gt: new Date(now.getTime() - MEDIA_CLEANUP_GRACE_MS),
            },
          },
        ],
      },
      select: { mediaUrls: true, publishingOptions: true },
    });
    if (
      otherPosts.some(
        (post) =>
          asStringArray(post.mediaUrls).includes(candidate.url) ||
          readPublishingOptions(post.publishingOptions).coverUrl ===
            candidate.url,
      )
    ) {
      await tx.scheduledMediaCleanup.updateMany({
        where: { url: candidate.url, state: "PENDING" },
        data: { availableAt: new Date(now.getTime() + 60_000) },
      });
      return false;
    }
    const result = await tx.scheduledMediaCleanup.updateMany({
      where: {
        url: candidate.url,
        OR: [
          { state: "PENDING", availableAt: { lte: now } },
          { state: "DELETING", leaseExpiresAt: { lt: now } },
        ],
      },
      data: {
        state: "DELETING",
        leaseOwner: owner,
        leaseExpiresAt: new Date(now.getTime() + 10 * 60_000),
      },
    });
    return result.count > 0;
  });
  if (!claimed) return true;
  try {
    await remove(candidate.workspaceId, candidate.url);
    await db.scheduledMediaCleanup.updateMany({
      where: { url: candidate.url, leaseOwner: owner, state: "DELETING" },
      data: {
        state: "DELETED",
        deletedAt: new Date(),
        lastError: null,
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    });
  } catch {
    // Retain the lock until deletion succeeds; do not resurrect partially removed files.
    await db.scheduledMediaCleanup.updateMany({
      where: { url: candidate.url, leaseOwner: owner },
      data: {
        attempts: { increment: 1 },
        lastError: "Storage cleanup failed; deletion will retry automatically.",
        leaseOwner: null,
        leaseExpiresAt: new Date(
          Date.now() +
            Math.min(60, 2 ** Math.min(candidate.attempts, 6)) * 60_000,
        ),
      },
    });
  }
  return true;
}
