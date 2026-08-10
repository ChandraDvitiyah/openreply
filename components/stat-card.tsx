/**
 * Stat Card
 *
 * Metric panel with label, value, and optional trend.
 */

interface StatCardProps {
  label: string;
  value: string | number;
  trend?: string;
  trendUp?: boolean;
}

export default function StatCard({ label, value, trend, trendUp }: StatCardProps) {
  const normalized = label.toLowerCase();
  const icon = normalized.includes("comment")
    ? "◌"
    : normalized.includes("save")
      ? "⌑"
      : normalized.includes("share") || normalized.includes("click")
        ? "↗"
        : normalized.includes("dm") || normalized.includes("message")
          ? "✉"
          : normalized.includes("like")
            ? "♡"
            : "◎";

  return (
    <div className="panel rounded-2xl p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[12px] text-[#5d5d5d]">{label}</p>
        <span aria-hidden="true" className="grid h-8 w-8 place-items-center rounded-lg bg-[#f3f3f0] text-[20px] leading-none text-[#292929]">
          {icon}
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
