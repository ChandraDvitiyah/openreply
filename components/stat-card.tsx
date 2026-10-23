/**
 * Stat Card
 *
 * Metric panel with label, value, and optional trend.
 */

import { ArrowUpRight, Bookmark, Heart, Mail, MessageCircle, Target } from "lucide-react";

interface StatCardProps {
  label: string;
  value: string | number;
  trend?: string;
  trendUp?: boolean;
}

export default function StatCard({ label, value, trend, trendUp }: StatCardProps) {
  const normalized = label.toLowerCase();
  const Icon = normalized.includes("comment")
    ? MessageCircle
    : normalized.includes("save")
      ? Bookmark
      : normalized.includes("share") || normalized.includes("click")
        ? ArrowUpRight
        : normalized.includes("dm") || normalized.includes("message")
          ? Mail
          : normalized.includes("like")
            ? Heart
            : Target;

  return (
    <div className="panel rounded-2xl p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[12px] text-[#5d5d5d]">{label}</p>
        <span className="grid h-9 w-9 place-items-center rounded-lg bg-[#f3f3f0] text-[#292929]">
          <Icon aria-hidden="true" size={20} strokeWidth={1.7} />
        </span>
      </div>
      <p className="mt-4 text-[24px] font-medium leading-none text-[#292929]">{value}</p>
      {trend && (
        <p className={`mt-2 text-[12px] ${trendUp ? "text-success" : "text-error"}`}>
          {trendUp ? "Up" : "Down"} {trend}
        </p>
      )}
    </div>
  );
}
