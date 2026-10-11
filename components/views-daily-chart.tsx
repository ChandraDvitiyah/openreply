"use client";

import { useId } from "react";
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import type { DailyViewsPoint } from "@/lib/performance/types";

function dateLabel(date: string, full = false) {
  return new Date(`${date}T00:00:00+05:30`).toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata", day: "numeric", month: "short", ...(full ? { year: "numeric" } : {}),
  });
}

function compactNumber(value: number) {
  return Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

export function ViewsDailyChart({ points, title, description, loading }: {
  points: DailyViewsPoint[];
  title: string;
  description: string;
  loading: boolean;
}) {
  const gradientId = useId().replaceAll(":", "");
  const hasData = points.some(point => point.views !== null);

  return (
    <section className="panel overflow-hidden rounded-2xl" aria-label={title} aria-busy={loading}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#e6e6e3] px-5 py-4">
        <div>
          <h2 className="text-[14px] font-medium text-[#292929]">{title}</h2>
          <p className="mt-1 text-[12px] text-[#777]">{description}</p>
        </div>
        <span className="rounded-full bg-[#eff8e9] px-3 py-1.5 text-[11px] font-medium text-[#42652c]">IST · 00:00–24:00</span>
      </div>
      {hasData ? (
        <>
          <div className="h-[280px] min-w-0 px-3 pb-2 pt-5 sm:px-5">
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <AreaChart data={points} margin={{ top: 8, right: 14, bottom: 4, left: 0 }} accessibilityLayer>
                <defs>
                  <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#9ce069" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#9ce069" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="#eeeeeb" strokeDasharray="3 3" />
                <XAxis dataKey="date" tickFormatter={date => dateLabel(String(date))} tick={{ fontSize: 11, fill: "#777" }} tickLine={false} axisLine={false} minTickGap={28} tickMargin={12} />
                <YAxis tickFormatter={compactNumber} tick={{ fontSize: 11, fill: "#777" }} tickLine={false} axisLine={false} allowDecimals={false} width={48} domain={[0, "auto"]} />
                <Tooltip content={({ active, payload, label }) => {
                  if (!active || !payload?.length || typeof label !== "string") return null;
                  const point = payload[0].payload as DailyViewsPoint;
                  return <div className="rounded-xl border border-[#e6e6e3] bg-white px-4 py-3 text-[12px] shadow-sm">
                    <p className="font-medium text-[#292929]">{dateLabel(label, true)}</p>
                    <p className="mt-1 text-[#777]">00:00–24:00 IST (UTC+05:30)</p>
                    <p className="mt-2 font-medium text-[#292929]">{point.views?.toLocaleString("en-IN") ?? "Unavailable"} views{point.partial ? " · Partial data" : ""}</p>
                    <p className="mt-1 text-[#777]">{point.videos} {point.videos === 1 ? "video" : "videos"} published</p>
                  </div>;
                }} />
                <Area type="linear" dataKey="views" name="Views" stroke="#6ba942" strokeWidth={2} fill={`url(#${gradientId})`} connectNulls={false} isAnimationActive={false} activeDot={{ r: 4, stroke: "#fff", strokeWidth: 2 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <details className="border-t border-[#eeeeeb] px-5 py-3 text-[12px]">
            <summary className="cursor-pointer text-[#777]">View daily data</summary>
            <div className="mt-3 max-h-60 overflow-auto">
              <table className="w-full text-left">
                <caption className="sr-only">{description} — each day uses IST</caption>
                <thead><tr><th scope="col" className="py-2 font-medium">Day (IST)</th><th scope="col" className="py-2 text-right font-medium">Views</th></tr></thead>
                <tbody>{points.map(point => <tr key={point.date} className="border-t border-[#eeeeeb]"><th scope="row" className="py-2 font-normal">{dateLabel(point.date, true)}</th><td className="py-2 text-right">{point.views?.toLocaleString("en-IN") ?? "—"}{point.partial ? " *" : ""}</td></tr>)}</tbody>
              </table>
            </div>
            {points.some(point => point.partial) && <p className="mt-2 text-[#777]">* Some views are unavailable for this day.</p>}
          </details>
        </>
      ) : <p className="px-5 py-14 text-center text-[13px] text-[#777]">{loading ? "Loading daily views…" : "Daily views are not available for this selection yet."}</p>}
    </section>
  );
}
