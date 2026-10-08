// Shared by the composer and server validation. Reject DST gaps and overlaps
// instead of silently moving a creator's chosen time by an hour.
export function isTimezone(value: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export function localDateTime(instant: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const part = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

export function toScheduledInstant(local: string, timezone: string): string {
  if (!isTimezone(timezone) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) {
    throw new Error("Choose a valid date, time, and timezone.");
  }
  const wall = Date.parse(`${local}:00Z`);
  if (!Number.isFinite(wall)) throw new Error("Choose a valid date and time.");
  // Sample offsets on both sides of the date to detect DST transitions.
  const offsets = new Set<number>();
  for (const hours of [-36, -12, 0, 12, 36]) {
    const sample = wall + hours * 3_600_000;
    const formatted = localDateTime(new Date(sample), timezone);
    offsets.add(Date.parse(`${formatted}:00Z`) - sample);
  }
  const matches = [...offsets]
    .map((offset) => wall - offset)
    .filter(
      (candidate) => localDateTime(new Date(candidate), timezone) === local,
    );
  if (matches.length !== 1) {
    throw new Error(
      matches.length
        ? "This time occurs twice due to daylight saving. Choose a different time or UTC."
        : "This local time does not exist. Choose a different time.",
    );
  }
  return new Date(matches[0]).toISOString();
}
