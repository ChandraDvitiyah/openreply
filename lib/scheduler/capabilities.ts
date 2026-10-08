export const postKinds = [
  "TEXT",
  "IMAGE",
  "VIDEO",
  "REEL",
  "CAROUSEL",
  "STORY_IMAGE",
  "STORY_VIDEO",
] as const;
export type PostKind = (typeof postKinds)[number];
export type MediaType = "IMAGE" | "VIDEO";
export const kindLabels: Record<PostKind, string> = {
  TEXT: "Text / link post",
  IMAGE: "Image post",
  VIDEO: "Video post",
  REEL: "Reel",
  CAROUSEL: "Carousel / photo album",
  STORY_IMAGE: "Story · image",
  STORY_VIDEO: "Story · video",
};
export const isStory = (kind: string) =>
  kind === "STORY_IMAGE" || kind === "STORY_VIDEO";
export const isVideo = (kind: string) =>
  ["VIDEO", "REEL", "STORY_VIDEO"].includes(kind);
export function supportedKinds(platform: string): PostKind[] {
  return platform === "FACEBOOK"
    ? [...postKinds]
    : postKinds.filter((k) => k !== "TEXT" && k !== "VIDEO");
}
export function inferMediaType(url: string): MediaType {
  try {
    return /\.(mp4|mov|m4v|webm)$/i.test(new URL(url).pathname)
      ? "VIDEO"
      : "IMAGE";
  } catch {
    return "IMAGE";
  }
}
export type PublishingOptions = {
  mediaTypes: MediaType[];
  altTexts: string[];
  coverUrl: string;
  audioName: string;
  shareToFeed: boolean;
  linkUrl: string;
};
export const defaultPublishingOptions: PublishingOptions = {
  mediaTypes: [],
  altTexts: [],
  coverUrl: "",
  audioName: "",
  shareToFeed: true,
  linkUrl: "",
};
export function readPublishingOptions(value: unknown): PublishingOptions {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return { ...defaultPublishingOptions };
  return {
    ...defaultPublishingOptions,
    ...(value as Partial<PublishingOptions>),
  };
}
