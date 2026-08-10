import { NextRequest, NextResponse } from "next/server";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import {
  getMediaInsights,
  getUserMediaSince,
  type InstagramMedia,
} from "@/lib/meta/client";
import {
  getFacebookPagePosts,
  getFacebookPostViews,
  type FacebookPagePost,
} from "@/lib/meta/facebook";
import { decryptToken } from "@/lib/meta/oauth";

export const maxDuration = 60;

type Platform = "INSTAGRAM" | "FACEBOOK";

export type VideoAnalyticsPost = {
  id: string;
  platform: Platform;
  accountId: string;
  accountName: string;
  title: string;
  permalink: string | null;
  thumbnailUrl: string | null;
  mediaType: string;
  publishedAt: string;
  views: number | null;
  reach: number | null;
  likes: number;
  comments: number;
  saves: number | null;
  shares: number;
  interactions: number;
};

export type ViewsAnalyticsResponse = {
  periodDays: number;
  accounts: Array<{ id: string; platform: Platform; name: string }>;
  totals: {
    videos: number;
    views: number;
    reach: number;
    likes: number;
    comments: number;
    saves: number;
    shares: number;
    interactions: number;
  };
  platforms: Array<{
    platform: Platform;
    videos: number;
    views: number;
    comments: number;
    shares: number;
    interactions: number;
  }>;
  posts: VideoAnalyticsPost[];
  unavailableAccounts: string[];
};

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T) => Promise<R>
) {
  const output = new Array<R>(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      output[index] = await mapper(items[index]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker())
  );
  return output;
}

function isInstagramVideo(media: InstagramMedia) {
  return media.media_product_type === "REELS" || media.media_type === "VIDEO";
}

function isFacebookVideo(post: FacebookPagePost) {
  return (post.attachments?.data ?? []).some((attachment) => {
    const descriptor = `${attachment.media_type ?? ""} ${attachment.type ?? ""}`;
    return /video|reel/i.test(descriptor);
  });
}

function postTitle(value: string | undefined, fallback: string) {
  const normalized = value?.replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, 140) : fallback;
}

