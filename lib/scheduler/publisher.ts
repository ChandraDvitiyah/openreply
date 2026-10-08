import { getMetaGraphApiVersion } from "@/lib/env";
import type { ScheduledPost } from "@/app/generated/prisma/client";
import { asStringArray } from "@/lib/utils/string-list";
import { inferMediaType, isStory, readPublishingOptions } from "./capabilities";
import { schedulerMediaUrl } from "./storage";

export class PublishingError extends Error {
  constructor(
    message: string,
    public retryable = false,
    public rejected = true,
  ) {
    super(message);
  }
}
type Preparation = {
  children?: string[];
  videoId?: string;
  uploaded?: boolean;
  accepted?: boolean;
};
export type PreparationCheckpoint = (state: Preparation) => Promise<void>;
async function readResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.error) {
    const code = body?.error?.code;
    // Raw Meta responses can echo credentials and signed URLs.
    if (code === 190)
      throw new PublishingError(
        "Connection expired. Reconnect the account in Settings, then retry.",
      );
    if ([10, 200].includes(code))
      throw new PublishingError(
        "Publishing permission is missing. Reconnect the account and grant publishing access in Meta.",
      );
    if ([4, 17, 32, 613, 368].includes(code))
      throw new PublishingError(
        "Meta is limiting publishing. We will retry shortly.",
        true,
      );
    if (response.status >= 500)
      throw new PublishingError(
        "Meta is temporarily unavailable.",
        true,
        false,
      );
    throw new PublishingError(
      "Meta rejected this post. Check media format, public URL accessibility, account eligibility, and publishing permissions.",
    );
  }
  if (!body)
    throw new PublishingError(
      "Meta returned an unreadable response. Check the social account before retrying.",
      true,
      false,
    );
  return body as T;
}
async function metaFetch<T>(
  url: URL,
  token: string,
  fields?: Record<string, string>,
  headers: Record<string, string> = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: fields || Object.keys(headers).length ? "POST" : "GET",
      headers: { Authorization: `Bearer ${token}`, ...headers },
      ...(fields ? { body: new URLSearchParams(fields) } : {}),
      signal: AbortSignal.timeout(30_000),
      redirect: "error",
    });
  } catch {
    throw new PublishingError(
      "Meta did not respond. Delivery may be uncertain; check the social account before retrying.",
      true,
      false,
    );
  }
  return readResponse<T>(response);
}
async function graph<T>(
  platform: string,
  path: string,
  token: string,
  fields?: Record<string, string>,
  readFields = "status_code",
): Promise<T> {
  const host =
    platform === "INSTAGRAM"
      ? "graph.instagram.com"
      : platform === "FACEBOOK_VIDEO"
        ? "graph-video.facebook.com"
        : "graph.facebook.com";
  const url = new URL(`https://${host}/${getMetaGraphApiVersion()}/${path}`);
  if (!fields) url.searchParams.set("fields", readFields);
  return metaFetch<T>(url, token, fields);
}
function requireId(id: unknown): string {
  // IDs also become URL path segments; never accept an arbitrary upload host.
  if (typeof id !== "string" || !/^[\w-]+$/.test(id))
    throw new PublishingError(
      "Meta did not return a valid media ID.",
      true,
      false,
    );
  return id;
}
async function resolveMedia(post: ScheduledPost) {
  try {
    const urls = await Promise.all(
      asStringArray(post.mediaUrls).map((url) =>
        schedulerMediaUrl(post.workspaceId, url),
      ),
    );
    const options = readPublishingOptions(post.publishingOptions);
    if (options.coverUrl)
      options.coverUrl = await schedulerMediaUrl(
        post.workspaceId,
        options.coverUrl,
      );
    return { urls, options };
  } catch {
    // No outbound Meta request has begun; retrying a storage error is safe.
    throw new PublishingError(
      "Media storage could not be authorized. Ask your administrator to check the Backblaze connection and workspace media file.",
      true,
      true,
    );
  }
}
export const metaPublisher = {
  async prepare(
    post: ScheduledPost,
    token: string,
    accountId: string,
    checkpoint: PreparationCheckpoint = async () => {},
  ): Promise<string | null> {
    const { urls, options } = await resolveMedia(post);
    const state: Preparation =
      post.preparation && typeof post.preparation === "object"
        ? { ...(post.preparation as Preparation) }
        : {};
    const persist = async () => {
      await checkpoint({ ...state });
    };
    if (post.platform === "FACEBOOK") {
      if (post.kind === "CAROUSEL" || post.kind === "STORY_IMAGE") {
        state.children = [...(state.children ?? [])];
        for (let i = state.children.length; i < urls.length; i++) {
          const result = await graph<{ id: string }>(
            "FACEBOOK",
            `${accountId}/photos`,
            token,
            {
              url: urls[i],
              published: "false",
              ...(options.altTexts[i]
                ? { alt_text_custom: options.altTexts[i] }
                : {}),
            },
          );
          state.children.push(requireId(result.id));
          await persist();
        }
        return JSON.stringify(state.children);
      }
      if (["REEL", "STORY_VIDEO"].includes(post.kind)) {
        const edge = post.kind === "REEL" ? "video_reels" : "video_stories";
        if (!state.videoId) {
          const result = await graph<{ video_id: string }>(
            "FACEBOOK",
            `${accountId}/${edge}`,
            token,
            { upload_phase: "start" },
          );
          state.videoId = requireId(result.video_id);
          await persist();
        }
        if (!state.uploaded) {
          // Construct a trusted upload URL instead of following a response URL
          // that could redirect the Page token to a different host.
          const url = new URL(
            `https://rupload.facebook.com/video-upload/${getMetaGraphApiVersion()}/${state.videoId}`,
          );
          const uploaded = await metaFetch<{ success: boolean }>(
            url,
            token,
            undefined,
            { Authorization: `OAuth ${token}`, file_url: urls[0] },
          );
          if (!uploaded.success)
            throw new PublishingError(
              "Meta did not confirm the video upload.",
              true,
              false,
            );
          state.uploaded = true;
          await persist();
        }
        return state.videoId;
      }
      throw new PublishingError(
        "This Facebook post does not require preparation.",
      );
    }
    if (isStory(post.kind)) {
      const profile = await graph<{ account_type: string }>(
        "INSTAGRAM",
        accountId,
        token,
        undefined,
        "account_type",
      );
      if (profile.account_type !== "BUSINESS")
        throw new PublishingError(
          "Instagram Story publishing requires a Business account. Switch the account type in Instagram or choose a feed post/Reel.",
        );
    }
    const fields: Record<string, string> = isStory(post.kind)
      ? { media_type: "STORIES" }
      : { caption: post.caption };
    if (post.kind === "CAROUSEL") {
      state.children = [...(state.children ?? [])];
      for (let i = state.children.length; i < urls.length; i++) {
        const video =
          (options.mediaTypes[i] ?? inferMediaType(urls[i])) === "VIDEO";
        const child = await graph<{ id: string }>(
          "INSTAGRAM",
          `${accountId}/media`,
          token,
          {
            ...(video
              ? { media_type: "VIDEO", video_url: urls[i] }
              : {
                  image_url: urls[i],
                  ...(options.altTexts[i]
                    ? { alt_text: options.altTexts[i] }
                    : {}),
                }),
            is_carousel_item: "true",
          },
        );
        state.children.push(requireId(child.id));
        await persist();
      }
      for (const id of state.children) {
        const status = await metaPublisher.containerStatus(id, token);
        if (status === "IN_PROGRESS") return null;
        if (status !== "FINISHED")
          throw new PublishingError(
            "Meta could not process a carousel item. Check each image/video format.",
          );
      }
      fields.media_type = "CAROUSEL";
      fields.children = state.children.join(",");
    } else if (post.kind === "REEL" || post.kind === "STORY_VIDEO") {
      fields.video_url = urls[0];
      if (post.kind === "REEL") {
        fields.media_type = "REELS";
        fields.share_to_feed = String(options.shareToFeed);
        if (options.coverUrl) fields.cover_url = options.coverUrl;
        if (options.audioName) fields.audio_name = options.audioName;
      }
    } else {
      fields.image_url = urls[0];
      if (!isStory(post.kind) && options.altTexts[0])
        fields.alt_text = options.altTexts[0];
    }
    const result = await graph<{ id: string }>(
      "INSTAGRAM",
      `${accountId}/media`,
      token,
      fields,
    );
    return requireId(result.id);
  },
  async containerStatus(
    containerId: string,
    token: string,
    platform = "INSTAGRAM",
  ) {
    if (platform === "INSTAGRAM")
      return (
        await graph<{ status_code: string }>(platform, containerId, token)
      ).status_code;
    const { status } = await graph<{
      status: {
        video_status?: string;
        uploading_phase?: { status: string };
        processing_phase?: { status: string };
        publishing_phase?: { status: string; publish_status?: string };
      };
    }>(platform, containerId, token, undefined, "status");
    if (status?.publishing_phase?.status === "complete") return "PUBLISHED";
    if (
      status?.video_status === "error" ||
      [
        status?.uploading_phase?.status,
        status?.processing_phase?.status,
        status?.publishing_phase?.status,
      ].includes("error")
    )
      return "ERROR";
    if (
      status?.video_status === "ready" ||
      status?.processing_phase?.status === "complete"
    )
      return "FINISHED";
    return "IN_PROGRESS";
  },
  async publicationStatus(post: ScheduledPost, token: string) {
    const result = await graph<{
      status?: {
        video_status?: string;
        publishing_phase?: { status: string; publish_status?: string };
      };
    }>("FACEBOOK", post.containerId!, token, undefined, "status");
    if (
      result.status?.publishing_phase?.status === "error" ||
      result.status?.video_status === "error"
    )
      return "ERROR";
    if (
      result.status?.publishing_phase?.status === "complete" ||
      result.status?.publishing_phase?.publish_status === "published" ||
      (post.kind === "VIDEO" && result.status?.video_status === "ready")
    )
      return "PUBLISHED";
    return "IN_PROGRESS";
  },
  async publish(post: ScheduledPost, token: string, accountId: string) {
    const options = readPublishingOptions(post.publishingOptions);
    let path: string;
    let fields: Record<string, string>;
    if (post.platform === "INSTAGRAM") {
      path = `${accountId}/media_publish`;
      fields = { creation_id: post.containerId! };
    } else if (post.kind === "CAROUSEL") {
      path = `${accountId}/feed`;
      fields = {
        message: post.caption,
        attached_media: JSON.stringify(
          JSON.parse(post.containerId!).map((id: string) => ({
            media_fbid: id,
          })),
        ),
      };
    } else if (post.kind === "STORY_IMAGE") {
      path = `${accountId}/photo_stories`;
      fields = { photo_id: JSON.parse(post.containerId!)[0] };
    } else if (post.kind === "REEL" || post.kind === "STORY_VIDEO") {
      path = `${accountId}/${post.kind === "REEL" ? "video_reels" : "video_stories"}`;
      fields = {
        video_id: post.containerId!,
        upload_phase: "finish",
        ...(post.kind === "REEL"
          ? { video_state: "PUBLISHED", description: post.caption }
          : {}),
      };
    } else if (post.kind === "VIDEO") {
      path = `${accountId}/videos`;
      fields = {
        file_url: (await resolveMedia(post)).urls[0],
        description: post.caption,
        published: "true",
      };
    } else if (post.kind === "IMAGE") {
      path = `${accountId}/photos`;
      fields = {
        url: (await resolveMedia(post)).urls[0],
        caption: post.caption,
        ...(options.altTexts[0]
          ? { alt_text_custom: options.altTexts[0] }
          : {}),
      };
    } else {
      path = `${accountId}/feed`;
      fields = {
        message: post.caption,
        ...(options.linkUrl ? { link: options.linkUrl } : {}),
      };
    }
    const result = await graph<{
      id?: string;
      post_id?: string;
      success?: boolean;
    }>(
      post.platform === "FACEBOOK" && post.kind === "VIDEO"
        ? "FACEBOOK_VIDEO"
        : post.platform,
      path,
      token,
      fields,
    );
    if (result.success === false)
      throw new PublishingError(
        "Meta did not confirm publication. Check the social account before retrying.",
        false,
        false,
      );
    const id =
      result.post_id ??
      result.id ??
      (result.success && ["VIDEO", "REEL", "STORY_VIDEO"].includes(post.kind)
        ? post.containerId
        : null);
    if (
      !id ||
      !(
        typeof id === "string" ||
        (typeof id === "number" && Number.isSafeInteger(id))
      )
    )
      throw new PublishingError(
        "Meta did not confirm publication. Check the social account before retrying.",
        false,
        false,
      );
    return String(id);
  },
};
