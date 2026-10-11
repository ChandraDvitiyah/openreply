import { afterEach, describe, expect, it, vi } from "vitest";
import { createDashboardDataCache } from "@/lib/performance/dashboard-cache";
afterEach(() => vi.unstubAllGlobals());
describe("shared dashboard refresh", () => {
  it("deduplicates refreshes and invalidates every matching Views filter and Overview", async () => {
    let complete!: (response: Response) => void;
    const fetcher = vi.fn(() => new Promise<Response>(resolve => { complete = resolve; }));
    vi.stubGlobal("fetch", fetcher);
    const cache = createDashboardDataCache();
    const listener = vi.fn();
    cache.subscribe(listener);
    cache.set("performance:30", { old: true });
    cache.set("views:ALL:all:30", { old: true });
    cache.set("views:INSTAGRAM:ig:30", { old: true });
    cache.set("views:ALL:all:7", { keep: true });
    cache.set("performance:7", { keep: true });
    const overview = cache.syncPerformance(30);
    const views = cache.syncPerformance(30, true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    complete(Response.json({ success: true, data: { synced: 2, failed: 0 } }));
    expect(await overview).toEqual(await views);
    expect(cache.get("performance:30")).toBeNull();
    expect(cache.get("views:ALL:all:30")).toBeNull();
    expect(cache.get("views:INSTAGRAM:ig:30")).toBeNull();
    expect(cache.get("views:ALL:all:7")).toEqual({ keep: true });
    expect(cache.get("performance:7")).toEqual({ keep: true });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(cache.revision(30)).toBe(1);
    await cache.syncPerformance(30);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("keeps saved data on a failed request and lets the next refresh retry", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ success: false, error: "Unavailable" }, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ success: true, data: { synced: 1, failed: 1 } }))
      .mockResolvedValueOnce(Response.json({ success: true, data: { synced: 2, failed: 0 } }));
    vi.stubGlobal("fetch", fetcher);
    const cache = createDashboardDataCache();
    cache.set("performance:30", "saved");
    await expect(cache.syncPerformance(30)).rejects.toThrow("Unavailable");
    expect(cache.get("performance:30")).toBe("saved");
    await cache.syncPerformance(30);
    await cache.syncPerformance(30);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
