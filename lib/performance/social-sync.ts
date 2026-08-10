import { prisma } from "@/lib/db/client";
import {
  getAllUserMedia,
  getMediaInsights,
  PermissionError,
  type InstagramMedia,
} from "@/lib/meta/client";
import {
  getFacebookPageInsightTotal,
  getFacebookPagePosts,
} from "@/lib/meta/facebook";
import { decryptToken } from "@/lib/meta/oauth";

export const PERFORMANCE_PERIODS = [7, 30, 90] as const;
export type PerformancePeriod = (typeof PERFORMANCE_PERIODS)[number];

export function normalizePerformancePeriod(value: string | null): PerformancePeriod {
  const parsed = Number(value);
  return PERFORMANCE_PERIODS.includes(parsed as PerformancePeriod)
    ? (parsed as PerformancePeriod)
    : 30;
}

type SnapshotMetrics = {
  contentCount: number;
  views: number | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  saves: number | null;
  shares: number | null;
  interactions: number | null;
  insightsAvailable: boolean;
};

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
) {
  const output = new Array<R>(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      output[index] = await fn(items[index]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker())
  );
  return output;
}

function isVideoLike(media: InstagramMedia) {
  return media.media_product_type === "REELS" || media.media_type === "VIDEO";
}

async function getInstagramMetrics(
  encryptedToken: string,
  since: Date
): Promise<SnapshotMetrics> {
  const accessToken = decryptToken(encryptedToken);
  const recentMedia = (await getAllUserMedia(accessToken, 250)).filter(
    (item) => new Date(item.timestamp) >= since
  );
  let permissionDenied = false;

  const insights = await mapWithConcurrency(recentMedia, 6, async (media) => {
    const metrics = isVideoLike(media)
      ? ["views", "reach", "saved", "shares", "total_interactions"]
      : ["reach", "saved", "shares", "total_interactions"];
    try {
      return await getMediaInsights(accessToken, media.id, metrics);
    } catch (error) {
      if (error instanceof PermissionError) permissionDenied = true;
      return null;
    }
  });

  return recentMedia.reduce<SnapshotMetrics>(
    (total, media, index) => {
      const insight = insights[index];
      const likes = media.like_count ?? 0;
      const comments = media.comments_count ?? 0;
      total.contentCount += 1;
      total.views = (total.views ?? 0) + (insight?.views ?? 0);
      total.reach = (total.reach ?? 0) + (insight?.reach ?? 0);
      total.likes = (total.likes ?? 0) + likes;
      total.comments = (total.comments ?? 0) + comments;
      total.saves = (total.saves ?? 0) + (insight?.saved ?? 0);
      total.shares = (total.shares ?? 0) + (insight?.shares ?? 0);
      total.interactions =
        (total.interactions ?? 0) +
        (insight?.total_interactions ??
          likes + comments + (insight?.saved ?? 0) + (insight?.shares ?? 0));
      total.insightsAvailable ||= Boolean(insight) && !permissionDenied;
      return total;
    },
    {
      contentCount: 0,
      views: 0,
      reach: 0,
      likes: 0,
      comments: 0,
      saves: 0,
      shares: 0,
      interactions: 0,
      insightsAvailable: false,
    }
  );
}

async function getFacebookMetrics(
  pageId: string,
  encryptedToken: string,
  since: Date,
  until: Date
): Promise<SnapshotMetrics> {
  const accessToken = decryptToken(encryptedToken);
  const [posts, views, reach, pageEngagements] = await Promise.all([
    getFacebookPagePosts(pageId, accessToken, since),
    getFacebookPageInsightTotal(pageId, accessToken, "page_impressions", since, until),
    getFacebookPageInsightTotal(
      pageId,
      accessToken,
      "page_impressions_unique",
      since,
      until
    ),
    getFacebookPageInsightTotal(
      pageId,
      accessToken,
      "page_post_engagements",
      since,
      until
    ),
  ]);

  const postTotals = posts.reduce(
    (total, post) => {
      total.likes += post.reactions?.summary?.total_count ?? 0;
      total.comments += post.comments?.summary?.total_count ?? 0;
      total.shares += post.shares?.count ?? 0;
      return total;
    },
    { likes: 0, comments: 0, shares: 0 }
  );

  return {
    contentCount: posts.length,
    views,
    reach,
    likes: postTotals.likes,
    comments: postTotals.comments,
    // Facebook does not provide a stable organic Page-post saves metric.
    saves: null,
    shares: postTotals.shares,
    interactions:
      pageEngagements ??
      postTotals.likes + postTotals.comments + postTotals.shares,
    insightsAvailable: views !== null || reach !== null,
  };
}

