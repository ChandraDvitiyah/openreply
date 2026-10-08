import { afterEach, describe, expect, it, vi } from "vitest";
import { metaPublisher, PublishingError } from "@/lib/scheduler/publisher";
import type { ScheduledPost } from "@/app/generated/prisma/client";
const post = (extra = {}) =>
  ({
    platform: "INSTAGRAM",
    kind: "IMAGE",
    caption: "Hello",
    mediaUrls: ["https://cdn.example.com/image.jpg"],
    containerId: "container",
    ...extra,
  }) as ScheduledPost;
afterEach(() => vi.unstubAllGlobals());
function mockResponse(body: unknown, status = 200) {
  const fetchMock = vi
    .fn()
    .mockImplementation(
      async () => new Response(JSON.stringify(body), { status }),
    );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
describe("Meta publisher contract", () => {
  it("creates Instagram images using bearer tokens and form data", async () => {
    const fetch = mockResponse({ id: "container" });
    expect(await metaPublisher.prepare(post(), "secret-test", "ig-id")).toBe(
      "container",
    );
    const [url, init] = fetch.mock.calls[0];
    expect(String(url)).toContain("graph.instagram.com/");
    expect(String(url)).toContain("ig-id/media");
    expect(init.headers.Authorization).toBe("Bearer secret-test");
    expect(init.body.get("image_url")).toBe(
      "https://cdn.example.com/image.jpg",
    );
    expect(String(url)).not.toContain("secret-test");
  });
  it("creates Reels with the correct media type", async () => {
    const fetch = mockResponse({ id: "reel" });
    await metaPublisher.prepare(post({ kind: "REEL" }), "token", "ig-id");
    expect(fetch.mock.calls[0][1].body.get("media_type")).toBe("REELS");
    expect(fetch.mock.calls[0][1].body.has("video_url")).toBe(true);
  });
  it("creates carousel children before their parent", async () => {
    const fetch = mockResponse({ id: "child", status_code: "FINISHED" });
    await metaPublisher.prepare(
      post({
        kind: "CAROUSEL",
        mediaUrls: [
          "https://cdn.example.com/1.jpg",
          "https://cdn.example.com/2.jpg",
        ],
      }),
      "token",
      "ig-id",
    );
    expect(fetch).toHaveBeenCalledTimes(5);
    expect(fetch.mock.calls[0][1].body.get("is_carousel_item")).toBe("true");
    expect(fetch.mock.calls[4][1].body.get("children")).toBe("child,child");
    expect(fetch.mock.calls[4][1].body.get("media_type")).toBe("CAROUSEL");
  });
  it.each([
    ["INSTAGRAM", "IMAGE", "media_publish", "creation_id"],
    ["FACEBOOK", "TEXT", "feed", "message"],
    ["FACEBOOK", "IMAGE", "photos", "url"],
  ])("publishes %s %s through %s", async (platform, kind, endpoint, field) => {
    const fetch = mockResponse({ id: "remote-id" });
    expect(
      await metaPublisher.publish(post({ platform, kind }), "token", "account"),
    ).toBe("remote-id");
    expect(String(fetch.mock.calls[0][0])).toContain(`/account/${endpoint}`);
    expect(fetch.mock.calls[0][1].body.has(field)).toBe(true);
  });
  it("maps permission and token errors to safe actionable messages", async () => {
    mockResponse({ error: { code: 190, message: "contains SECRET" } }, 400);
    await expect(metaPublisher.publish(post(), "SECRET", "ig")).rejects.toThrow(
      "Reconnect",
    );
    mockResponse({ error: { code: 200, message: "contains SECRET" } }, 400);
    await expect(metaPublisher.publish(post(), "SECRET", "ig")).rejects.toThrow(
      "permission",
    );
  });
  it("distinguishes definite rejection from uncertain delivery", async () => {
    mockResponse({ error: { code: 4 } }, 429);
    try {
      await metaPublisher.publish(post(), "token", "ig");
    } catch (err) {
      expect(err).toMatchObject({ retryable: true, rejected: true });
    }
    mockResponse({}, 503);
    await expect(
      metaPublisher.publish(post(), "token", "ig"),
    ).rejects.toMatchObject({ rejected: false });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network timeout")),
    );
    await expect(
      metaPublisher.publish(post(), "token", "ig"),
    ).rejects.toBeInstanceOf(PublishingError);
  });
});

