import type { DailyViewsPoint, VideoAnalyticsPost } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

export function istDateKey(date: Date) {
  return new Date(date.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

// Media insights are lifetime totals. Bucket them by publication date, never
// describe them as views earned on that date. The existing reporting window
// is rolling, so its first and last IST calendar days can be partial days.
export function getViewsByPublishDay(
  posts: VideoAnalyticsPost[],
  periodDays: number,
  capturedAt: Date,
  available = true,
): DailyViewsPoint[] {
  let start = istDateKey(new Date(capturedAt.getTime() - periodDays * DAY_MS));
  let end = istDateKey(capturedAt);
  // Accounts can have different snapshot ages. Include the entire selected
  // video cohort so a fresher account's dates are not silently dropped.
  for (const post of posts) {
    const published = new Date(post.publishedAt);
    if (!Number.isFinite(published.getTime())) continue;
    const date = istDateKey(published);
    if (date < start) start = date;
    if (date > end) end = date;
  }
  const buckets = new Map<string, DailyViewsPoint & { known: number }>();
  for (let time = Date.parse(`${start}T00:00:00Z`); time <= Date.parse(`${end}T00:00:00Z`); time += DAY_MS) {
    const date = new Date(time).toISOString().slice(0, 10);
    buckets.set(date, { date, views: available ? 0 : null, videos: 0, partial: !available, known: 0 });
  }
  for (const post of posts) {
    const published = new Date(post.publishedAt);
    if (!Number.isFinite(published.getTime())) continue;
    const day = buckets.get(istDateKey(published));
    if (!day) continue;
    day.videos += 1;
    if (post.views === null) day.partial = true;
    else { day.views = (day.views ?? 0) + post.views; day.known += 1; }
  }
  return [...buckets.values()].map(({ known, ...day }) => ({
    ...day,
    views: day.videos > 0 && known === 0 ? null : day.views,
  }));
}
