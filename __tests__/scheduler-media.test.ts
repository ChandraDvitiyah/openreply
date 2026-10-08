import { describe, expect, it } from "vitest";
import { postInputSchema } from "@/lib/scheduler/validation";
import { validateUpload } from "@/lib/scheduler/media-files";
const parse = (extra = {}) =>
  postInputSchema.parse({
    title: "Post",
    platform: "INSTAGRAM",
    accountId: "ig",
    kind: "IMAGE",
    mediaUrls: ["https://cdn.example.com/image.jpg"],
    timezone: "UTC",
    intent: "now",
    ...extra,
  });
describe("media capability validation without processing", () => {
  it.each(["STORY_IMAGE", "STORY_VIDEO"])(
    "accepts %s for both platforms",
    (kind) => {
      for (const platform of ["FACEBOOK", "INSTAGRAM"])
        expect(
          parse({
            platform,
            kind,
            mediaUrls: [
              kind === "STORY_VIDEO"
                ? "https://cdn.example.com/clip.mp4"
                : "https://cdn.example.com/image.jpg",
            ],
          }).kind,
        ).toBe(kind);
    },
  );
  it("rejects Story captions instead of silently discarding them", () => {
    expect(() =>
      parse({ kind: "STORY_IMAGE", caption: "Text overlay" }),
    ).toThrow("Stories do not publish captions");
  });
  it("accepts signed extensionless video links with explicit media types", () => {
    expect(
      parse({
        kind: "REEL",
        mediaUrls: ["https://cdn.example.com/asset?signature=abc"],
        publishingOptions: { mediaTypes: ["VIDEO"] },
      }).kind,
    ).toBe("REEL");
  });
  it("accepts mixed Instagram carousels and rejects mixed Facebook albums", () => {
    const content = {
      kind: "CAROUSEL",
      mediaUrls: [
        "https://cdn.example.com/1.jpg",
        "https://cdn.example.com/2.mp4",
      ],
    };
    expect(parse(content).kind).toBe("CAROUSEL");
    expect(() => parse({ ...content, platform: "FACEBOOK" })).toThrow(
      "images only",
    );
  });
  it.each(["mp3", "wav", "m4a", "aac", "ogg", "flac"])(
    "rejects standalone %s audio links",
    (extension) => {
      expect(() =>
        parse({ mediaUrls: [`https://cdn.example.com/audio.${extension}`] }),
      ).toThrow("Standalone audio");
    },
  );
  it("does not convert unsupported Instagram image files", () => {
    expect(() =>
      validateUpload({ type: "image/png", size: 100 }, "INSTAGRAM", "IMAGE"),
    ).toThrow("does not convert");
    expect(() =>
      parse({ mediaUrls: ["https://cdn.example.com/image.png"] }),
    ).toThrow("without conversion");
  });
  it("validates upload sizes, empty files and platform types", () => {
    expect(() =>
      validateUpload(
        { type: "image/jpeg", size: 9 * 1024 ** 2 },
        "INSTAGRAM",
        "IMAGE",
      ),
    ).toThrow("8 MB");
    expect(() =>
      validateUpload(
        { type: "video/mp4", size: 301 * 1024 ** 2 },
        "INSTAGRAM",
        "REEL",
      ),
    ).toThrow("300 MB");
    expect(() =>
      validateUpload({ type: "video/mp4", size: 100 }, "FACEBOOK", "CAROUSEL"),
    ).toThrow("images only");
    expect(() =>
      validateUpload({ type: "audio/mpeg", size: 100 }, "FACEBOOK", "VIDEO"),
    ).toThrow("Standalone audio");
    expect(() =>
      validateUpload({ type: "image/jpeg", size: 0 }, "FACEBOOK", "IMAGE"),
    ).toThrow("empty");
    expect(() =>
      validateUpload({ type: "video/mp4", size: 100 }, "INSTAGRAM", "REEL"),
    ).not.toThrow();
  });
  it("restricts platform specific options", () => {
    expect(() =>
      parse({ publishingOptions: { audioName: "Original" } }),
    ).toThrow("apply to Instagram Reels");
    expect(() =>
      parse({ publishingOptions: { linkUrl: "https://example.com/" } }),
    ).toThrow("Facebook text");
    expect(() =>
      parse({ publishingOptions: { mediaTypes: ["IMAGE", "VIDEO"] } }),
    ).toThrow("every item");
    expect(
      parse({
        platform: "FACEBOOK",
        kind: "TEXT",
        mediaUrls: [],
        publishingOptions: { linkUrl: "https://example.com/" },
      }).kind,
    ).toBe("TEXT");
  });
});
