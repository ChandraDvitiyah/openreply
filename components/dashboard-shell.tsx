"use client";

import { useState } from "react";
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

  return (
    <div className="dashboard-ui flex h-screen overflow-hidden bg-[#f7f7f5]">
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        workspaceName={workspaceName}
      />

      <div className="flex flex-1 flex-col overflow-hidden">
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
