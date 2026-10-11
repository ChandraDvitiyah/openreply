import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ ig: vi.fn(), fb: vi.fn(), upsert: vi.fn(), snapshots: vi.fn(), media: vi.fn(), insights: vi.fn(), posts: vi.fn(), pageInsight: vi.fn(), postViews: vi.fn(), decrypt: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ prisma: { instagramAccount: { findMany: mocks.ig }, facebookPage: { findMany: mocks.fb }, socialPerformanceSnapshot: { upsert: mocks.upsert, findMany: mocks.snapshots } } }));
vi.mock("@/lib/meta/oauth", () => ({ decryptToken: mocks.decrypt }));
vi.mock("@/lib/meta/client", () => ({ getUserMediaSince: mocks.media, getMediaInsights: mocks.insights, PermissionError: class extends Error {} }));
vi.mock("@/lib/meta/facebook", () => ({ getFacebookPagePosts: mocks.posts, getFacebookPageInsightTotal: mocks.pageInsight, getFacebookPostViews: mocks.postViews }));
import { getLatestPerformanceSnapshots, syncWorkspacePerformance } from "@/lib/performance/social-sync";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.ig.mockResolvedValue([{ id: "ig", username: "creator", instagramId: "external", accessToken: "encrypted" }]);
  mocks.fb.mockResolvedValue([]);
  mocks.decrypt.mockReturnValue("token");
  mocks.upsert.mockResolvedValue({});
  mocks.media.mockResolvedValue([{ id: "reel", media_type: "VIDEO", media_product_type: "REELS", timestamp: "2026-10-10T00:00:00Z", like_count: 3, comments_count: 2 }]);
  mocks.insights.mockResolvedValue({ views: 100, reach: 50, saved: 4, shares: 5, total_interactions: 14 });
});
describe("shared Meta performance pipeline", () => {
  it("loads video payloads only from each account's latest snapshot", async () => {
    mocks.snapshots.mockResolvedValueOnce([
      { id: "new", platform: "INSTAGRAM", accountInternalId: "ig" },
      { id: "fb", platform: "FACEBOOK", accountInternalId: "fb" },
      { id: "old", platform: "INSTAGRAM", accountInternalId: "ig" },
    ]).mockResolvedValueOnce([{ id: "new" }, { id: "fb" }]);
    expect(await getLatestPerformanceSnapshots("workspace", 30)).toEqual([{ id: "new" }, { id: "fb" }]);
    expect(mocks.snapshots.mock.calls[0][0].select).toEqual({ id: true, platform: true, accountInternalId: true });
    expect(mocks.snapshots.mock.calls[1][0].where).toEqual({ workspaceId: "workspace", periodDays: 30, id: { in: ["new", "fb"] } });
  });
  it("saves video details and aggregate metrics together from one insight fetch", async () => {
    expect(await syncWorkspacePerformance("workspace", 30)).toMatchObject({ synced: 1, failed: 0 });
    expect(mocks.media).toHaveBeenCalledTimes(1);
    expect(mocks.insights).toHaveBeenCalledTimes(1);
    const snapshot = mocks.upsert.mock.calls[0][0];
    expect(snapshot.create).toMatchObject({ workspaceId: "workspace", views: 100, contentCount: 1, videoPosts: [{ id: "reel", views: 100, likes: 3, comments: 2, saves: 4, shares: 5, interactions: 14 }] });
    expect(snapshot.update.videoPosts).toEqual(snapshot.create.videoPosts);
  });
  it("refreshes Facebook video details in the same account snapshot", async () => {
    mocks.ig.mockResolvedValue([]);
    mocks.fb.mockResolvedValue([{ id: "fb", name: "Page", pageId: "external-page", accessToken: "encrypted" }]);
    mocks.posts.mockResolvedValue([{ id: "post", created_time: "2026-10-10T00:00:00Z", attachments: { data: [{ type: "video_inline", media_type: "video" }] }, reactions: { summary: { total_count: 3 } }, comments: { summary: { total_count: 2 } }, shares: { count: 1 } }]);
    mocks.pageInsight.mockResolvedValue(200);
    mocks.postViews.mockResolvedValue(90);
    await syncWorkspacePerformance("workspace", 7);
    expect(mocks.upsert.mock.calls[0][0].create).toMatchObject({ periodDays: 7, views: 200, videoPosts: [{ platform: "FACEBOOK", views: 90, likes: 3, comments: 2 }] });
  });
  it("retains the last saved account snapshot when an account fetch fails", async () => {
    mocks.media.mockRejectedValue(new Error("Meta unavailable"));
    expect(await syncWorkspacePerformance("workspace", 30)).toMatchObject({ synced: 0, failed: 1 });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
});
