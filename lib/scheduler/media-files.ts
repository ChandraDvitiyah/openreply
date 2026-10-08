import { isVideo, type PostKind } from "./capabilities";
export const uploadMimeTypes = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/bmp",
  "image/tiff",
  "video/mp4",
  "video/quicktime",
];
export function uploadSizeLimit(
  platform: string,
  kind: PostKind,
  video: boolean,
) {
  if (!video) return (platform === "INSTAGRAM" ? 8 : 10) * 1024 ** 2;
  if (platform === "INSTAGRAM")
    return (kind === "STORY_VIDEO" ? 100 : 300) * 1024 ** 2;
  return 1024 ** 3;
}
// Validate only. Kult never converts, transcodes, crops, or mixes creator files.
export function validateUpload(
  file: Pick<File, "type" | "size">,
  platform: string,
  kind: PostKind,
): void {
  const video = file.type.startsWith("video/");
  if (!uploadMimeTypes.includes(file.type))
    throw new Error(
      "Choose a supported image, MP4, or MOV file. Standalone audio is not supported; use a video with audio already included.",
    );
  if (kind !== "CAROUSEL" && video !== isVideo(kind))
    throw new Error(
      `Choose ${isVideo(kind) ? "a video" : "an image"} for this post type.`,
    );
  if (platform === "FACEBOOK" && kind === "CAROUSEL" && video)
    throw new Error("Facebook albums support images only.");
  if (platform === "INSTAGRAM" && !video && file.type !== "image/jpeg")
    throw new Error(
      "Instagram requires JPEG images. Upload a JPEG; Kult does not convert files.",
    );
  if (file.size <= 0) throw new Error("This file is empty.");
  const limit = uploadSizeLimit(platform, kind, video);
  if (file.size > limit)
    throw new Error(
      `This ${video ? "video" : "image"} must be under ${limit / 1024 ** 2} MB for this post type.`,
    );
}