export async function syncWorkspacePerformance(
  workspaceId: string,
  periodDays: PerformancePeriod
) {
  const until = new Date();
  const since = new Date(until);
  since.setUTCDate(since.getUTCDate() - periodDays);
  const capturedDate = until.toISOString().slice(0, 10);
  const [instagramAccounts, facebookPages] = await Promise.all([
    prisma.instagramAccount.findMany({ where: { workspaceId } }),
    prisma.facebookPage.findMany({ where: { workspaceId } }),
  ]);

  const jobs = [
    ...instagramAccounts.map(async (account) => {
      const metrics = await getInstagramMetrics(account.accessToken, since);
      await prisma.socialPerformanceSnapshot.upsert({
        where: {
          platform_accountInternalId_periodDays_capturedDate: {
            platform: "INSTAGRAM",
            accountInternalId: account.id,
            periodDays,
            capturedDate,
          },
        },
        create: {
          workspaceId,
          platform: "INSTAGRAM",
          accountInternalId: account.id,
          accountExternalId: account.instagramId,
          accountName: `@${account.username}`,
          periodDays,
          capturedDate,
          ...metrics,
        },
        update: { accountName: `@${account.username}`, capturedAt: until, ...metrics },
      });
      return { platform: "INSTAGRAM" as const, accountId: account.id };
    }),
    ...facebookPages.map(async (page) => {
      const metrics = await getFacebookMetrics(
        page.pageId,
        page.accessToken,
        since,
        until
      );
      await prisma.socialPerformanceSnapshot.upsert({
        where: {
          platform_accountInternalId_periodDays_capturedDate: {
            platform: "FACEBOOK",
            accountInternalId: page.id,
            periodDays,
            capturedDate,
          },
        },
        create: {
          workspaceId,
          platform: "FACEBOOK",
          accountInternalId: page.id,
          accountExternalId: page.pageId,
          accountName: page.name,
          periodDays,
          capturedDate,
          ...metrics,
        },
        update: { accountName: page.name, capturedAt: until, ...metrics },
      });
      return { platform: "FACEBOOK" as const, accountId: page.id };
    }),
  ];

  const results = await Promise.allSettled(jobs);
  const failures = results.flatMap((result) =>
    result.status === "rejected" ? [String(result.reason)] : []
  );
  return {
    synced: results.length - failures.length,
    failed: failures.length,
    failures,
  };
}

export async function getLatestPerformanceSnapshots(
  workspaceId: string,
  periodDays: PerformancePeriod
) {
  const rows = await prisma.socialPerformanceSnapshot.findMany({
    where: { workspaceId, periodDays },
    orderBy: { capturedAt: "desc" },
  });
  const latest = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const key = `${row.platform}:${row.accountInternalId}`;
    if (!latest.has(key)) latest.set(key, row);
  }
  return [...latest.values()];
}

export async function syncAllWorkspacePerformance(
  periodDays: PerformancePeriod = 30
) {
  const workspaces = await prisma.workspace.findMany({
    where: {
      OR: [
        { instagramAccounts: { some: {} } },
        { facebookPages: { some: {} } },
      ],
    },
    select: { id: true },
  });
  const results = [];
  for (const workspace of workspaces) {
    try {
      const result = await syncWorkspacePerformance(workspace.id, periodDays);
      results.push({ workspaceId: workspace.id, ...result });
    } catch (error) {
      results.push({
        workspaceId: workspace.id,
        synced: 0,
        failed: 1,
        failures: [error instanceof Error ? error.message : "Unknown sync error"],
      });
    }
  }
  return results;
}
