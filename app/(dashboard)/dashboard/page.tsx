"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  Camera,
  Eye,
  Link2,
  Megaphone,
  MessageCircle,
  MousePointerClick,
  RefreshCw,
  Send,
  Users,
  type LucideIcon,
} from "lucide-react";

type DistributionItem = { platform: string; value: number; percent: number };

type PerformanceAccount = {
  id: string;
  platform: "INSTAGRAM" | "FACEBOOK";
  name: string;
  subtitle: string | null;
  views: number | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  saves: number | null;
  shares: number | null;
  interactions: number | null;
  contentCount: number;
  dms: number;
  clicks: number;
  insightsAvailable: boolean;
  lastSyncedAt: string | null;
};

type DashboardPerformance = {
  userName: string | null;
  workspaceName: string;
  periodDays: number;
  connectedAccounts: number;
  activeAutomations: number;
  lastSyncedAt: string | null;
  stale: boolean;
  totals: {
    views: number;
    reach: number | null;
    likes: number | null;
    comments: number | null;
    saves: number | null;
    shares: number | null;
    interactions: number | null;
    dms: number;
    pageViews: number;
    uniqueVisitors: number;
    linkClicks: number;
    redirects: number;
  };
  platformDistribution: {
    views: DistributionItem[];
    dms: DistributionItem[];
  };
  linkPerformance: {
    pageViews: number;
    uniqueVisitors: number;
    bioLinkClicks: number;
    automationLinkClicks: number;
    totalClicks: number;
    redirects: number;
    bioClickRate: number;
    topLinks: Array<{ id: string; title: string; clicks: number }>;
  };
  accounts: PerformanceAccount[];
  daily: Array<{ date: string; dms: number; clicks: number; pageViews: number }>;
};

function formatNumber(value: number | null) {
  if (value === null) return "—";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString();
}