export async function GET(request: NextRequest) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const requestedPlatform = request.nextUrl.searchParams.get("platform")?.toUpperCase();
  const platform: Platform | "ALL" =
    requestedPlatform === "INSTAGRAM" || requestedPlatform === "FACEBOOK"
      ? requestedPlatform
      : "ALL";
  const accountId = request.nextUrl.searchParams.get("accountId") ?? "all";
  const requestedDays = Number(request.nextUrl.searchParams.get("days"));
  const periodDays = [7, 30, 90].includes(requestedDays) ? requestedDays : 30;
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - periodDays);

  const [instagramAccounts, facebookPages] = await Promise.all([
    prisma.instagramAccount.findMany({
      where: { workspaceId },
      orderBy: { connectedAt: "desc" },
    }),
    prisma.facebookPage.findMany({
      where: { workspaceId },
      orderBy: { connectedAt: "desc" },
    }),
  ]);

  const accounts: ViewsAnalyticsResponse["accounts"] = [
    ...instagramAccounts.map((account) => ({
      id: account.id,
      platform: "INSTAGRAM" as const,
      name: `@${account.username}`,
    })),
    ...facebookPages.map((page) => ({
      id: page.id,
      platform: "FACEBOOK" as const,
      name: page.name,
    })),
  ];

  const unavailableAccounts: string[] = [];
  const jobs: Array<Promise<VideoAnalyticsPost[]>> = [];

  if (platform !== "FACEBOOK") {
    for (const account of instagramAccounts) {
      if (accountId !== "all" && account.id !== accountId) continue;
      jobs.push((async () => {
        try {
          const accessToken = decryptToken(account.accessToken);
          const media = (await getUserMediaSince(accessToken, since, 100))
            .filter(isInstagramVideo)
            .slice(0, 50);
          const insights = await mapWithConcurrency(media, 8, async (item) => {
            try {
              return await getMediaInsights(accessToken, item.id, [
                "views",
                "reach",
                "saved",
                "shares",
                "total_interactions",
              ]);
            } catch {
              return null;
            }
          });

          return media.map((item, index) => {
            const insight = insights[index];
            const likes = item.like_count ?? 0;
            const comments = item.comments_count ?? 0;
            const saves = insight?.saved ?? null;
            const shares = insight?.shares ?? 0;
            return {
              id: item.id,
              platform: "INSTAGRAM" as const,
              accountId: account.id,
              accountName: `@${account.username}`,
              title: postTitle(item.caption, "Instagram video"),
              permalink: item.permalink ?? null,
              thumbnailUrl: item.thumbnail_url ?? item.media_url ?? null,
              mediaType: item.media_product_type ?? item.media_type,
              publishedAt: item.timestamp,
              views: insight?.views ?? null,
              reach: insight?.reach ?? null,
              likes,
              comments,
              saves,
              shares,
              interactions:
                insight?.total_interactions ?? likes + comments + (saves ?? 0) + shares,
            };
          });
        } catch {
          unavailableAccounts.push(`@${account.username}`);
          return [];
        }
      })());
    }
  }

  if (platform !== "INSTAGRAM") {
    for (const page of facebookPages) {
      if (accountId !== "all" && page.id !== accountId) continue;
      jobs.push((async () => {
        try {
          const accessToken = decryptToken(page.accessToken);
          const posts = (await getFacebookPagePosts(page.pageId, accessToken, since, 100))
            .filter(isFacebookVideo)
            .slice(0, 50);
          const viewCounts = await mapWithConcurrency(posts, 6, (post) =>
            getFacebookPostViews(post.id, accessToken)
          );

          return posts.map((post, index) => {
            const attachment = post.attachments?.data?.[0];
            const likes = post.reactions?.summary?.total_count ?? 0;
            const comments = post.comments?.summary?.total_count ?? 0;
            const shares = post.shares?.count ?? 0;
            return {
              id: post.id,
              platform: "FACEBOOK" as const,
              accountId: page.id,
              accountName: page.name,
              title: postTitle(post.message ?? attachment?.title, "Facebook video"),
              permalink: post.permalink_url ?? attachment?.url ?? attachment?.target?.url ?? null,
              thumbnailUrl: post.full_picture ?? attachment?.media?.image?.src ?? null,
              mediaType: /reel/i.test(attachment?.type ?? "") ? "REEL" : "VIDEO",
              publishedAt: post.created_time,
              views: viewCounts[index],
              reach: null,
              likes,
              comments,
              saves: null,
              shares,
              interactions: likes + comments + shares,
            };
          });
        } catch {
          unavailableAccounts.push(page.name);
          return [];
        }
      })());
    }
  }

  const posts = (await Promise.all(jobs))
    .flat()
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());

  const totals = posts.reduce<ViewsAnalyticsResponse["totals"]>(
    (sum, post) => ({
      videos: sum.videos + 1,
      views: sum.views + (post.views ?? 0),
      reach: sum.reach + (post.reach ?? 0),
      likes: sum.likes + post.likes,
      comments: sum.comments + post.comments,
      saves: sum.saves + (post.saves ?? 0),
      shares: sum.shares + post.shares,
      interactions: sum.interactions + post.interactions,
    }),
    { videos: 0, views: 0, reach: 0, likes: 0, comments: 0, saves: 0, shares: 0, interactions: 0 }
  );

  const platforms = (["INSTAGRAM", "FACEBOOK"] as const).map((item) => {
    const platformPosts = posts.filter((post) => post.platform === item);
    return {
      platform: item,
      videos: platformPosts.length,
      views: platformPosts.reduce((sum, post) => sum + (post.views ?? 0), 0),
      comments: platformPosts.reduce((sum, post) => sum + post.comments, 0),
      shares: platformPosts.reduce((sum, post) => sum + post.shares, 0),
      interactions: platformPosts.reduce((sum, post) => sum + post.interactions, 0),
    };
  });

  const data: ViewsAnalyticsResponse = {
    periodDays,
    accounts,
    totals,
    platforms,
    posts,
    unavailableAccounts,
  };
  return NextResponse.json(
    { success: true, data },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
