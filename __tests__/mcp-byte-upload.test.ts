import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Readable } from "node:stream";
import { createClient } from "@libsql/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "@/app/generated/prisma/client";

const memory = vi.hoisted(() => ({ objects: new Map<string, Buffer>(), store: vi.fn() }));
vi.mock("@/lib/scheduler/storage", async original => ({
  ...await original<typeof import("@/lib/scheduler/storage")>(),
  storeSchedulerMedia: memory.store, schedulerMediaUrl: async (_workspace: string, url: string) => url,
}));
vi.mock("@/lib/mcp/media-upload", async original => ({
  ...await original<typeof import("@/lib/mcp/media-upload")>(),
  openAttachment: async (url: string) => Readable.from([memory.objects.get(url)!]),
}));
import { beginByteUpload, appendByteUpload, completeByteUpload, abortByteUpload } from "@/lib/mcp/byte-upload";
import { MAX_INLINE_MEDIA_BYTES } from "@/lib/mcp/media-upload";
import { runMediaCleanupTick } from "@/lib/scheduler/cleanup";

let directory: string, db: PrismaClient;
const owner = { workspaceId: "byte-workspace", userId: "byte-owner" };
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
function mp4(size = MAX_INLINE_MEDIA_BYTES + 100) {
  const bytes = Buffer.alloc(size, 42); bytes.writeUInt32BE(24, 0); bytes.write("ftypisom", 4); return bytes;
}
const metadata = (size: number) => ({ platform: "FACEBOOK" as const, kind: "VIDEO" as const, contentType: "video/mp4", size });
const begin = (size: number, extra = {}) => beginByteUpload(owner, { ...metadata(size), ...extra }, { db });
const send = (uploadId: string, offset: number, bytes: Buffer) => appendByteUpload(owner,
  { ...metadata(bytes.length), uploadId, offset, dataBase64: bytes.toString("base64") }, { db });

beforeAll(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "kult-byte-test-"));
  const url = "file:" + path.join(directory, "test.db"), raw = createClient({ url });
  const root = path.join(process.cwd(), "prisma/turso-migrations");
  for (const name of (await readdir(root, { withFileTypes: true })).filter(e => e.isDirectory()).map(e => e.name).sort())
    await raw.executeMultiple(await readFile(path.join(root, name, "migration.sql"), "utf8"));
  raw.close(); db = new PrismaClient({ adapter: new PrismaLibSql({ url }) });
  await db.user.create({ data: { id: owner.userId, email: "byte-test@example.com" } });
  await db.workspace.create({ data: { id: owner.workspaceId, ownerId: owner.userId, name: "Byte test" } });
});
beforeEach(async () => {
  await db.agentMediaUpload.deleteMany(); await db.scheduledMediaCleanup.deleteMany();
  memory.objects.clear(); memory.store.mockReset();
  memory.store.mockImplementation(async (workspace, contentType, source, _limit, _signal, _size, options = {}) => {
    const url = `https://f005.backblazeb2.com/file/kult-media/scheduler/${workspace}/${options.objectId ?? randomUUID()}.mp4`;
    await options.beforeUpload?.(url);
    const chunks = []; for await (const chunk of source) chunks.push(chunk);
    const bytes = Buffer.concat(chunks); memory.objects.set(url, bytes);
    return { uploaded: true, mediaUrl: url, contentType, size: bytes.length, sha256: hash(bytes) };
  });
});
afterAll(async () => { await db?.$disconnect(); await rm(directory, { recursive: true, force: true }); });