function formatSyncTime(value: string | null) {
  if (!value) return "Not synced yet";
  return `Updated ${new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string;
  value: number;
  detail: string;
  icon: LucideIcon;
}) {
  return (
    <article className="panel rounded-2xl p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[12px] text-[#5d5d5d]">{label}</p>
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#f3f3f0] text-[#292929]">
          <Icon aria-hidden="true" size={20} strokeWidth={1.7} />
        </span>
      </div>
      <p className="mt-3 text-[24px] font-medium leading-none text-[#292929]">{formatNumber(value)}</p>
      <p className="mt-2 text-[12px] text-[#9e9e9e]">{detail}</p>
    </article>
  );
}

function PlatformIcon({ platform }: { platform: string }) {
  const Icon = platform.toLowerCase().includes("instagram") ? Camera : Megaphone;
  return <Icon aria-hidden="true" size={14} strokeWidth={1.8} />;
}

function DistributionCard({
  title,
  value,
  items,
  icon: Icon,
}: {
  title: string;
  value: number;
  items: DistributionItem[];
  icon: LucideIcon;
}) {
  const colors = ["#9ce069", "#292929"];

  return (
    <article className="panel rounded-2xl p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[13px] font-medium text-[#292929]">{title}</p>
          <p className="mt-2 text-[24px] font-medium leading-none text-[#292929]">{formatNumber(value)}</p>
        </div>
        <span className="grid h-9 w-9 place-items-center rounded-lg bg-[#eff8e9] text-[#292929]">
          <Icon aria-hidden="true" size={20} strokeWidth={1.7} />
        </span>
      </div>

      <div className="mt-5 flex h-2 overflow-hidden rounded-full bg-[#eeeeeb]">
        {items.map((item, index) => (
          <span
            key={item.platform}
            className="transition-[width]"
            style={{ width: `${item.percent}%`, backgroundColor: colors[index] ?? "#9e9e9e" }}
          />
        ))}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        {items.map((item, index) => (
          <div key={item.platform} className="rounded-lg bg-[#f7f7f5] px-3 py-2.5">
            <div className="flex items-center gap-2 text-[12px] text-[#5d5d5d]">
              <span style={{ color: colors[index] === "#292929" ? "#292929" : "#5d5d5d" }}>
                <PlatformIcon platform={item.platform} />
              </span>
              <span className="truncate">{item.platform}</span>
            </div>
            <div className="mt-2 flex items-end justify-between gap-2">
              <span className="text-[14px] font-medium text-[#292929]">{formatNumber(item.value)}</span>
              <span className="text-[12px] text-[#9e9e9e]">{item.percent}%</span>
            </div>
          </div>
        ))}
      </div>
    </article>
  );
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardPerformance | null>(null);
  const [period, setPeriod] = useState(30);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoSynced = useRef(new Set<number>());

  const fetchStats = useCallback(async (days: number) => {
    const response = await fetch(`/api/dashboard/stats?days=${days}`);
    const body = await response.json();
    if (!response.ok || !body.success) throw new Error(body.error ?? "Could not load performance");
    return body.data as DashboardPerformance;
  }, []);

  const refreshMeta = useCallback(async (days: number, manual = false) => {
    if (manual) setRefreshing(true);
    try {
      const response = await fetch(`/api/dashboard/performance/sync?days=${days}`, { method: "POST" });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.error ?? "Could not refresh Meta insights");
      setStats(await fetchStats(days));
      setError(
        body.data.failed > 0
          ? `${body.data.failed} account${body.data.failed === 1 ? "" : "s"} could not be refreshed. Reconnect it in Settings if this continues.`
          : null,
      );
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "Could not refresh Meta insights");
    } finally {
      if (manual) setRefreshing(false);
    }
  }, [fetchStats]);

  useEffect(() => {
    let cancelled = false;
    fetchStats(period)
      .then(async (data) => {
        if (cancelled) return;
        setStats(data);
        setError(null);
        if (data.connectedAccounts > 0 && data.stale && !autoSynced.current.has(period)) {
          autoSynced.current.add(period);
          await refreshMeta(period);
        }
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Could not load performance");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [fetchStats, period, refreshMeta]);

  if (loading && !stats) {
    return (
      <div className="space-y-4">
        <div className="h-16 animate-pulse rounded-2xl bg-white" />
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          {[0, 1, 2, 3].map((item) => <div key={item} className="h-32 animate-pulse rounded-2xl bg-white" />)}
        </div>
        <div className="grid gap-4 xl:grid-cols-3">
          {[0, 1, 2].map((item) => <div key={item} className="h-64 animate-pulse rounded-2xl bg-white" />)}
        </div>
      </div>
    );
  }

  if (!stats) {
    return <div className="panel rounded-2xl p-8 text-center text-error">{error ?? "Performance is unavailable."}</div>;
  }

  const chartDays = stats.daily.slice(-30);
  const maxActivity = Math.max(...chartDays.map((day) => day.dms + day.clicks), 1);
  const missingInsights = stats.accounts.filter((account) => !account.insightsAvailable);
  const engagement = [
    ["Reach", stats.totals.reach],
    ["Likes / reactions", stats.totals.likes],
    ["Comments", stats.totals.comments],
    ["Saves", stats.totals.saves],
    ["Shares", stats.totals.shares],
    ["Interactions", stats.totals.interactions],
  ] as const;

  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-[24px] font-medium text-[#292929]">Performance</h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-[#9e9e9e]">
            <span>{stats.workspaceName}</span>
            <span>{stats.connectedAccounts} accounts</span>
            <span>{stats.activeAutomations} active automations</span>
            <span>{formatSyncTime(stats.lastSyncedAt)}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor="reporting-period" className="sr-only">Reporting period</label>
          <select
            id="reporting-period"
            value={period}
            onChange={(event) => {
              setLoading(true);
              setPeriod(Number(event.target.value));
            }}
            className="h-9 rounded-full border border-[#e6e6e3] bg-white px-3 text-[13px] font-medium text-[#292929]"
          >
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
          <button
            type="button"
            onClick={() => refreshMeta(period, true)}
            disabled={refreshing || stats.connectedAccounts === 0}
            className="button-secondary gap-2 disabled:cursor-not-allowed disabled:opacity-50"
            title="Refresh Meta data"
          >
            <RefreshCw aria-hidden="true" size={14} strokeWidth={1.8} className={refreshing ? "animate-spin" : ""} />
            <span className="hidden sm:inline">{refreshing ? "Refreshing" : "Refresh"}</span>
          </button>
        </div>
      </header>

      {error && (
        <div className="rounded-xl border border-[#e5b8b3] bg-[#fff4f2] px-4 py-3 text-[13px] text-error">{error}</div>
      )}

      {stats.connectedAccounts === 0 && (
        <div className="flex flex-col gap-3 rounded-2xl border border-[#dcebd2] bg-[#eff8e9] p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[14px] font-medium text-[#292929]">Connect an account to start tracking</p>
            <p className="mt-1 text-[12px] text-[#5d5d5d]">Instagram and Facebook performance will appear here after connection.</p>
          </div>
          <a href="/settings" className="button-primary shrink-0">Open settings</a>
        </div>
      )}

      <section aria-label="Key performance indicators" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <MetricCard label="Total views" value={stats.totals.views} detail={`${period}-day content views`} icon={Eye} />
        <MetricCard label="DMs sent" value={stats.totals.dms} detail="Instagram + Messenger" icon={Send} />
        <MetricCard label="Link clicks" value={stats.totals.linkClicks} detail="Bio + automated DMs" icon={MousePointerClick} />
        <MetricCard label="Page views" value={stats.totals.pageViews} detail={`${formatNumber(stats.totals.uniqueVisitors)} unique visitors`} icon={Users} />
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <DistributionCard title="Views by platform" value={stats.totals.views} items={stats.platformDistribution.views} icon={Eye} />
        <DistributionCard title="DMs by platform" value={stats.totals.dms} items={stats.platformDistribution.dms} icon={MessageCircle} />

        <article className="panel rounded-2xl p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[13px] font-medium text-[#292929]">Engagement</p>
              <p className="mt-1 text-[12px] text-[#9e9e9e]">What people did after viewing</p>
            </div>
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-[#f3f3f0]">
              <Activity aria-hidden="true" size={20} strokeWidth={1.7} />
            </span>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-x-5 gap-y-3">
            {engagement.map(([label, value]) => (
              <div key={label} className="border-t border-[#eeeeeb] pt-2.5">
                <p className="text-[12px] text-[#9e9e9e]">{label}</p>
                <p className="mt-1 text-[14px] font-medium text-[#292929]">{formatNumber(value)}</p>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <article className="panel rounded-2xl p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[14px] font-medium text-[#292929]">Link performance</p>
              <p className="mt-1 text-[12px] text-[#9e9e9e]">Traffic generated by your Kult links</p>
            </div>
            <span className="flex items-center gap-1.5 rounded-full bg-[#eff8e9] px-3 py-1.5 text-[12px] font-medium text-[#292929]">
              <Link2 aria-hidden="true" size={14} /> {stats.linkPerformance.bioClickRate}% CTR
            </span>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2">
            {[
              ["Bio clicks", stats.linkPerformance.bioLinkClicks],
              ["DM clicks", stats.linkPerformance.automationLinkClicks],
              ["Redirects", stats.linkPerformance.redirects],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-lg bg-[#f7f7f5] p-3">
                <p className="text-[12px] text-[#9e9e9e]">{label}</p>
                <p className="mt-1 text-[14px] font-medium text-[#292929]">{formatNumber(Number(value))}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 border-t border-[#eeeeeb] pt-3">
            {stats.linkPerformance.topLinks.length === 0 ? (
              <p className="text-[12px] text-[#9e9e9e]">No link clicks in this reporting period.</p>
            ) : (
              <div className="space-y-2.5">
                {stats.linkPerformance.topLinks.slice(0, 3).map((link, index) => (
                  <div key={link.id} className="flex items-center justify-between gap-4 text-[13px]">
                    <span className="min-w-0 truncate text-[#5d5d5d]"><span className="mr-2 text-[#9e9e9e]">{index + 1}</span>{link.title}</span>
                    <span className="font-medium text-[#292929]">{formatNumber(link.clicks)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </article>

        <article className="panel rounded-2xl p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[14px] font-medium text-[#292929]">DMs + clicks</p>
              <p className="mt-1 text-[12px] text-[#9e9e9e]">Daily owned activity, latest 30 days</p>
            </div>
            <span className="text-[12px] text-[#9e9e9e]">{chartDays.at(-1)?.date}</span>
          </div>
          <div className="mt-4 flex h-32 items-end gap-1">
            {chartDays.map((day) => {
              const total = day.dms + day.clicks;
              return (
                <div key={day.date} className="group relative flex h-full flex-1 items-end">
                  <div
                    className="w-full min-w-[3px] rounded-t-sm bg-[#292929] transition-colors group-hover:bg-[#9ce069]"
                    style={{ height: `${Math.max((total / maxActivity) * 100, total > 0 ? 5 : 1)}%` }}
                  />
                  <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded-lg bg-[#292929] px-2 py-1 text-[12px] text-white group-hover:block">
                    {day.date}: {day.dms} DMs · {day.clicks} clicks
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex justify-between text-[12px] text-[#9e9e9e]">
            <span>{chartDays[0]?.date}</span>
            <span>DMs and link clicks</span>
          </div>
        </article>
      </section>

      <section className="panel overflow-hidden rounded-2xl">
        <div className="flex items-center justify-between border-b border-[#e6e6e3] px-5 py-4">
          <div>
            <h2 className="text-[14px] font-medium text-[#292929]">Account performance</h2>
            <p className="mt-1 text-[12px] text-[#9e9e9e]">Every connected account, side by side</p>
          </div>
          <span className="text-[12px] text-[#9e9e9e]">{stats.accounts.length} total</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-[13px]">
            <thead className="bg-[#f7f7f5] text-left text-[12px] text-[#9e9e9e]">
              <tr>
                <th className="px-5 py-3 font-medium">Account</th>
                <th className="px-3 py-3 text-right font-medium">Views</th>
                <th className="px-3 py-3 text-right font-medium">Reach</th>
                <th className="px-3 py-3 text-right font-medium">DMs</th>
                <th className="px-3 py-3 text-right font-medium">Comments</th>
                <th className="px-3 py-3 text-right font-medium">Saves</th>
                <th className="px-3 py-3 text-right font-medium">Shares</th>
                <th className="px-5 py-3 text-right font-medium">Clicks</th>
              </tr>
            </thead>
            <tbody>
              {stats.accounts.map((account) => {
                const Icon = account.platform === "INSTAGRAM" ? Camera : Megaphone;
                return (
                  <tr key={`${account.platform}:${account.id}`} className="border-t border-[#eeeeeb] first:border-0">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <span className={`grid h-8 w-8 place-items-center rounded-lg ${account.platform === "INSTAGRAM" ? "bg-[#eff8e9]" : "bg-[#f3f3f0]"}`}>
                          <Icon aria-hidden="true" size={14} strokeWidth={1.8} />
                        </span>
                        <div>
                          <p className="font-medium text-[#292929]">{account.name}</p>
                          <p className="mt-0.5 text-[12px] text-[#9e9e9e]">{account.contentCount} posts</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3.5 text-right font-medium">{formatNumber(account.views)}</td>
                    <td className="px-3 py-3.5 text-right text-[#5d5d5d]">{formatNumber(account.reach)}</td>
                    <td className="px-3 py-3.5 text-right font-medium">{formatNumber(account.dms)}</td>
                    <td className="px-3 py-3.5 text-right text-[#5d5d5d]">{formatNumber(account.comments)}</td>
                    <td className="px-3 py-3.5 text-right text-[#5d5d5d]">{formatNumber(account.saves)}</td>
                    <td className="px-3 py-3.5 text-right text-[#5d5d5d]">{formatNumber(account.shares)}</td>
                    <td className="px-5 py-3.5 text-right text-[#5d5d5d]">{account.platform === "INSTAGRAM" ? formatNumber(account.clicks) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {missingInsights.length > 0 && stats.lastSyncedAt && (
        <section className="rounded-xl border border-[#e6e6e3] bg-white px-4 py-3 text-[13px]">
          <p className="font-medium text-[#292929]">Some Meta insight totals are unavailable.</p>
          <p className="mt-1 text-[#5d5d5d]">Reconnect {missingInsights.map((account) => account.name).join(", ")} in Settings to grant the latest insights permissions.</p>
        </section>
      )}
    </div>
  );
}