describe("extended media publishing", () => {
  it.each(["STORY_IMAGE", "STORY_VIDEO"])(
    "creates Instagram %s without captions",
    async (kind) => {
      const fetch = mockResponse({ account_type: "BUSINESS", id: "story" });
      await metaPublisher.prepare(post({ kind }), "token", "ig");
      const fields = fetch.mock.calls[1][1].body;
      expect(fields.get("media_type")).toBe("STORIES");
      expect(
        fields.has(kind === "STORY_VIDEO" ? "video_url" : "image_url"),
      ).toBe(true);
      expect(fields.has("caption")).toBe(false);
    },
  );
  it("rejects Instagram Story publishing for Creator accounts before upload", async () => {
    const fetch = mockResponse({ account_type: "MEDIA_CREATOR" });
    await expect(
      metaPublisher.prepare(post({ kind: "STORY_IMAGE" }), "token", "ig"),
    ).rejects.toThrow("Business account");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("passes Reel original audio name, cover, and sharing options natively", async () => {
    const fetch = mockResponse({ id: "reel" });
    await metaPublisher.prepare(
      post({
        kind: "REEL",
        publishingOptions: {
          audioName: "Studio session",
          coverUrl: "https://cdn.example.com/cover.jpg",
          shareToFeed: false,
        },
      }),
      "token",
      "ig",
    );
    const fields = fetch.mock.calls[0][1].body;
    expect(fields.get("audio_name")).toBe("Studio session");
    expect(fields.get("cover_url")).toBe("https://cdn.example.com/cover.jpg");
    expect(fields.get("share_to_feed")).toBe("false");
  });
  it("persists mixed carousel children and waits for video readiness before creating parent", async () => {
    let ready = false;
    const fetch = vi.fn(
      async (_url, init) =>
        new Response(
          JSON.stringify(
            init.body
              ? { id: "child" }
              : { status_code: ready ? "FINISHED" : "IN_PROGRESS" },
          ),
        ),
    );
    vi.stubGlobal("fetch", fetch);
    const checkpoint = vi.fn();
    const content = post({
      kind: "CAROUSEL",
      mediaUrls: [
        "https://cdn.example.com/1.jpg",
        "https://cdn.example.com/2.mp4",
      ],
      publishingOptions: {
        mediaTypes: ["IMAGE", "VIDEO"],
        altTexts: ["A sunrise", ""],
      },
    });
    expect(
      await metaPublisher.prepare(content, "token", "ig", checkpoint),
    ).toBeNull();
    expect(fetch.mock.calls[0][1].body.get("alt_text")).toBe("A sunrise");
    expect(fetch.mock.calls[1][1].body.get("media_type")).toBe("VIDEO");
    expect(checkpoint).toHaveBeenCalledTimes(2);
    const state = checkpoint.mock.calls.at(-1)![0];
    ready = true;
    fetch.mockClear();
    expect(
      await metaPublisher.prepare(
        { ...content, preparation: state },
        "token",
        "ig",
        checkpoint,
      ),
    ).toBe("child");
    expect(fetch.mock.calls.filter(([, init]) => init.body)).toHaveLength(1);
    expect(fetch.mock.calls.at(-1)![1].body.get("children")).toBe(
      "child,child",
    );
  });
  it.each(["REEL", "STORY_VIDEO"])(
    "prepares Facebook %s with persisted upload stages and trusted host",
    async (kind) => {
      const fetch = mockResponse({
        video_id: "video-id",
        upload_url: "https://evil.example.com/upload",
        success: true,
      });
      const checkpoint = vi.fn();
      const content = post({
        platform: "FACEBOOK",
        kind,
        mediaUrls: ["https://cdn.example.com/clip.mp4"],
      });
      expect(
        await metaPublisher.prepare(content, "token", "page", checkpoint),
      ).toBe("video-id");
      expect(String(fetch.mock.calls[0][0])).toContain(
        kind === "REEL" ? "/page/video_reels" : "/page/video_stories",
      );
      expect(String(fetch.mock.calls[1][0])).toMatch(
        /^https:\/\/rupload.facebook.com\/video-upload\//,
      );
      expect(fetch.mock.calls[1][1].headers).toMatchObject({
        Authorization: "OAuth token",
        file_url: "https://cdn.example.com/clip.mp4",
      });
      expect(fetch.mock.calls[1][1].redirect).toBe("error");
      fetch.mockClear();
      await metaPublisher.prepare(
        { ...content, preparation: checkpoint.mock.calls.at(-1)![0] },
        "token",
        "page",
      );
      expect(fetch).not.toHaveBeenCalled();
    },
  );
  it("uploads Facebook photos unpublished and references them in one album post", async () => {
    const fetch = mockResponse({ id: "photo", post_id: "page_post" });
    const content = post({
      platform: "FACEBOOK",
      kind: "CAROUSEL",
      mediaUrls: [
        "https://cdn.example.com/1.jpg",
        "https://cdn.example.com/2.jpg",
      ],
    });
    const containerId = await metaPublisher.prepare(content, "token", "page");
    expect(fetch.mock.calls[0][1].body.get("published")).toBe("false");
    expect(containerId).toBe('["photo","photo"]');
    await metaPublisher.publish({ ...content, containerId }, "token", "page");
    expect(
      JSON.parse(fetch.mock.calls[2][1].body.get("attached_media")),
    ).toEqual([{ media_fbid: "photo" }, { media_fbid: "photo" }]);
  });
  it("publishes a Facebook photo Story with a newly uploaded unpublished photo", async () => {
    const fetch = mockResponse({
      id: "photo",
      success: true,
      post_id: "story-post",
    });
    const content = post({ platform: "FACEBOOK", kind: "STORY_IMAGE" });
    const containerId = await metaPublisher.prepare(content, "token", "page");
    expect(
      await metaPublisher.publish({ ...content, containerId }, "token", "page"),
    ).toBe("story-post");
    expect(String(fetch.mock.calls[1][0])).toContain("/page/photo_stories");
    expect(fetch.mock.calls[1][1].body.get("photo_id")).toBe("photo");
    expect(fetch.mock.calls[1][1].body.has("caption")).toBe(false);
  });
  it.each(["REEL", "STORY_VIDEO"])(
    "finalizes Facebook %s and requires explicit success",
    async (kind) => {
      const fetch = mockResponse({ success: true });
      expect(
        await metaPublisher.publish(
          post({ platform: "FACEBOOK", kind, containerId: "video" }),
          "token",
          "page",
        ),
      ).toBe("video");
      expect(fetch.mock.calls[0][1].body.get("upload_phase")).toBe("finish");
      expect(fetch.mock.calls[0][1].body.has("description")).toBe(
        kind === "REEL",
      );
      mockResponse({ success: false });
      await expect(
        metaPublisher.publish(
          post({ platform: "FACEBOOK", kind }),
          "token",
          "page",
        ),
      ).rejects.toMatchObject({ rejected: false });
    },
  );
  it("publishes normal Facebook videos once using graph-video and a hosted URL", async () => {
    const fetch = mockResponse({ id: "video" });
    await metaPublisher.publish(
      post({
        platform: "FACEBOOK",
        kind: "VIDEO",
        mediaUrls: ["https://cdn.example.com/clip.mp4"],
      }),
      "token",
      "page",
    );
    expect(String(fetch.mock.calls[0][0])).toContain(
      "https://graph-video.facebook.com/",
    );
    expect(String(fetch.mock.calls[0][0])).toContain("/page/videos");
    expect(fetch.mock.calls[0][1].body.get("published")).toBe("true");
    expect(fetch.mock.calls[0][1].body.get("file_url")).toBe(
      "https://cdn.example.com/clip.mp4",
    );
  });
  it("keeps processing distinct from publication confirmation", async () => {
    mockResponse({
      status: {
        video_status: "processing",
        processing_phase: { status: "complete" },
        publishing_phase: { status: "not_started" },
      },
    });
    expect(
      await metaPublisher.containerStatus("video", "token", "FACEBOOK"),
    ).toBe("FINISHED");
    expect(
      await metaPublisher.publicationStatus(post({ kind: "REEL" }), "token"),
    ).toBe("IN_PROGRESS");
    mockResponse({ status: { publishing_phase: { status: "complete" } } });
    expect(
      await metaPublisher.publicationStatus(post({ kind: "REEL" }), "token"),
    ).toBe("PUBLISHED");
  });
  it("includes a native link preview for Facebook text posts", async () => {
    const fetch = mockResponse({ id: "post" });
    await metaPublisher.publish(
      post({
        platform: "FACEBOOK",
        kind: "TEXT",
        publishingOptions: { linkUrl: "https://kult.example.com/news" },
      }),
      "token",
      "page",
    );
    expect(fetch.mock.calls[0][1].body.get("link")).toBe(
      "https://kult.example.com/news",
    );
  });
});
