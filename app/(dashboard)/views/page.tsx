"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  Camera,
  Eye,
  Heart,
  Megaphone,
  MessageCircle,
  Play,
  Share2,
} from "lucide-react";
import type {
  VideoAnalyticsPost,
  ViewsAnalyticsResponse,
} from "@/app/api/views/route";
import { useDashboardDataCache } from "@/components/dashboard-data-cache";
import { DashboardLoadingSkeleton } from "@/components/dashboard-loading-skeleton";

type PlatformFilter = "ALL" | "INSTAGRAM" | "FACEBOOK";

function viewsCacheKey(platform: PlatformFilter, accountId: string, days: number) {
  return `views:${platform}:${accountId}:${days}`;
}

function formatNumber(value: number | null) {
  if (value === null) return "—";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString();
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function PlatformMark({ platform, size = 14 }: { platform: "INSTAGRAM" | "FACEBOOK"; size?: number }) {
  const Icon = platform === "INSTAGRAM" ? Camera : Megaphone;
  return <Icon aria-hidden="true" size={size} strokeWidth={1.8} />;
}

function MetricCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number;
  icon: typeof Eye;
}) {
  return (
    <div className="panel rounded-2xl p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[12px] text-[#5d5d5d]">{label}</p>
        <Icon aria-hidden="true" size={20} strokeWidth={1.7} className="text-[#5d5d5d]" />
      </div>
      <p className="mt-3 text-[24px] font-medium leading-none text-[#292929]">{formatNumber(value)}</p>
    </div>
  );
}

function VideoRow({ post }: { post: VideoAnalyticsPost }) {
  return (
    <tr className="border-t border-[#eeeeeb] first:border-0">
      <td className="px-5 py-3.5">
        <div className="flex min-w-[260px] items-center gap-3">
          <div
            aria-hidden="true"
            className="relative h-11 w-16 shrink-0 overflow-hidden rounded-lg bg-[#f0f0ed] bg-cover bg-center"
            style={post.thumbnailUrl ? { backgroundImage: `url(${JSON.stringify(post.thumbnailUrl).slice(1, -1)})` } : undefined}
          >
            <span className="absolute inset-0 grid place-items-center bg-black/10 text-white">
              <Play size={14} fill="currentColor" />
            </span>
          </div>
          <div className="min-w-0">
            {post.permalink ? (
              <a
                href={post.permalink}
                target="_blank"
                rel="noreferrer"
                className="block max-w-[360px] truncate text-[13px] font-medium text-[#292929] hover:underline"
              >
                {post.title}
              </a>
            ) : (
              <p className="max-w-[360px] truncate text-[13px] font-medium text-[#292929]">{post.title}</p>
            )}
            <div className="mt-1 flex items-center gap-2 text-[12px] text-[#9e9e9e]">
              <PlatformMark platform={post.platform} />
              <span>{post.accountName}</span>
              <span>{post.mediaType.toLowerCase()}</span>
            </div>
          </div>
        </div>
      </td>
      <td className="px-3 py-3.5 text-right font-medium text-[#292929]">{formatNumber(post.views)}</td>
      <td className="px-3 py-3.5 text-right text-[#5d5d5d]">{formatNumber(post.reach)}</td>
      <td className="px-3 py-3.5 text-right text-[#5d5d5d]">{formatNumber(post.likes)}</td>
      <td className="px-3 py-3.5 text-right text-[#5d5d5d]">{formatNumber(post.comments)}</td>
      <td className="px-3 py-3.5 text-right text-[#5d5d5d]">{formatNumber(post.saves)}</td>
      <td className="px-3 py-3.5 text-right text-[#5d5d5d]">{formatNumber(post.shares)}</td>
      <td className="px-3 py-3.5 text-right font-medium text-[#292929]">{formatNumber(post.interactions)}</td>
      <td className="px-5 py-3.5 text-right text-[12px] text-[#9e9e9e]">{formatDate(post.publishedAt)}</td>
    </tr>
  );
}