describe("durable actual-byte upload sessions", () => {
  it("accepts files up to 1 GiB while enforcing the platform's smaller limits", async () => {
    const row = await begin(1024 ** 3); expect(row).toMatchObject({ totalSize: 1024 ** 3, nextOffset: 0, chunkBytes: 3_300_000 });
    await expect(begin(1024 ** 3 + 1)).rejects.toThrow("1024 MB");
    await expect(beginByteUpload(owner, { ...metadata(300 * 1024 ** 2 + 1), platform: "INSTAGRAM", kind: "REEL" }, { db })).rejects.toThrow("300 MB");
  });
  it("resumes with a stable identifier and joins exact original bytes", async () => {
    const bytes = mp4(), clientRequestId = randomUUID();
    const session = await begin(bytes.length, { clientRequestId, sha256: hash(bytes) });
    const id = "uploadId" in session ? session.uploadId : "";
    expect(await send(id, 0, bytes.subarray(0, MAX_INLINE_MEDIA_BYTES))).toMatchObject({ uploaded: false, nextOffset: MAX_INLINE_MEDIA_BYTES, nextChunkBytes: 100 });
    expect(await begin(bytes.length, { clientRequestId, sha256: hash(bytes) })).toMatchObject({ uploadId: id, nextOffset: MAX_INLINE_MEDIA_BYTES });
    await send(id, MAX_INLINE_MEDIA_BYTES, bytes.subarray(MAX_INLINE_MEDIA_BYTES));
    const result = await completeByteUpload(owner, id, { db });
    expect(result).toMatchObject({ uploaded: true, size: bytes.length, sha256: hash(bytes) });
    expect(memory.objects.get(result.mediaUrl!)!.equals(bytes)).toBe(true);
    expect(result.mediaUrl).not.toContain(clientRequestId);
    expect(await completeByteUpload(owner, id, { db })).toEqual(result);
    await expect(abortByteUpload(owner, id, { db })).rejects.toThrow("already completed");
    expect(memory.store).toHaveBeenCalledTimes(3);
    expect(await db.scheduledMediaCleanup.findUnique({ where: { url: result.mediaUrl! } })).toBeNull();
    expect(await db.scheduledMediaCleanup.count({ where: { availableAt: { lte: new Date() } } })).toBe(2);
  });
  it("accepts a retry only when it has the identical offset and bytes", async () => {
    const bytes = mp4(), row = await begin(bytes.length), id = "uploadId" in row ? row.uploadId : "";
    const chunk = bytes.subarray(0, MAX_INLINE_MEDIA_BYTES);
    await send(id, 0, chunk); await send(id, 0, chunk);
    expect(memory.store).toHaveBeenCalledTimes(1);
    const changed = Buffer.from(chunk); changed[100] ^= 1;
    await expect(send(id, 0, changed)).rejects.toThrow("Retry bytes differ");
    await expect(send(id, 5, bytes.subarray(MAX_INLINE_MEDIA_BYTES))).rejects.toThrow("nextOffset");
  });
  it("serializes concurrent writes to the same session", async () => {
    const bytes = mp4(), row = await begin(bytes.length), id = "uploadId" in row ? row.uploadId : "";
    const results = await Promise.allSettled([send(id, 0, bytes.subarray(0, MAX_INLINE_MEDIA_BYTES)), send(id, 0, bytes.subarray(0, MAX_INLINE_MEDIA_BYTES))]);
    expect(results.filter(r => r.status === "fulfilled").length).toBeGreaterThanOrEqual(1);
    expect(memory.store).toHaveBeenCalledTimes(1);
    expect((await db.agentMediaUpload.findUniqueOrThrow({ where: { id } })).nextOffset).toBe(MAX_INLINE_MEDIA_BYTES);
  });
  it("rejects missing, premature and mismatched chunks without publishing a file", async () => {
    const bytes = mp4(), row = await begin(bytes.length), id = "uploadId" in row ? row.uploadId : "";
    await expect(completeByteUpload(owner, id, { db })).rejects.toThrow("incomplete");
    await expect(send(id, 0, bytes.subarray(0, 100))).rejects.toThrow("exactly");
    expect(memory.store).not.toHaveBeenCalled();
    expect((await db.agentMediaUpload.findUniqueOrThrow({ where: { id } })).leaseOwner).toBeNull();
  });
  it("binds a session to its user and workspace", async () => {
    const row = await begin(100), id = "uploadId" in row ? row.uploadId : "";
    for (const other of [{ ...owner, userId: "other" }, { ...owner, workspaceId: "other" }]) {
      await expect(completeByteUpload(other, id, { db })).rejects.toThrow("not found");
      await expect(abortByteUpload(other, id, { db })).rejects.toThrow("not found");
      await expect(appendByteUpload(other, { ...metadata(100), uploadId: id, offset: 0, dataBase64: mp4(100).toString("base64") }, { db })).rejects.toThrow("closed");
    }
    expect(memory.store).not.toHaveBeenCalled();
  });
  it("rejects an incorrect original checksum before saving completed state", async () => {
    const bytes = mp4(100), row = await begin(bytes.length, { sha256: "0".repeat(64) }), id = "uploadId" in row ? row.uploadId : "";
    await send(id, 0, bytes);
    await expect(completeByteUpload(owner, id, { db })).rejects.toThrow("complete file checksum");
    expect((await db.agentMediaUpload.findUniqueOrThrow({ where: { id } })).state).toBe("OPEN");
    expect(memory.objects.size).toBe(1);
  });
  it("keeps a durable cleanup job even if storage fails before a chunk is recorded", async () => {
    const bytes = mp4(100), row = await begin(bytes.length), id = "uploadId" in row ? row.uploadId : "";
    memory.store.mockImplementationOnce(async (_w, _t, _s, _l, _a, _e, options) => {
      await options.beforeUpload("https://f005.backblazeb2.com/file/kult-media/scheduler/byte-workspace/00000000-0000-0000-0000-000000000001.mp4");
      throw Error("upload failed");
    });
    await expect(send(id, 0, bytes)).rejects.toThrow("upload failed");
    expect(await db.scheduledMediaCleanup.count()).toBe(1);
    expect((await db.agentMediaUpload.findUniqueOrThrow({ where: { id } })).nextOffset).toBe(0);
  });
  it("aborts an incomplete session, makes cleanup due and blocks further writes", async () => {
    const bytes = mp4(), row = await begin(bytes.length), id = "uploadId" in row ? row.uploadId : "";
    await send(id, 0, bytes.subarray(0, MAX_INLINE_MEDIA_BYTES));
    expect(await abortByteUpload(owner, id, { db })).toMatchObject({ aborted: true });
    expect(await abortByteUpload(owner, id, { db })).toMatchObject({ aborted: true });
    await expect(send(id, MAX_INLINE_MEDIA_BYTES, bytes.subarray(MAX_INLINE_MEDIA_BYTES))).rejects.toThrow("closed");
    expect(await db.scheduledMediaCleanup.count({ where: { availableAt: { lte: new Date() } } })).toBe(1);
  });
  it("denies expired sessions and stable IDs reused with different metadata", async () => {
    const clientRequestId = randomUUID(); await begin(100, { clientRequestId });
    await expect(begin(101, { clientRequestId })).rejects.toThrow("different file metadata");
    await db.agentMediaUpload.update({ where: { id: clientRequestId }, data: { expiresAt: new Date(0) } });
    await expect(begin(100, { clientRequestId })).rejects.toThrow("expired");
    await expect(send(clientRequestId, 0, mp4(100))).rejects.toThrow("expired");
    await runMediaCleanupTick({ db, remove: async () => {} });
    expect(await db.agentMediaUpload.count()).toBe(0);
  });
});
