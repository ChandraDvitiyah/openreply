import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId, getCurrentWorkspaceId } from "@/lib/auth";
import { getBioPerformance } from "@/lib/bio-db";
import { prisma } from "@/lib/db/client";
import {
  getLatestPerformanceSnapshots,
  normalizePerformancePeriod,
} from "@/lib/performance/social-sync";

function percentage(part: number, total: number) {
  return total > 0 ? Number(((part / total) * 100).toFixed(1)) : 0;
}

function addNullable(values: Array<number | null | undefined>) {
  const available = values.filter((value): value is number => value !== null && value !== undefined);
  return available.length > 0 ? available.reduce((sum, value) => sum + value, 0) : null;
}

export async function GET(request: NextRequest) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const userId = await getCurrentUserId();
  const periodDays = normalizePerformancePeriod(request.nextUrl.searchParams.get("days"));
  const now = new Date();
  const since = new Date(now);
  since.setUTCDate(since.getUTCDate() - periodDays);

  const [
    workspace,
    user,
    members,
    instagramAccounts,
    facebookPages,
    snapshots,
    instagramDmGroups,
    facebookDmGroups,
    trackedClickGroups,
    instagramDmEvents,
    facebookDmEvents,
    trackedClickEvents,
    activeInstagramAutomations,
    activeFacebookAutomations,
  ] = await Promise.all([
    prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { name: true, dmsSentThisPeriod: true },
    }),
    userId
      ? prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } })
      : Promise.resolve(null),
    prisma.workspaceMember.findMany({ where: { workspaceId }, select: { userId: true } }),
    prisma.instagramAccount.findMany({
      where: { workspaceId },
      orderBy: { connectedAt: "desc" },
      select: {
        id: true,
        instagramId: true,
        username: true,
        name: true,
        tokenExpiresAt: true,
        webhookSubscribed: true,
      },
    }),
    prisma.facebookPage.findMany({
      where: { workspaceId },
      orderBy: { connectedAt: "desc" },
      select: { id: true, pageId: true, name: true },
    }),
    getLatestPerformanceSnapshots(workspaceId, periodDays),
    prisma.dmLog.groupBy({
      by: ["instagramAccountId"],
      where: { workspaceId, status: "SENT", createdAt: { gte: since } },
      _count: { _all: true },
    }),
    prisma.facebookMessageLog.groupBy({
      by: ["facebookPageId"],
      where: { workspaceId, status: "SENT", createdAt: { gte: since } },
      _count: { _all: true },
    }),
    prisma.linkClick.groupBy({
      by: ["instagramAccountId"],
      where: { workspaceId, createdAt: { gte: since } },
      _count: { _all: true },
    }),
    prisma.dmLog.findMany({
      where: { workspaceId, status: "SENT", createdAt: { gte: since } },
      select: { createdAt: true },
    }),
    prisma.facebookMessageLog.findMany({
      where: { workspaceId, status: "SENT", createdAt: { gte: since } },
      select: { createdAt: true },
    }),
    prisma.linkClick.findMany({
      where: { workspaceId, createdAt: { gte: since } },
      select: { createdAt: true },
    }),
    prisma.automation.count({ where: { workspaceId, isActive: true } }),
    prisma.facebookAutomation.count({ where: { workspaceId, isActive: true } }),
  ]);

  const bio = await getBioPerformance(
    members.map((member) => member.userId),
    since
  );
  const instagramDmMap = new Map(
    instagramDmGroups.map((row) => [row.instagramAccountId, row._count._all])
  );
  const facebookDmMap = new Map(
    facebookDmGroups.map((row) => [row.facebookPageId, row._count._all])
  );
  const trackedClickMap = new Map(
    trackedClickGroups.map((row) => [row.instagramAccountId, row._count._all])
  );
  const snapshotMap = new Map(
    snapshots.map((row) => [`${row.platform}:${row.accountInternalId}`, row])
  );

  const accounts = [
    ...instagramAccounts.map((account) => {
      const snapshot = snapshotMap.get(`INSTAGRAM:${account.id}`);
      return {
        id: account.id,
        platform: "INSTAGRAM" as const,
        name: `@${account.username}`,
        subtitle: account.name,
        views: snapshot?.views ?? null,
        reach: snapshot?.reach ?? null,
        likes: snapshot?.likes ?? null,
        comments: snapshot?.comments ?? null,
        saves: snapshot?.saves ?? null,
        shares: snapshot?.shares ?? null,
        interactions: snapshot?.interactions ?? null,
        contentCount: snapshot?.contentCount ?? 0,
        dms: instagramDmMap.get(account.id) ?? 0,
        clicks: trackedClickMap.get(account.id) ?? 0,
        insightsAvailable: snapshot?.insightsAvailable ?? false,
        lastSyncedAt: snapshot?.capturedAt.toISOString() ?? null,
      };
    }),
    ...facebookPages.map((page) => {
      const snapshot = snapshotMap.get(`FACEBOOK:${page.id}`);
      return {
        id: page.id,
        platform: "FACEBOOK" as const,
        name: page.name,
        subtitle: "Facebook Page",
        views: snapshot?.views ?? null,
        reach: snapshot?.reach ?? null,
        likes: snapshot?.likes ?? null,
        comments: snapshot?.comments ?? null,
        saves: null,
        shares: snapshot?.shares ?? null,
        interactions: snapshot?.interactions ?? null,
        contentCount: snapshot?.contentCount ?? 0,
        dms: facebookDmMap.get(page.id) ?? 0,
        clicks: 0,
        insightsAvailable: snapshot?.insightsAvailable ?? false,
        lastSyncedAt: snapshot?.capturedAt.toISOString() ?? null,
      };
    }),
  ];

  const instagramViews = addNullable(
    accounts.filter((a) => a.platform === "INSTAGRAM").map((a) => a.views)
  ) ?? 0;
  const facebookViews = addNullable(
    accounts.filter((a) => a.platform === "FACEBOOK").map((a) => a.views)
  ) ?? 0;
  const totalViews = instagramViews + facebookViews;
  const instagramDms = instagramDmEvents.length;
  const facebookDms = facebookDmEvents.length;
  const totalDms = instagramDms + facebookDms;
  const automationLinkClicks = trackedClickEvents.length;
  const totalLinkClicks = automationLinkClicks + bio.linkClicks;

  const dailyMap = new Map<
    string,
    { date: string; dms: number; clicks: number; pageViews: number }
  >();
  for (let i = periodDays - 1; i >= 0; i--) {
    const date = new Date(now);
    date.setUTCDate(date.getUTCDate() - i);
    const key = date.toISOString().slice(0, 10);
    dailyMap.set(key, { date: key, dms: 0, clicks: 0, pageViews: 0 });
  }
  for (const event of [...instagramDmEvents, ...facebookDmEvents]) {
    const item = dailyMap.get(event.createdAt.toISOString().slice(0, 10));
    if (item) item.dms += 1;
  }
  for (const event of trackedClickEvents) {
    const item = dailyMap.get(event.createdAt.toISOString().slice(0, 10));
    if (item) item.clicks += 1;
  }
  for (const item of bio.daily) {
    const day = dailyMap.get(item.date);
    if (day) {
      day.clicks += item.clicks;
      day.pageViews += item.views;
    }
  }

  const lastSyncedAt = accounts
    .map((account) => account.lastSyncedAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null;
  const stale =
    accounts.length > 0 &&
    (!lastSyncedAt || now.getTime() - new Date(lastSyncedAt).getTime() > 6 * 60 * 60 * 1000);
  const firstName =
    user?.name?.trim().split(/\s+/)[0] || user?.email?.split("@")[0] || null;

  return NextResponse.json({
    success: true,
    data: {
      userName: firstName,
      workspaceName: workspace?.name ?? "Workspace",
      workspace: {
        name: workspace?.name ?? "Workspace",
        dmsSentThisPeriod: workspace?.dmsSentThisPeriod ?? 0,
      },
      instagramAccount: instagramAccounts[0] ?? null,
      instagramAccounts,
      periodDays,
      connectedAccounts: accounts.length,
      activeAutomations: activeInstagramAutomations + activeFacebookAutomations,
      lastSyncedAt,
      stale,
      totals: {
        views: totalViews,
        reach: addNullable(accounts.map((account) => account.reach)),
        likes: addNullable(accounts.map((account) => account.likes)),
        comments: addNullable(accounts.map((account) => account.comments)),
        saves: addNullable(accounts.map((account) => account.saves)),
        shares: addNullable(accounts.map((account) => account.shares)),
        interactions: addNullable(accounts.map((account) => account.interactions)),
        dms: totalDms,
        pageViews: bio.pageViews,
        uniqueVisitors: bio.uniqueVisitors,
        linkClicks: totalLinkClicks,
        redirects: totalLinkClicks,
      },
      platformDistribution: {
        views: [
          { platform: "Instagram", value: instagramViews, percent: percentage(instagramViews, totalViews) },
          { platform: "Facebook", value: facebookViews, percent: percentage(facebookViews, totalViews) },
        ],
        dms: [
          { platform: "Instagram", value: instagramDms, percent: percentage(instagramDms, totalDms) },
          { platform: "Facebook", value: facebookDms, percent: percentage(facebookDms, totalDms) },
        ],
      },
      linkPerformance: {
        pageViews: bio.pageViews,
        uniqueVisitors: bio.uniqueVisitors,
        bioLinkClicks: bio.linkClicks,
        automationLinkClicks,
        totalClicks: totalLinkClicks,
        redirects: totalLinkClicks,
        bioClickRate: percentage(bio.linkClicks, bio.pageViews),
        topLinks: bio.topLinks,
      },
      accounts,
      daily: [...dailyMap.values()],
    },
  });
}