export default function ViewsPage() {
  const dataCache = useDashboardDataCache();
  const [data, setData] = useState<ViewsAnalyticsResponse | null>(() =>
    dataCache.get<ViewsAnalyticsResponse>(viewsCacheKey("ALL", "all", 30))
  );
  const [platform, setPlatform] = useState<PlatformFilter>("ALL");
  const [accountId, setAccountId] = useState("all");
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const cacheKey = viewsCacheKey(platform, accountId, days);
    const params = new URLSearchParams({
      platform,
      accountId,
      days: String(days),
    });
    fetch(`/api/views?${params}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok || !body.success) throw new Error(body.error ?? "Could not load video analytics");
        dataCache.set(cacheKey, body.data);
        setData(body.data);
        setError(null);
      })
      .catch((loadError) => {
        if (loadError instanceof Error && loadError.name === "AbortError") return;
        setError(loadError instanceof Error ? loadError.message : "Could not load video analytics");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [platform, accountId, days, dataCache]);

  const visibleAccounts = useMemo(
    () => data?.accounts.filter((account) => platform === "ALL" || account.platform === platform) ?? [],
    [data?.accounts, platform]
  );

  function selectPlatform(next: PlatformFilter) {
    if (next === platform) return;
    let nextAccountId = accountId;
    if (accountId !== "all") {
      const selected = data?.accounts.find((account) => account.id === accountId);
      if (selected && next !== "ALL" && selected.platform !== next) nextAccountId = "all";
    }
    setData(dataCache.get<ViewsAnalyticsResponse>(viewsCacheKey(next, nextAccountId, days)));
    setLoading(true);
    setPlatform(next);
    setAccountId(nextAccountId);
  }

  if (loading && !data) {
    return <DashboardLoadingSkeleton metricCount={6} />;
  }

  return (
    <div className="space-y-4" aria-busy={loading}>
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-[24px] font-medium text-[#292929]">Video analytics</h1>
          <p className="mt-1 text-[13px] text-[#5d5d5d]">Compare Reel and video performance across every connected account.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-full border border-[#e6e6e3] bg-white p-1">
            {(["ALL", "INSTAGRAM", "FACEBOOK"] as const).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => selectPlatform(item)}
                className={`rounded-full px-3 py-1.5 text-[12px] font-medium ${
                  platform === item ? "bg-[#9ce069] text-[#292929]" : "text-[#5d5d5d] hover:text-[#292929]"
                }`}
              >
                {item === "ALL" ? "All platforms" : item === "INSTAGRAM" ? "Instagram" : "Facebook"}
              </button>
            ))}
          </div>
          <label htmlFor="views-account" className="sr-only">Account</label>
          <select
            id="views-account"
            value={accountId}
            onChange={(event) => {
              const nextAccountId = event.target.value;
              setData(dataCache.get<ViewsAnalyticsResponse>(viewsCacheKey(platform, nextAccountId, days)));
              setLoading(true);
              setAccountId(nextAccountId);
            }}
            className="h-9 min-w-40 rounded-full border border-[#e6e6e3] bg-white px-3 text-[13px]"
          >
            <option value="all">All accounts</option>
            {visibleAccounts.map((account) => (
              <option key={account.id} value={account.id}>{account.name}</option>
            ))}
          </select>
          <label htmlFor="views-period" className="sr-only">Period</label>
          <select
            id="views-period"
            value={days}
            onChange={(event) => {
              const nextDays = Number(event.target.value);
              setData(dataCache.get<ViewsAnalyticsResponse>(viewsCacheKey(platform, accountId, nextDays)));
              setLoading(true);
              setDays(nextDays);
            }}
            className="h-9 rounded-full border border-[#e6e6e3] bg-white px-3 text-[13px]"
          >
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
        </div>
      </header>

      {error && (
        <div className="rounded-xl border border-[#e5b8b3] bg-[#fff4f2] px-4 py-3 text-[13px] text-error">{error}</div>
      )}

      {data?.unavailableAccounts.length ? (
        <div className="rounded-xl border border-[#eadfbd] bg-[#fffbed] px-4 py-3 text-[13px] text-[#5d5d5d]">
          Reconnect {data.unavailableAccounts.join(", ")} in Settings to restore its video insights.
        </div>
      ) : null}

      <section aria-label="Video totals" className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <MetricCard label="Videos" value={data?.totals.videos ?? 0} icon={Play} />
        <MetricCard label="Views" value={data?.totals.views ?? 0} icon={Eye} />
        <MetricCard label="Likes / reactions" value={data?.totals.likes ?? 0} icon={Heart} />
        <MetricCard label="Comments" value={data?.totals.comments ?? 0} icon={MessageCircle} />
        <MetricCard label="Shares" value={data?.totals.shares ?? 0} icon={Share2} />
        <MetricCard label="Interactions" value={data?.totals.interactions ?? 0} icon={BarChart3} />
      </section>

      <section className="grid gap-3 md:grid-cols-2">
        {(data?.platforms ?? []).map((summary) => (
          <article key={summary.platform} className="panel rounded-2xl p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className={`grid h-8 w-8 place-items-center rounded-lg ${summary.platform === "INSTAGRAM" ? "bg-[#eff8e9]" : "bg-[#f3f3f0]"}`}>
                  <PlatformMark platform={summary.platform} size={20} />
                </span>
                <div>
                  <p className="text-[14px] font-medium text-[#292929]">{summary.platform === "INSTAGRAM" ? "Instagram" : "Facebook"}</p>
                  <p className="mt-0.5 text-[12px] text-[#9e9e9e]">{summary.videos} videos</p>
                </div>
              </div>
              <p className="text-[24px] font-medium text-[#292929]">{formatNumber(summary.views)}</p>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2">
              {[
                ["Comments", summary.comments],
                ["Shares", summary.shares],
                ["Interactions", summary.interactions],
              ].map(([label, value]) => (
                <div key={String(label)} className="rounded-lg bg-[#f7f7f5] px-3 py-2.5">
                  <p className="text-[12px] text-[#9e9e9e]">{label}</p>
                  <p className="mt-1 text-[14px] font-medium text-[#292929]">{formatNumber(Number(value))}</p>
                </div>
              ))}
            </div>
          </article>
        ))}
      </section>

      <section className="panel overflow-hidden rounded-2xl">
        <div className="flex items-center justify-between border-b border-[#e6e6e3] px-5 py-4">
          <div>
            <h2 className="text-[14px] font-medium text-[#292929]">Video performance</h2>
            <p className="mt-1 text-[12px] text-[#9e9e9e]">Sorted by newest published video</p>
          </div>
          <span role="status" className="text-[12px] text-[#9e9e9e]">
            {loading ? "Updating latest data…" : `${data?.posts.length ?? 0} videos`}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1120px] text-[13px]">
            <thead className="bg-[#f7f7f5] text-[12px] text-[#9e9e9e]">
              <tr>
                <th className="px-5 py-3 text-left font-medium">Video</th>
                <th className="px-3 py-3 text-right font-medium">Views</th>
                <th className="px-3 py-3 text-right font-medium">Reach</th>
                <th className="px-3 py-3 text-right font-medium">Likes</th>
                <th className="px-3 py-3 text-right font-medium">Comments</th>
                <th className="px-3 py-3 text-right font-medium">Saves</th>
                <th className="px-3 py-3 text-right font-medium">Shares</th>
                <th className="px-3 py-3 text-right font-medium">Interactions</th>
                <th className="px-5 py-3 text-right font-medium">Published</th>
              </tr>
            </thead>
            <tbody>
              {data?.posts.map((post) => <VideoRow key={`${post.platform}:${post.id}`} post={post} />)}
            </tbody>
          </table>
          {!loading && data?.posts.length === 0 && (
            <div className="px-5 py-14 text-center">
              <p className="text-[14px] font-medium text-[#292929]">No videos found</p>
              <p className="mt-1 text-[13px] text-[#9e9e9e]">Try a longer period or connect another account in Settings.</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
