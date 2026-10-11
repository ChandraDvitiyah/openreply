export type Platform = "INSTAGRAM" | "FACEBOOK";

export type DailyViewsPoint = {
  date: string;
  views: number | null;
  videos: number;
  partial: boolean;
};

export type VideoAnalyticsPost = {
  id: string;
  platform: Platform;
  accountId: string;
  accountName: string;
  title: string;
  permalink: string | null;
  thumbnailUrl: string | null;
  mediaType: string;
  publishedAt: string;
  views: number | null;
  reach: number | null;
  likes: number;
  comments: number;
  saves: number | null;
  shares: number;
  interactions: number;
};

export type ViewsAnalyticsResponse = {
  periodDays: number;
  lastSyncedAt: string | null;
  stale: boolean;
  accounts: Array<{ id: string; platform: Platform; name: string }>;
  totals: {
    videos: number;
    views: number;
    reach: number;
    likes: number;
    comments: number;
    saves: number;
    shares: number;
    interactions: number;
  };
  platforms: Array<{
    platform: Platform;
    videos: number;
    views: number;
    comments: number;
    shares: number;
    interactions: number;
  }>;
  posts: VideoAnalyticsPost[];
  dailyViews: DailyViewsPoint[];
  unavailableAccounts: string[];
};

