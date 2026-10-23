"use client";

import { useCallback, useState } from "react";
import Sidebar from "@/components/sidebar";
import TopBar from "@/components/top-bar";
import { DashboardDataCacheProvider } from "@/components/dashboard-data-cache";

interface DashboardShellProps {
  children: React.ReactNode;
  workspaceName: string;
  instagramUsername: string | null;
  instagramAccountCount: number;
}

export default function DashboardShell({
  children,
  workspaceName,
  instagramUsername,
  instagramAccountCount,
}: DashboardShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  return (
    <div className="dashboard-ui flex h-screen overflow-hidden bg-[#f7f7f5]">
      <Sidebar
        isOpen={sidebarOpen}
        onClose={closeSidebar}
        workspaceName={workspaceName}
      />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden" inert={sidebarOpen || undefined}>
        <TopBar
          onMenuClick={() => setSidebarOpen(true)}
          instagramUsername={instagramUsername}
          instagramAccountCount={instagramAccountCount}
        />

        <main className="flex-1 overflow-y-auto">
          <DashboardDataCacheProvider>
            <div className="mx-auto max-w-[1440px] px-4 py-6 lg:px-8 lg:py-8">{children}</div>
          </DashboardDataCacheProvider>
        </main>
      </div>
    </div>
  );
}
