import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import type { AgentMediaUpload } from "@/app/generated/prisma/client";
import { postKinds } from "@/lib/scheduler/capabilities";
import { schedulerMediaUrl, storeSchedulerMedia, StorageError } from "@/lib/scheduler/storage";
import { checkFormat, decodeMediaBytes, MAX_INLINE_MEDIA_BYTES, MediaUploadError,
  openAttachment, validate, type bytesInput } from "./media-upload";

const SESSION_MS = 2 * 60 * 60_000;
const CLEANUP_GRACE_MS = 16 * 60_000;
export const beginBytesInput = {
  platform: z.enum(["INSTAGRAM", "FACEBOOK"]), kind: z.enum(postKinds),
  contentType: z.string().max(100), size: z.number().int().positive().max(1024 ** 3),
  sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  clientRequestId: z.uuid().optional().describe("Reuse a UUID to resume the same upload after a timeout."),
};
export const sessionInput = { uploadId: z.uuid() };
export const bytesOutput = {
  status: z.literal(200), uploaded: z.boolean(), mediaUrl: z.url().optional(),
  contentType: z.string(), size: z.number().int().nonnegative(),
  sha256: z.string().length(64).optional(), uploadId: z.uuid().optional(),
  totalSize: z.number().int().positive().optional(), nextOffset: z.number().int().nonnegative().optional(),
  chunkBytes: z.number().int().positive().optional(), nextChunkBytes: z.number().int().nonnegative().optional(),
  expiresAt: z.iso.datetime().optional(),
};
type Owner = { workspaceId: string; userId: string };
type Part = { offset: number; size: number; sha256: string; url: string };
type Options = { db?: typeof prisma };
type ByteArgs = z.infer<z.ZodObject<typeof bytesInput>>;
function progress(row: AgentMediaUpload) {
  return { uploaded: false, uploadId: row.id, size: row.nextOffset,
    totalSize: row.size, nextOffset: row.nextOffset, chunkBytes: MAX_INLINE_MEDIA_BYTES,
    nextChunkBytes: Math.min(MAX_INLINE_MEDIA_BYTES, row.size - row.nextOffset),
    contentType: row.contentType, expiresAt: row.expiresAt.toISOString() };
}
function completed(row: AgentMediaUpload) {
  return { uploaded: true, mediaUrl: row.mediaUrl!, size: row.size,
    contentType: row.contentType, sha256: row.sha256! };
}
function parts(row: AgentMediaUpload): Part[] { return JSON.parse(row.parts); }
async function owned(db: typeof prisma, owner: Owner, id: string) {
  const row = await db.agentMediaUpload.findFirst({ where: { id, ...owner } });
  if (!row) throw new MediaUploadError("Byte upload not found in your account and workspace.", 404);
  return row;
}
async function claim(db: typeof prisma, owner: Owner, id: string) {
  const leaseOwner = randomUUID(), now = new Date();
  const changed = await db.agentMediaUpload.updateMany({ where: { id, ...owner,
    state: "OPEN", expiresAt: { gt: now },
    OR: [{ leaseOwner: null }, { leaseExpiresAt: { lt: now } }] },
    data: { leaseOwner, leaseExpiresAt: new Date(Date.now() + 5 * 60_000) } });
  if (!changed.count) throw new MediaUploadError("Upload is busy, expired, or closed. Retry after an in-flight call finishes or begin a new upload.", 409);
  return { row: await owned(db, owner, id), leaseOwner };
}
async function release(db: typeof prisma, id: string, leaseOwner: string) {
  await db.agentMediaUpload.updateMany({ where: { id, leaseOwner },
    data: { leaseOwner: null, leaseExpiresAt: null } });
}
async function stage(db: typeof prisma, row: AgentMediaUpload, url: string) {
  // Register before storage writes: a crash cannot leave untracked chunk bytes.
  await db.scheduledMediaCleanup.upsert({ where: { url },
    create: { url, workspaceId: row.workspaceId,
      availableAt: new Date(row.expiresAt.getTime() + CLEANUP_GRACE_MS) }, update: {} });
}
export async function beginByteUpload(owner: Owner, args: z.infer<z.ZodObject<typeof beginBytesInput>>, options: Options = {}) {
  const db = options.db ?? prisma;
  validate(args.platform, args.kind, args.contentType, args.size);
  const id = args.clientRequestId ?? randomUUID();
  const row = await db.agentMediaUpload.upsert({ where: { id }, update: {}, create: {
    id, ...owner, platform: args.platform, kind: args.kind, contentType: args.contentType,
    size: args.size, expectedSha256: args.sha256, expiresAt: new Date(Date.now() + SESSION_MS) } });
  if (row.workspaceId !== owner.workspaceId || row.userId !== owner.userId)
    throw new MediaUploadError("Upload identifier is unavailable.", 409);
  if (row.platform !== args.platform || row.kind !== args.kind || row.contentType !== args.contentType ||
      row.size !== args.size || row.expectedSha256 !== (args.sha256 ?? null))
    throw new MediaUploadError("This upload identifier belongs to different file metadata.", 409);
  if (row.state === "COMPLETED") return completed(row);
  if (row.state !== "OPEN" || row.expiresAt.getTime() <= Date.now())
    throw new MediaUploadError("Upload expired or was aborted. Begin with a new identifier.", 409);
  return progress(row);
}
export async function appendByteUpload(owner: Owner, args: ByteArgs, options: Options = {}) {
  if (!args.uploadId || args.offset === undefined) throw new MediaUploadError("Provide uploadId and the returned nextOffset for a byte chunk.");
  const db = options.db ?? prisma;
  const bytes = decodeMediaBytes(args.dataBase64);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const { row, leaseOwner } = await claim(db, owner, args.uploadId);
  try {
    if (row.platform !== args.platform || row.kind !== args.kind || row.contentType !== args.contentType)
      throw new MediaUploadError("Chunk metadata must match the upload session.");
    const uploaded = parts(row);
    const earlier = uploaded.find(p => p.offset === args.offset);
    if (earlier) {
      if (earlier.size !== bytes.length || earlier.sha256 !== sha256)
        throw new MediaUploadError("Retry bytes differ from the previously accepted chunk.", 409);
      return progress(row);
    }
    if (args.offset !== row.nextOffset) throw new MediaUploadError(`Send the chunk at nextOffset ${row.nextOffset}.`, 409);
    const required = Math.min(MAX_INLINE_MEDIA_BYTES, row.size - row.nextOffset);
    if (bytes.length !== required || required <= 0)
      throw new MediaUploadError(`This chunk must contain exactly ${required} decoded bytes.`);
    if (!row.nextOffset) checkFormat(bytes.subarray(0, 512), row.contentType);
    async function* source() { yield bytes; }
    const stored = await storeSchedulerMedia(owner.workspaceId, row.contentType, source(), bytes.length,
      AbortSignal.timeout(240_000), bytes.length, { beforeUpload: url => stage(db, row, url) });
    uploaded.push({ offset: row.nextOffset, size: bytes.length, sha256, url: stored.mediaUrl });
    const saved = await db.agentMediaUpload.update({ where: { id: row.id, leaseOwner },
      data: { parts: JSON.stringify(uploaded), nextOffset: row.nextOffset + bytes.length } });
    return progress(saved);
  } finally { await release(db, row.id, leaseOwner); }
}
export async function completeByteUpload(owner: Owner, id: string, options: Options = {}) {
  const db = options.db ?? prisma;
  const existing = await owned(db, owner, id);
  if (existing.state === "COMPLETED") return completed(existing);
  const { row, leaseOwner } = await claim(db, owner, id);
  try {
    if (row.nextOffset !== row.size) throw new MediaUploadError(`Upload is incomplete. Resume at nextOffset ${row.nextOffset}.`, 409);
    const signal = AbortSignal.timeout(240_000), fullHash = createHash("sha256");
    async function* source() {
      for (const part of parts(row)) {
        const response = await openAttachment(await schedulerMediaUrl(owner.workspaceId, part.url, 900), signal);
        const partHash = createHash("sha256"); let size = 0;
        try {
          for await (const raw of response) {
            const chunk = Buffer.from(raw); size += chunk.length;
            if (size > part.size) throw new StorageError("Stored chunk size changed.");
            partHash.update(chunk); fullHash.update(chunk); yield chunk;
          }
          if (size !== part.size || partHash.digest("hex") !== part.sha256)
            throw new StorageError("Stored chunk checksum did not match. Abort and upload the original bytes again.");
        } finally { response.destroy(); }
      }
      const checksum = fullHash.digest("hex");
      if (row.expectedSha256 && checksum !== row.expectedSha256)
        throw new StorageError("The complete file checksum does not match the supplied SHA-256.");
    }
    const stored = await storeSchedulerMedia(owner.workspaceId, row.contentType, source(), row.size,
      signal, row.size, { objectId: row.objectId, beforeUpload: url => stage(db, row, url) });
    await db.$transaction(async tx => {
      await tx.agentMediaUpload.update({ where: { id: row.id, leaseOwner }, data: {
        state: "COMPLETED", mediaUrl: stored.mediaUrl, sha256: stored.sha256,
        leaseOwner: null, leaseExpiresAt: null } });
      await tx.scheduledMediaCleanup.deleteMany({ where: { url: stored.mediaUrl, state: "PENDING" } });
      await tx.scheduledMediaCleanup.updateMany({ where: { url: { in: parts(row).map(p => p.url) }, state: "PENDING" },
        data: { availableAt: new Date() } });
    });
    return stored;
  } finally { await release(db, row.id, leaseOwner); }
}
export async function abortByteUpload(owner: Owner, id: string, options: Options = {}) {
  const db = options.db ?? prisma;
  const existing = await owned(db, owner, id);
  if (existing.state === "ABORTED") return { aborted: true, uploadId: id };
  if (existing.state === "COMPLETED") throw new MediaUploadError("Upload already completed; its media reference remains ready for use.", 409);
  const { row, leaseOwner } = await claim(db, owner, id);
  try {
    await db.$transaction(async tx => {
      await tx.agentMediaUpload.update({ where: { id, leaseOwner }, data: { state: "ABORTED", leaseOwner: null, leaseExpiresAt: null } });
      await tx.scheduledMediaCleanup.updateMany({ where: { url: { in: parts(row).map(p => p.url) }, state: "PENDING" },
        data: { availableAt: new Date() } });
    });
    return { aborted: true, uploadId: id };
  } finally { await release(db, id, leaseOwner); }
}
