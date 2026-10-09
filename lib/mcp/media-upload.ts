import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { request as httpsRequest } from "node:https";
import type { IncomingMessage } from "node:http";
import { z } from "zod";
import { postKinds, supportedKinds, type PostKind } from "@/lib/scheduler/capabilities";
import { uploadSizeLimit, validateUpload } from "@/lib/scheduler/media-files";
import { storeSchedulerMedia } from "@/lib/scheduler/storage";

export const MAX_INLINE_MEDIA_BYTES = 3_000_000;
export class MediaUploadError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
const platform = z.enum(["INSTAGRAM", "FACEBOOK"]);
const kind = z.enum(postKinds);
// OpenAI fileParams requires these four properties; only the first two are
// required. The host resolves attachments; the model need not invent URLs.
export const attachmentInput = {
  platform, kind,
  file: z.object({
    download_url: z.url().max(8192), file_id: z.string().min(1).max(512),
    mime_type: z.string().max(100).optional(), file_name: z.string().max(512).optional(),
  }).strict(),
};
export const bytesInput = {
  platform, kind, contentType: z.string().max(100),
  dataBase64: z.string().min(1).max(4 * Math.ceil(MAX_INLINE_MEDIA_BYTES / 3))
    .describe("Actual file bytes encoded as standard base64, without a data URL prefix. Maximum 3,000,000 decoded bytes. For larger ChatGPT attachments use upload_media_file."),
};
export const uploadOutput = {
  status: z.literal(200), uploaded: z.literal(true), mediaUrl: z.url(),
  contentType: z.string(), size: z.number().int().positive(), sha256: z.string().length(64),
};

const blocked = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24],
  ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blocked.addSubnet(address, prefix, "ipv4");
blocked.addSubnet("2001::", 23, "ipv6");
blocked.addSubnet("2001:db8::", 32, "ipv6");
blocked.addSubnet("2002::", 16, "ipv6");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
export function isPublicAddress(address: string) {
  const family = isIP(address);
  return family === 4 ? !blocked.check(address, "ipv4")
    : family === 6 && globalV6.check(address, "ipv6") && !blocked.check(address, "ipv6");
}

// Revalidate and pin DNS for every redirect, preventing both metadata access
// and DNS rebinding. Credentials/cookies from MCP are never forwarded.
export async function openAttachment(value: string, signal: AbortSignal): Promise<IncomingMessage> {
  let url: URL;
  try { url = new URL(value); } catch { throw new MediaUploadError("Attach a file with a valid HTTPS download link."); }
  for (let redirect = 0; redirect <= 4; redirect++) {
    if (url.protocol !== "https:" || url.username || url.password || url.hash ||
        (url.port && url.port !== "443") || isIP(url.hostname.replace(/^\[|\]$/g, "")) ||
        !url.hostname.includes(".") || url.hostname.endsWith("."))
      throw new MediaUploadError("The file download link must use a public HTTPS host.");
    let addresses;
    try { addresses = await lookup(url.hostname, { all: true }); }
    catch { throw new MediaUploadError("The file download host could not be reached. Attach the file again.", 502); }
    if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address)))
      throw new MediaUploadError("Private network file download links are not allowed.");
    const pinned = addresses.find(({ family }) => family === 4) ?? addresses[0];
    const response = await new Promise<IncomingMessage>((resolve, reject) => {
      const req = httpsRequest(url, {
        signal, headers: { Accept: "*/*", "Accept-Encoding": "identity" },
        lookup: (_host, options, callback) => {
          if (typeof options === "object" && options.all) callback(null, [pinned]);
          else callback(null, pinned.address, pinned.family);
        },
      }, resolve);
      req.setTimeout(30_000, () => req.destroy(new Error("File download timed out")));
      req.on("error", () => reject(new MediaUploadError(signal.aborted
        ? "The file transfer timed out. Attach the file again."
        : "The file download failed. Attach the file again.", 502)));
      req.end();
    });
    if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0)) {
      response.destroy();
      if (!response.headers.location) break;
      url = new URL(response.headers.location, url);
      continue;
    }
    if (response.statusCode !== 200) {
      response.destroy();
      throw new MediaUploadError("The file download link expired or is unavailable. Attach the file again.", 502);
    }
    return response;
  }
  throw new MediaUploadError("The file download redirected too many times.", 502);
}

