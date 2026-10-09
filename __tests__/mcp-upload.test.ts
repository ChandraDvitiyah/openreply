import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { Readable } from "node:stream";
import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
const network = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn(), send: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: network.lookup }));
vi.mock("node:https", () => ({ request: network.request }));
vi.mock("@aws-sdk/client-s3", async (original) => ({
  ...await original<typeof import("@aws-sdk/client-s3")>(),
  S3Client: class { send = network.send; },
}));
import { uploadMediaBytes, uploadMediaAttachment, openAttachment, isPublicAddress } from "@/lib/mcp/media-upload";
import { storeSchedulerMedia } from "@/lib/scheduler/storage";

let sequence = 0;
const jpeg = (size = 64) => Buffer.concat([Buffer.from([255, 216, 255]), Buffer.alloc(size - 3, 42)]);
const attachment = { platform: "FACEBOOK" as const, kind: "IMAGE" as const,
  file: { download_url: "https://files.oaiusercontent.com/file-123?signature=private", file_id: "file-123", mime_type: "image/jpeg" } };
function download(chunks: Buffer[], headers: Record<string, string> = {}, statusCode = 200) {
  const response = Object.assign(Readable.from(chunks), { statusCode, headers });
  network.request.mockImplementationOnce((_url, _options, callback) => {
    const req = Object.assign(new EventEmitter(), { setTimeout: vi.fn(), end: () => queueMicrotask(() => callback(response)) });
    return req;
  });
  return response;
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("B2_APPLICATION_KEY_ID", "upload-test-" + ++sequence);
  vi.stubEnv("B2_APPLICATION_KEY", "storage-secret");
  vi.stubEnv("B2_BUCKET_ID", "test-bucket");
  network.lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  network.send.mockImplementation(async command => {
    if (command.constructor.name === "CreateMultipartUploadCommand") return { UploadId: "multipart-test" };
    if (command.constructor.name === "UploadPartCommand") return { ETag: "part-" + command.input.PartNumber };
    return { ETag: "stored" };
  });
  vi.stubGlobal("fetch", vi.fn()
    .mockResolvedValueOnce(Response.json({ accountId: "account", authorizationToken: "private-token",
      apiInfo: { storageApi: { apiUrl: "https://api005.backblazeb2.com", downloadUrl: "https://f005.backblazeb2.com",
        s3ApiUrl: "https://s3.us-west-005.backblazeb2.com", allowed: { capabilities: ["listBuckets", "writeFiles", "readFiles"] } } } }))
    .mockResolvedValueOnce(Response.json({ buckets: [{ bucketId: "test-bucket", bucketName: "kult-media", bucketType: "allPrivate" }] })));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const commands = (name: string) => network.send.mock.calls.map(([command]) => command).filter(command => command.constructor.name === name);

describe("MCP media byte transfer", () => {
  it("writes exact base64-decoded bytes to workspace storage and returns their checksum", async () => {
    const bytes = jpeg();
    const result = await uploadMediaBytes("workspace_one", { platform: "INSTAGRAM", kind: "IMAGE", contentType: "image/jpeg", dataBase64: bytes.toString("base64") });
    expect(commands("PutObjectCommand")[0].input).toMatchObject({ Key: expect.stringMatching(/^scheduler\/workspace_one\/[a-f0-9-]+\.jpg$/), Body: bytes, ContentLength: bytes.length });
    expect(result).toMatchObject({ uploaded: true, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
    expect(JSON.stringify(result)).not.toMatch(/storage-secret|private-token|uploadUrl/);
  });
  it.each(["bad!", "data:image/jpeg;base64,/9j/", "/9j", "===="])("rejects malformed byte encoding %s before storage", async dataBase64 => {
    await expect(uploadMediaBytes("workspace_one", { platform: "FACEBOOK", kind: "IMAGE", contentType: "image/jpeg", dataBase64 })).rejects.toThrow(/base64/);
    expect(network.send).not.toHaveBeenCalled();
  });
  it("rejects a MIME mismatch instead of changing creator bytes", async () => {
    await expect(uploadMediaBytes("workspace_one", { platform: "FACEBOOK", kind: "IMAGE", contentType: "image/png", dataBase64: jpeg().toString("base64") })).rejects.toThrow("file bytes");
    expect(network.send).not.toHaveBeenCalled();
  });
  it("transfers a ChatGPT attachment without requiring a size or MIME from the host", async () => {
    const bytes = jpeg(); download([bytes.subarray(0, 12), bytes.subarray(12)]);
    const result = await uploadMediaAttachment("workspace_two", { ...attachment, file: { download_url: attachment.file.download_url, file_id: "file-123" } });
    expect(commands("PutObjectCommand")[0].input.Body).toEqual(bytes);
    expect(result.mediaUrl).toContain("/scheduler/workspace_two/");
    const options = network.request.mock.calls[0][1];
    expect(options.headers).not.toHaveProperty("Authorization");
    expect(options.headers).not.toHaveProperty("Cookie");
    const pinned = vi.fn(); options.lookup("files.oaiusercontent.com", { all: true }, pinned);
    expect(pinned).toHaveBeenCalledWith(null, [{ address: "93.184.216.34", family: 4 }]);
  });
  it("streams an attachment larger than the inline limit as exact multipart bytes", async () => {
    const bytes = jpeg(9 * 1024 ** 2);
    download([bytes.subarray(0, 128), bytes.subarray(128)], { "content-length": String(bytes.length) });
    const result = await uploadMediaAttachment("workspace_one", attachment);
    const parts = commands("UploadPartCommand");
    expect(parts).toHaveLength(2);
    expect(parts[0].input.Body.length).toBe(8 * 1024 ** 2);
    expect(Buffer.concat(parts.map(part => part.input.Body)).equals(bytes)).toBe(true);
    expect(commands("CompleteMultipartUploadCommand")[0].input.MultipartUpload.Parts).toEqual([{ PartNumber: 1, ETag: "part-1" }, { PartNumber: 2, ETag: "part-2" }]);
    expect(result.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
  });
  it("aborts storage when a size-less attachment exceeds the platform limit", async () => {
    download([jpeg(8 * 1024 ** 2), Buffer.alloc(3 * 1024 ** 2)]);
    await expect(uploadMediaAttachment("workspace_one", attachment)).rejects.toThrow("size limit");
    expect(commands("AbortMultipartUploadCommand")).toHaveLength(1);
    expect(commands("CompleteMultipartUploadCommand")).toHaveLength(0);
  });
  it("does not publish an incomplete multipart download", async () => {
    const bytes = jpeg(9 * 1024 ** 2);
    download([bytes], { "content-length": String(bytes.length + 100) });
    await expect(uploadMediaAttachment("workspace_one", attachment)).rejects.toThrow("incomplete");
    expect(commands("AbortMultipartUploadCommand")).toHaveLength(1);
    expect(commands("CompleteMultipartUploadCommand")).toHaveLength(0);
  });
  it("sanitizes provider failures and aborts failed multipart uploads", async () => {
    network.send.mockImplementation(async command => {
      if (command.constructor.name === "CreateMultipartUploadCommand") return { UploadId: "test" };
      if (command.constructor.name === "AbortMultipartUploadCommand") return {};
      throw Error("private provider secret signed-url");
    });
    async function* source() { yield jpeg(8 * 1024 ** 2); }
    await expect(storeSchedulerMedia("workspace_one", "image/jpeg", source(), 10 * 1024 ** 2, new AbortController().signal)).rejects.toThrow("Storage could not complete");
    expect(commands("AbortMultipartUploadCommand")).toHaveLength(1);
  });
});

describe("attachment network boundaries", () => {
  it.each(["127.0.0.1", "10.1.2.3", "100.100.100.200", "169.254.169.254", "192.168.1.1", "172.16.1.1", "::1", "fe80::1", "fc00::1", "::ffff:127.0.0.1", "2002:7f00:1::", "2001:db8::1"])("blocks private/reserved address %s", address => {
    expect(isPublicAddress(address)).toBe(false);
  });
  it("allows public IPv4/IPv6 addresses", () => {
    expect(isPublicAddress("93.184.216.34")).toBe(true);
    expect(isPublicAddress("2606:4700::1111")).toBe(true);
  });
  it.each(["http://files.oaiusercontent.com/file", "https://127.0.0.1/file", "https://user:secret@example.com/file", "https://example.com:8080/file"])("rejects unsafe URL %s before any network request", async url => {
    await expect(openAttachment(url, new AbortController().signal)).rejects.toThrow("public HTTPS");
    expect(network.request).not.toHaveBeenCalled();
  });
  it("rejects DNS-resolved private hosts before opening a socket", async () => {
    network.lookup.mockResolvedValue([{ address: "169.254.169.254", family: 4 }]);
    await expect(openAttachment(attachment.file.download_url, new AbortController().signal)).rejects.toThrow("Private network");
    expect(network.request).not.toHaveBeenCalled();
  });
  it("revalidates redirects rather than following them into private networks", async () => {
    download([], { location: "https://private.example.com/secret" }, 302);
    network.lookup.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }]).mockResolvedValueOnce([{ address: "10.1.2.3", family: 4 }]);
    await expect(openAttachment(attachment.file.download_url, new AbortController().signal)).rejects.toThrow("Private network");
    expect(network.request).toHaveBeenCalledTimes(1);
  });
});
