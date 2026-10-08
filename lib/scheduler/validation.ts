import { z } from "zod";
import { isPublicMediaUrl } from "./media-url";
import { isTimezone } from "./time";
import {
  defaultPublishingOptions,
  inferMediaType,
  isStory,
  postKinds,
  supportedKinds,
} from "./capabilities";

const publicUrl = z
  .string()
  .max(2048)
  .refine(
    isPublicMediaUrl,
    "Use a public HTTPS media URL without credentials.",
  );
const optionalUrl = z.union([z.literal(""), publicUrl]);
const optionsSchema = z.object({
  mediaTypes: z
    .array(z.enum(["IMAGE", "VIDEO"]))
    .max(10)
    .default([]),
  altTexts: z.array(z.string().max(1000)).max(10).default([]),
  coverUrl: optionalUrl.default(""),
  audioName: z.string().trim().max(200).default(""),
  shareToFeed: z.boolean().default(true),
  linkUrl: optionalUrl.default(""),
});
export const postInputSchema = z
  .object({
    clientRequestId: z.uuid().optional(),
    title: z.string().trim().min(1, "Add an internal title.").max(120),
    platform: z.enum(["INSTAGRAM", "FACEBOOK"]),
    accountId: z.string().min(1, "Choose a connected account."),
    kind: z.enum(postKinds),
    caption: z.string().max(63206).default(""),
    mediaUrls: z.array(publicUrl).max(10).default([]),
    publishingOptions: optionsSchema.default(defaultPublishingOptions),
    timezone: z.string().refine(isTimezone, "Choose a valid timezone."),
    scheduledAt: z.iso.datetime({ offset: true }).nullable().default(null),
    intent: z.enum(["draft", "schedule", "now"]).default("draft"),
  })
  .superRefine((post, ctx) => {
    const issue = (message: string, path: string) =>
      ctx.addIssue({ code: "custom", message, path: [path] });
    const options = post.publishingOptions;
    if (!supportedKinds(post.platform).includes(post.kind))
      issue(
        "Choose a supported post type for this platform. Instagram standalone videos publish as Reels.",
        "kind",
      );
    if (post.platform === "INSTAGRAM" && post.caption.length > 2200)
      issue(
        "Instagram captions can contain up to 2,200 characters.",
        "caption",
      );
    if (
      options.mediaTypes.length &&
      options.mediaTypes.length !== post.mediaUrls.length
    )
      issue("Choose a media type for every item.", "publishingOptions");
    if (options.altTexts.length > post.mediaUrls.length)
      issue("Alt text must match a media item.", "publishingOptions");
    if (
      options.linkUrl &&
      !(post.platform === "FACEBOOK" && post.kind === "TEXT")
    )
      issue(
        "Link previews are available on Facebook text posts.",
        "publishingOptions",
      );
    if (
      (options.coverUrl || options.audioName || !options.shareToFeed) &&
      !(post.platform === "INSTAGRAM" && post.kind === "REEL")
    )
      issue(
        "Cover, audio name, and feed sharing options apply to Instagram Reels.",
        "publishingOptions",
      );
    if (post.intent === "draft") return;
    if (isStory(post.kind) && post.caption.trim())
      issue(
        "Stories do not publish captions. Add text to the media itself, or clear this caption.",
        "caption",
      );
    if (
      post.kind === "TEXT" &&
      ((!post.caption.trim() && !options.linkUrl) || post.mediaUrls.length)
    )
      issue("Add text or a link, and remove media for a text post.", "caption");
    if (
      !["TEXT", "CAROUSEL"].includes(post.kind) &&
      post.mediaUrls.length !== 1
    )
      issue("Add exactly one media URL.", "mediaUrls");
    if (post.kind === "CAROUSEL" && post.mediaUrls.length < 2)
      issue("A carousel or album needs 2–10 media items.", "mediaUrls");
    for (const url of post.mediaUrls) {
      if (!isPublicMediaUrl(url)) continue;
      const pathname = new URL(url).pathname;
      if (/\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(pathname))
        issue(
          "Standalone audio cannot be published. Link a video with audio already included.",
          "mediaUrls",
        );
      if (
        post.platform === "INSTAGRAM" &&
        /\.(png|webp|gif|bmp|tiff)$/i.test(pathname)
      )
        issue(
          "Instagram requires JPEG images. Kult publishes files as supplied without conversion.",
          "mediaUrls",
        );
    }
    const types = post.mediaUrls.map(
      (url, i) => options.mediaTypes[i] ?? inferMediaType(url),
    );
    if (
      post.platform === "FACEBOOK" &&
      post.kind === "CAROUSEL" &&
      types.includes("VIDEO")
    )
      issue(
        "Facebook photo albums support images only. Schedule videos separately.",
        "mediaUrls",
      );
    if (
      post.kind !== "CAROUSEL" &&
      post.kind !== "TEXT" &&
      types.some(
        (t) =>
          t !==
          (["VIDEO", "REEL", "STORY_VIDEO"].includes(post.kind)
            ? "VIDEO"
            : "IMAGE"),
      )
    )
      issue(
        "The media type does not match this post. Choose the correct image/video type.",
        "mediaUrls",
      );
    if (
      post.intent === "schedule" &&
      (!post.scheduledAt || Date.parse(post.scheduledAt) < Date.now() + 60_000)
    )
      issue("Schedule at least one minute in the future.", "scheduledAt");
  });
export type PostInput = z.infer<typeof postInputSchema>;
export const mutationSchema = z.object({
  revision: z.number().int().nonnegative(),
  action: z.enum([
    "save",
    "cancel",
    "retry",
    "duplicate",
    "confirm-published",
    "confirm-not-published",
  ]),
  post: postInputSchema.optional(),
});
