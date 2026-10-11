import { describe, expect, it } from "vitest";
import { getViewsByPublishDay, istDateKey } from "@/lib/performance/daily-views";
import type { VideoAnalyticsPost } from "@/lib/performance/types";

const video = (publishedAt: string, views: number | null): VideoAnalyticsPost => ({
  id: publishedAt, platform: "INSTAGRAM", accountId: "account", accountName: "Creator",
  title: "Video", permalink: null, thumbnailUrl: null, mediaType: "REELS",
  publishedAt, views, reach: null, likes: 0, comments: 0, saves: null, shares: 0, interactions: 0,
});
const capturedAt = new Date("2026-10-11T12:00:00Z");

describe("IST publication-day views", () => {
  it("changes the date at 18:30 UTC, including month/year boundaries", () => {
    expect(istDateKey(new Date("2026-12-31T18:29:59Z"))).toBe("2026-12-31");
    expect(istDateKey(new Date("2026-12-31T18:30:00Z"))).toBe("2027-01-01");
    expect(istDateKey(new Date("2026-01-31T18:30:00Z"))).toBe("2026-02-01");
  });
  it("groups lifetime totals by IST publication day and fills empty days", () => {
    const daily = getViewsByPublishDay([
      video("2026-10-10T18:29:59Z", 12),
      video("2026-10-10T18:30:00Z", 20),
      video("2026-10-11T00:30:00Z", 8),
    ], 7, capturedAt);
    expect(daily).toHaveLength(8); // 7 rolling days intersect 8 IST dates.
    expect(daily[0]).toEqual({ date: "2026-10-04", views: 0, videos: 0, partial: false });
    expect(daily.at(-2)).toEqual({ date: "2026-10-10", views: 12, videos: 1, partial: false });
    expect(daily.at(-1)).toEqual({ date: "2026-10-11", views: 28, videos: 2, partial: false });
    expect(daily.reduce((sum, point) => sum + (point.views ?? 0), 0)).toBe(40);
  });
  it("keeps unavailable and partial views distinct from genuine zero", () => {
    const daily = getViewsByPublishDay([
      video("2026-10-10T01:00:00Z", null),
      video("2026-10-11T01:00:00Z", null),
      video("2026-10-11T02:00:00Z", 9),
    ], 7, capturedAt);
    expect(daily.at(-2)).toMatchObject({ views: null, partial: true });
    expect(daily.at(-1)).toMatchObject({ views: 9, partial: true });
    expect(getViewsByPublishDay([], 30, capturedAt, false).every(day => day.views === null && day.partial)).toBe(true);
  });
  it("preserves all selected totals when account snapshots have different ages", () => {
    const daily = getViewsByPublishDay([
      video("2026-10-03T12:00:00Z", 11),
      video("2026-10-12T12:00:00Z", 19),
    ], 7, capturedAt);
    expect(daily[0].date).toBe("2026-10-03");
    expect(daily.at(-1)?.date).toBe("2026-10-12");
    expect(daily.reduce((sum, day) => sum + (day.views ?? 0), 0)).toBe(30);
  });
});
