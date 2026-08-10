"use client";

/**
 * Top Bar
 *
 * Page title, mobile hamburger, and connection status.
 */

import { usePathname } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import { Menu } from "lucide-react";

const pageTitles: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/views": "Views",
  "/links": "Link Studio",
  "/overview": "Overview",
  "/inbox": "Inbox",
  "/campaigns": "Campaigns",
  "/campaigns/new": "New Campaign",
  "/facebook": "Messenger",
  "/automations": "Campaigns",
  "/automations/new": "New Campaign",
  "/logs": "DM Logs",
  "/settings": "Settings",
  "/diagnostics": "Diagnostics",
};

interface TopBarProps {
  onMenuClick: () => void;
  instagramUsername: string | null;
  instagramAccountCount: number;
}

export default function TopBar({
  onMenuClick,
  instagramUsername,
  instagramAccountCount,
}: TopBarProps) {
  const pathname = usePathname();
  const title =
    pageTitles[pathname] ??
    (pathname.startsWith("/campaigns/") ? "Campaign" : "Dashboard");

  return (
    <header className="sticky top-0 z-30 flex min-h-16 items-center justify-between border-b border-[#e6e6e3] bg-white/95 px-4 backdrop-blur lg:px-8">
      <div className="flex items-center gap-4">
        <button
          onClick={onMenuClick}
          className="grid h-8 w-8 place-items-center rounded-lg border border-[#e6e6e3] text-[14px] text-[#5d5d5d] hover:text-[#292929] lg:hidden"
          aria-label="Toggle sidebar"
        >
          <Menu aria-hidden="true" size={14} strokeWidth={1.8} />
        </button>
        <h1 className="text-[24px] font-medium leading-none text-[#292929]">{title}</h1>
      </div>

      <div className="flex items-center gap-3">
        {instagramAccountCount > 0 ? (
          <p className="hidden text-[12px] text-[#9e9e9e] sm:block">
            {instagramAccountCount > 1
              ? `${instagramAccountCount} accounts`
              : `@${instagramUsername}`}
          </p>
        ) : (
          <a
            href="/api/instagram/connect"
            className="button-primary"
          >
            Connect Instagram
          </a>
        )}
        <UserButton />
      </div>
    </header>
  );
}
