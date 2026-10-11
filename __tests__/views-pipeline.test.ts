import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ workspace: vi.fn(), instagram: vi.fn(), facebook: vi.fn(), snapshots: vi.fn(), media: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentWorkspaceId: mocks.workspace }));
vi.mock("@/lib/db/client", () => ({ prisma: { instagramAccount: { findMany: mocks.instagram }, facebookPage: { findMany: mocks.facebook } } }));
vi.mock("@/lib/performance/social-sync", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/performance/social-sync")>(), getLatestPerformanceSnapshots: mocks.snapshots }));
vi.mock("@/lib/meta/client", () => ({ getUserMediaSince: mocks.media }));
import { GET } from "@/app/api/views/route";

const video = (id: string, platform = "INSTAGRAM", accountId = "ig") => ({ id, platform, accountId, accountName: "test", title: id, permalink: null, thumbnailUrl: null, mediaType: "VIDEO", publishedAt: new Date().toISOString(), views: 42, reach: null, likes: 2, comments: 1, saves: null, shares: 3, interactions: 6 });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.workspace.mockResolvedValue("workspace");
  mocks.instagram.mockResolvedValue([{ id: "ig", username: "creator" }]);
  mocks.facebook.mockResolvedValue([{ id: "fb", name: "Page" }]);
  mocks.snapshots.mockResolvedValue([
    { platform: "INSTAGRAM", accountInternalId: "ig", capturedAt: new Date(), insightsAvailable: true, videoPosts: [video("reel")] },
    { platform: "FACEBOOK", accountInternalId: "fb", capturedAt: new Date(), insightsAvailable: true, videoPosts: [video("fb-video", "FACEBOOK", "fb")] },
  ]);
});
describe("Views shared performance source", () => {
  it("reads stored post metrics from the same workspace/window without calling Meta", async () => {
    const response = await GET(new NextRequest("http://localhost/api/views?days=7"));
    const { data } = await response.json();
    expect(data.totals).toMatchObject({ videos: 2, views: 84, interactions: 12 });
    expect(data.dailyViews.reduce((sum: number, day: { views: number | null }) => sum + (day.views ?? 0), 0)).toBe(84);
    expect(data.stale).toBe(false);
    expect(mocks.snapshots).toHaveBeenCalledWith("workspace", 7);
    expect(mocks.media).not.toHaveBeenCalled();
  });
  it("filters by platform and account and excludes disconnected snapshots", async () => {
    mocks.snapshots.mockResolvedValueOnce([
      { platform: "INSTAGRAM", accountInternalId: "ig", capturedAt: new Date(), insightsAvailable: true, videoPosts: [video("reel")] },
      { platform: "INSTAGRAM", accountInternalId: "disconnected", capturedAt: new Date(), insightsAvailable: true, videoPosts: [video("old")] },
    ]);
    const { data } = await (await GET(new NextRequest("http://localhost/api/views?platform=INSTAGRAM&accountId=ig"))).json();
    expect(data.posts.map((p: { id: string }) => p.id)).toEqual(["reel"]);
    expect(data.totals.views).toBe(42);
    expect(data.dailyViews.reduce((sum: number, day: { videos: number }) => sum + day.videos, 0)).toBe(1);
  });
  it("marks legacy or missing snapshots for refresh", async () => {
    mocks.snapshots.mockResolvedValue([{ platform: "INSTAGRAM", accountInternalId: "ig", capturedAt: new Date(), insightsAvailable: true, videoPosts: null }]);
    const { data } = await (await GET(new NextRequest("http://localhost/api/views"))).json();
    expect(data.stale).toBe(true);
    expect(data.lastSyncedAt).toBeNull();
    expect(data.unavailableAccounts).toEqual(["Page"]);
    expect(data.posts).toEqual([]);
    expect(data.dailyViews.every((day: { views: number | null }) => day.views === null)).toBe(true);
  });
  it("rejects unauthenticated access before reading data", async () => {
    mocks.workspace.mockResolvedValue(null);
    expect((await GET(new NextRequest("http://localhost/api/views"))).status).toBe(401);
    expect(mocks.snapshots).not.toHaveBeenCalled();
  });
});
