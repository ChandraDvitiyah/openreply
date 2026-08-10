"use client";

/**
 * Sidebar Navigation
 *
 * Compact product navigation with a consistent icon set.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  BarChart3,
  Clapperboard,
  Inbox,
  LayoutDashboard,
  Link2,
  MessagesSquare,
  ScrollText,
  Settings,
  Workflow,
  type LucideIcon,
} from "lucide-react";

const navItems: Array<{ label: string; href: string; icon: LucideIcon }> = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Views", href: "/views", icon: Clapperboard },
  { label: "Link Studio", href: "/links", icon: Link2 },
  { label: "Overview", href: "/overview", icon: BarChart3 },
  { label: "Inbox", href: "/inbox", icon: Inbox },
  { label: "Campaigns", href: "/campaigns", icon: Workflow },
  { label: "Messenger", href: "/facebook", icon: MessagesSquare },
  { label: "DM Logs", href: "/logs", icon: ScrollText },
  { label: "Settings", href: "/settings", icon: Settings },
  { label: "Diagnostics", href: "/diagnostics", icon: Activity },
];

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  workspaceName: string;
}

export default function Sidebar({
  isOpen,
  onClose,
  workspaceName,
}: SidebarProps) {
  const pathname = usePathname();

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={`
          fixed top-0 left-0 z-50 flex h-full w-64 flex-col border-r border-[#e6e6e3] bg-white text-[#292929]
          lg:translate-x-0 lg:static lg:z-auto
          ${isOpen ? "translate-x-0" : "-translate-x-full"}
        `}
      >
        <div className="border-b border-[#e6e6e3] px-5 py-[18px]">
          <Link href="/dashboard" className="flex items-center text-[14px] font-medium">
            <span className="brand-mark !rounded-lg !bg-[#9ce069] !text-[#292929]">K</span>
            <span className="ml-3 text-[14px] font-medium">Kult</span>
          </Link>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive =
              pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                aria-current={isActive ? "page" : undefined}
                className={`
                  dashboard-nav-item flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px]
                  ${
                    isActive
                      ? "bg-[#9ce069] text-[#292929] font-medium"
                      : "text-[#5d5d5d] hover:bg-[#f3f3f0] hover:text-[#292929]"
                  }
                `}
              >
                <Icon aria-hidden="true" size={14} strokeWidth={1.8} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-[#e6e6e3] px-5 py-4">
          <p className="truncate text-[13px] font-medium text-[#292929]">{workspaceName}</p>
          <p className="mt-1 text-[12px] text-[#9e9e9e]">Your conversation OS</p>
        </div>
      </aside>
    </>
  );
}
