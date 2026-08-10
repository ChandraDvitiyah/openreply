"use client";

import { createContext, useContext, useMemo, useRef } from "react";

type DashboardDataCache = {
  get<T>(key: string): T | null;
  set<T>(key: string, value: T): void;
};

const DashboardDataCacheContext = createContext<DashboardDataCache | null>(null);

export function DashboardDataCacheProvider({ children }: { children: React.ReactNode }) {
  const entries = useRef(new Map<string, unknown>());
  const cache = useMemo<DashboardDataCache>(
    () => ({
      get<T>(key: string) {
        return (entries.current.get(key) as T | undefined) ?? null;
      },
      set<T>(key: string, value: T) {
        entries.current.set(key, value);
      },
    }),
    []
  );

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
