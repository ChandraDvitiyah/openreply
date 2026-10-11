import { NextRequest, NextResponse } from "next/server";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { getLatestPerformanceSnapshots, normalizePerformancePeriod } from "@/lib/performance/social-sync";
import type { Platform, VideoAnalyticsPost, ViewsAnalyticsResponse } from "@/lib/performance/types";

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
  const periodDays = normalizePerformancePeriod(request.nextUrl.searchParams.get("days"));
  const [instagramAccounts, facebookPages] = await Promise.all([
    prisma.instagramAccount.findMany({
      where: { workspaceId },
      orderBy: { connectedAt: "desc" },
      select: { id: true, username: true },
    }),
    prisma.facebookPage.findMany({
      where: { workspaceId },
      orderBy: { connectedAt: "desc" },
      select: { id: true, name: true },
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

  const snapshots = await getLatestPerformanceSnapshots(workspaceId, periodDays);
  const selectedAccounts = accounts.filter(account =>
    (platform === "ALL" || account.platform === platform) && (accountId === "all" || account.id === accountId)
  );
  const snapshotMap = new Map(snapshots.map(row => [`${row.platform}:${row.accountInternalId}`, row]));
  const selectedSnapshots = selectedAccounts.map(account => snapshotMap.get(`${account.platform}:${account.id}`));
  const unavailableAccounts = selectedAccounts.filter((_, index) => !selectedSnapshots[index]?.insightsAvailable).map(account => account.name);
  const syncTimes = selectedSnapshots.map(snapshot => snapshot?.capturedAt.toISOString()).filter((time): time is string => Boolean(time)).sort();
  const lastSyncedAt = syncTimes.length === selectedAccounts.length ? syncTimes[0] ?? null : null;
  const stale = selectedAccounts.length > 0 && (!lastSyncedAt || Date.now() - new Date(lastSyncedAt).getTime() > 6 * 60 * 60 * 1000 || selectedSnapshots.some(snapshot => !Array.isArray(snapshot?.videoPosts)));
  const posts = selectedSnapshots.flatMap(snapshot => Array.isArray(snapshot?.videoPosts) ? snapshot.videoPosts as VideoAnalyticsPost[] : [])
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
    lastSyncedAt,
    stale,
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
