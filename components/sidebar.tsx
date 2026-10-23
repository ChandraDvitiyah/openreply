"use client";

/**
 * Sidebar Navigation
 *
 * Compact product navigation with a consistent icon set.
 */

import Link from "next/link";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import {
  Activity,
  Bot,
  CalendarDays,
  Clapperboard,
  Inbox,
  LayoutDashboard,
  Link2,
  MessagesSquare,
  ScrollText,
  Settings,
  Search,
  Globe2,
  X,
  Workflow,
  type LucideIcon,
} from "lucide-react";

const navItems: Array<{ label: string; href: string; icon: LucideIcon }> = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Schedule", href: "/scheduler", icon: CalendarDays },
  { label: "Views", href: "/views", icon: Clapperboard },
  { label: "Link Studio", href: "/links", icon: Link2 },
  { label: "Inbox", href: "/inbox", icon: Inbox },
  { label: "Campaigns", href: "/campaigns", icon: Workflow },
  { label: "Messenger", href: "/facebook", icon: MessagesSquare },
  { label: "DM Logs", href: "/logs", icon: ScrollText },
  { label: "Settings", href: "/settings", icon: Settings },
  { label: "AI agents", href: "/agents", icon: Bot },
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
  const isSeo = pathname === "/seo" || pathname.startsWith("/seo/");
  const sidebarRef = useRef<HTMLElement>(null);
  const items = isSeo
    ? [{ label: "Bulk DR Checker", href: "/seo/bulk-dr-checker", icon: Globe2 }]
    : navItems;

  useEffect(() => {
    if (!isOpen) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const desktop = window.matchMedia("(min-width: 1024px)");
    const handleResize = () => { if (desktop.matches) onClose(); };
    desktop.addEventListener("change", handleResize);
    const sidebar = sidebarRef.current;
    const focusable = () => Array.from(sidebar?.querySelectorAll<HTMLElement>('a[href], button') ?? [])
      .filter((element) => element.getClientRects().length > 0);
    focusable()[0]?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab") return;
      const elements = focusable();
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first?.focus();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
      desktop.removeEventListener("change", handleResize);
      previousFocus?.focus();
    };
  }, [isOpen, onClose]);

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
        ref={sidebarRef}
        aria-label="Workspace navigation"
        role={isOpen ? "dialog" : undefined}
        aria-modal={isOpen ? true : undefined}
        className={`
          fixed top-0 left-0 z-50 flex h-dvh w-[304px] max-w-[calc(100vw-24px)] shrink-0 border-r border-[#e6e6e3] bg-white text-[#292929]
          lg:visible lg:translate-x-0 lg:static lg:z-auto
          ${isOpen ? "visible translate-x-0" : "invisible -translate-x-full"}
        `}
      >
        <nav aria-label="Work areas" className="flex w-[72px] shrink-0 flex-col items-center gap-2 border-r border-[#e6e6e3] bg-[#f7f7f5] px-2 py-4">
          <Link href="/dashboard" onClick={onClose} aria-label="Kult home" className="mb-4 grid h-8 w-8 place-items-center rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4">
            <span className="brand-mark !h-8 !w-8 !rounded-lg !bg-[#292929] !text-[#9ce069]">K</span>
          </Link>
          {[
            { label: "Social Media", short: "Social", href: "/dashboard", icon: MessagesSquare, active: !isSeo },
            { label: "SEO", short: "SEO", href: "/seo/bulk-dr-checker", icon: Search, active: isSeo },
          ].map(({ label, short, href, icon: Icon, active }) => (
            <Link key={href} href={href} onClick={onClose} title={label} aria-label={label} aria-current={active ? "true" : undefined}
              className={`flex w-full flex-col items-center gap-2 rounded-lg px-1 py-3 text-[12px] focus-visible:outline-2 focus-visible:outline-offset-2 ${active ? "bg-white font-medium text-[#292929] ring-1 ring-[#e6e6e3]" : "text-[#5d5d5d] hover:bg-white/60 hover:text-[#292929]"}`}>
              <Icon aria-hidden="true" size={14} strokeWidth={1.8} />
              <span>{short}</span>
            </Link>
          ))}
          <span className="mt-auto grid h-9 w-9 place-items-center rounded-full border border-[#e6e6e3] bg-white text-[12px] font-medium" title={workspaceName} aria-label={workspaceName}>
            {workspaceName.slice(0, 2).toUpperCase()}
          </span>
        </nav>

        <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex min-h-16 items-center justify-between px-5">
          <div>
            <p className="text-[14px] font-medium">{isSeo ? "SEO" : "Social Media"}</p>
            <p className="mt-1 text-[12px] text-[#9e9e9e]">{isSeo ? "Search & authority" : "Your social workspace"}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close sidebar" className="grid h-8 w-8 place-items-center rounded-lg hover:bg-[#f3f3f0] lg:hidden"><X aria-hidden="true" size={14} strokeWidth={1.8} /></button>
        </div>

        <nav aria-label={isSeo ? "SEO tools" : "Social Media tools"} className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {isSeo && <p className="mb-3 px-3 text-[12px] text-[#9e9e9e]">TOOLS</p>}
          {items.map((item) => {
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
          <p className="mt-1 text-[12px] text-[#9e9e9e]">{isSeo ? "Grow your search presence" : "Your conversation OS"}</p>
        </div>
        </div>
      </aside>
    </>
  );
}