function detectedType(bytes: Buffer): string | undefined {
  if (bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return "image/jpeg";
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"))) return "image/gif";
  if (bytes.subarray(0, 2).toString() === "BM") return "image/bmp";
  if (["49492a00", "4d4d002a"].includes(bytes.subarray(0, 4).toString("hex"))) return "image/tiff";
  if (bytes.length >= 12 && bytes.subarray(4, 8).toString() === "ftyp") {
    const brand = bytes.subarray(8, 12).toString("ascii");
    if (brand === "qt  ") return "video/quicktime";
    if (/^(isom|iso[2-9]|mp41|mp42|avc1|M4V |M4VH|M4VP|MSNV|dash|cmfc|cmfs)$/.test(brand)) return "video/mp4";
  }
  if (bytes.length >= 8 && ["moov", "mdat", "wide"].includes(bytes.subarray(4, 8).toString())) return "video/quicktime";
}
function checkFormat(bytes: Buffer, claimed?: string) {
  const detected = detectedType(bytes);
  const type = claimed?.split(";")[0].trim().toLowerCase();
  if (!detected || (type && type !== "application/octet-stream" && type !== detected))
    throw new MediaUploadError("The file bytes do not match a supported image or MP4/MOV format. Kult does not convert files.");
  return detected;
}
function validate(platform: string, kind: PostKind, contentType: string, size: number) {
  try {
    if (kind === "TEXT" || !supportedKinds(platform).includes(kind)) throw new Error("Choose a supported media post type.");
    validateUpload({ type: contentType, size }, platform, kind);
  } catch (error) { throw new MediaUploadError(error instanceof Error ? error.message : "Invalid media upload."); }
}
export async function uploadMediaBytes(workspaceId: string, args: z.infer<z.ZodObject<typeof bytesInput>>) {
  // Buffer.from alone silently accepts malformed and truncated base64.
  if (args.dataBase64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(args.dataBase64))
    throw new MediaUploadError("Provide valid standard base64 file bytes without a data URL prefix.");
  const bytes = Buffer.from(args.dataBase64, "base64");
  if (!bytes.length || bytes.toString("base64") !== args.dataBase64) throw new MediaUploadError("Invalid base64 file bytes.");
  if (bytes.length > MAX_INLINE_MEDIA_BYTES) throw new MediaUploadError("Use upload_media_file for files larger than 3,000,000 bytes.", 413);
  const contentType = checkFormat(bytes.subarray(0, 512), args.contentType);
  validate(args.platform, args.kind, contentType, bytes.length);
  async function* source() { yield bytes; }
  return storeSchedulerMedia(workspaceId, contentType, source(), bytes.length, AbortSignal.timeout(240_000), bytes.length);
}
export async function uploadMediaAttachment(workspaceId: string, args: z.infer<z.ZodObject<typeof attachmentInput>>) {
  const signal = AbortSignal.timeout(240_000);
  const response = await openAttachment(args.file.download_url, signal);
  const iterator = response[Symbol.asyncIterator]();
  try {
    const prefix: Buffer[] = [];
    let prefixSize = 0;
    while (prefixSize < 32) {
      const next = await iterator.next();
      if (next.done) break;
      const chunk = Buffer.from(next.value); prefix.push(chunk); prefixSize += chunk.length;
    }
    const contentType = checkFormat(Buffer.concat(prefix).subarray(0, 512), args.file.mime_type ?? response.headers["content-type"]);
    const headerSize = response.headers["content-length"];
    const size = headerSize === undefined ? undefined : Number(headerSize);
    if (size !== undefined && (!Number.isSafeInteger(size) || size <= 0)) throw new MediaUploadError("The file download returned an invalid size.");
    validate(args.platform, args.kind, contentType, size ?? prefixSize);
    const limit = uploadSizeLimit(args.platform, args.kind, contentType.startsWith("video/"));
    async function* source() {
      yield* prefix;
      for (;;) { const next = await iterator.next(); if (next.done) break; yield Buffer.from(next.value); }
    }
    return await storeSchedulerMedia(workspaceId, contentType, source(), limit, signal, size);
  } finally { response.destroy(); }
}
