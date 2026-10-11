"use client";

import { createContext, useContext, useMemo, useSyncExternalStore } from "react";

import { createDashboardDataCache } from "@/lib/performance/dashboard-cache";

type DashboardDataCache = ReturnType<typeof createDashboardDataCache>;

const DashboardDataCacheContext = createContext<DashboardDataCache | null>(null);

export function DashboardDataCacheProvider({ children }: { children: React.ReactNode }) {
  const cache = useMemo(() => createDashboardDataCache(), []);

  return (
    <DashboardDataCacheContext.Provider value={cache}>
      {children}
    </DashboardDataCacheContext.Provider>
  );
}

export function useDashboardDataCache() {
  const cache = useContext(DashboardDataCacheContext);
  if (!cache) {
    throw new Error("useDashboardDataCache must be used inside DashboardDataCacheProvider");
  }
  return cache;
}

export function usePerformanceRevision(days: number) {
  const cache = useDashboardDataCache();
  return useSyncExternalStore(cache.subscribe, () => cache.revision(days), () => 0);
}
