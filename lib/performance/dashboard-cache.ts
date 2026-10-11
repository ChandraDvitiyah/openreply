export type PerformanceSyncResult = { synced: number; failed: number };

export function createDashboardDataCache() {
  const entries = new Map<string, unknown>();
  const revisions = new Map<number, number>();
  const listeners = new Set<() => void>();
  const syncs = new Map<number, Promise<PerformanceSyncResult>>();
  const syncedAt = new Map<number, number>();
  const lastResults = new Map<number, PerformanceSyncResult>();

  return {
    get<T>(key: string): T | null { return (entries.get(key) as T | undefined) ?? null; },
    set<T>(key: string, value: T) { entries.set(key, value); },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    revision(days: number) { return revisions.get(days) ?? 0; },
    syncResult(days: number) { return lastResults.get(days) ?? null; },
    async syncPerformance(days: number, force = false): Promise<PerformanceSyncResult> {
      const running = syncs.get(days);
      if (running) return running;
      if (!force && Date.now() - (syncedAt.get(days) ?? 0) < 6 * 60 * 60 * 1000) {
        return lastResults.get(days)!;
      }
      const job = (async () => {
        const response = await fetch(`/api/dashboard/performance/sync?days=${days}`, { method: "POST", cache: "no-store" });
        const body = await response.json();
        if (!response.ok || !body.success) throw new Error(body.error ?? "Could not refresh Meta insights");
        for (const key of entries.keys()) {
          if (key === `performance:${days}` || (key.startsWith("views:") && key.endsWith(`:${days}`))) entries.delete(key);
        }
        if (body.data.failed === 0) syncedAt.set(days, Date.now());
        else syncedAt.delete(days);
        lastResults.set(days, body.data);
        revisions.set(days, (revisions.get(days) ?? 0) + 1);
        listeners.forEach(listener => listener());
        return body.data;
      })();
      syncs.set(days, job);
      try { return await job; } finally { syncs.delete(days); }
    },
  };
}
