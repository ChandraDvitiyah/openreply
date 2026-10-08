import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  context: { workspaceId: "workspace-1" } as { workspaceId: string } | null,
}));
vi.mock("@/lib/workspace-access", () => ({
  getCurrentWorkspaceContext: async () => state.context,
}));
import { POST } from "@/app/api/scheduler/upload/route";
import {
  createSchedulerUpload,
  schedulerMediaUrl,
} from "@/lib/scheduler/storage";
const request = (body: unknown) =>
  new Request("http://localhost/api/scheduler/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const photo = {
  platform: "FACEBOOK",
  kind: "IMAGE",
  contentType: "image/jpeg",
  size: 100,
};
let sequence = 0;
function stubStorage(
  bucketType = "allPublic",
  overrides: Record<string, unknown> = {},
) {
  const storageApi = {
    apiUrl: "https://api005.backblazeb2.com",
    downloadUrl: "https://f005.backblazeb2.com",
    s3ApiUrl: "https://s3.us-west-005.backblazeb2.com",
    allowed: {
      capabilities: ["listBuckets", "writeFiles", "readFiles"],
      namePrefix: null,
    },
    ...overrides,
  };
  const mock = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({
        accountId: "account-id",
        authorizationToken: "private-account-token",
        apiInfo: { storageApi },
      }),
    )
    .mockResolvedValueOnce(
      Response.json({
        buckets: [
          { bucketId: "test-bucket-id", bucketName: "kult-media", bucketType },
        ],
      }),
    );
  vi.stubGlobal("fetch", mock);
  return mock;
}
beforeEach(() => {
  vi.stubEnv("B2_APPLICATION_KEY_ID", `test-key-id-${++sequence}`);
  vi.stubEnv("B2_APPLICATION_KEY", "test-server-secret");
  vi.stubEnv("B2_BUCKET_ID", "test-bucket-id");
  state.context = { workspaceId: "workspace-1" };
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("Backblaze scheduler uploads", () => {
  it("disables uploads without all three configuration values", async () => {
    vi.stubEnv("B2_APPLICATION_KEY_ID", "");
    expect((await POST(request(photo))).status).toBe(503);
  });
  it("rejects anonymous upload requests before contacting B2", async () => {
    state.context = null;
    const mock = stubStorage();
    expect((await POST(request(photo))).status).toBe(401);
    expect(mock).not.toHaveBeenCalled();
  });
  it("discovers the specified bucket and signs PUT for its workspace, MIME and exact size", async () => {
    const mock = stubStorage();
    const response = await POST(request(photo));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const result = await response.json();
    const url = new URL(result.uploadUrl);
    expect(url.origin).toBe("https://s3.us-west-005.backblazeb2.com");
    expect(url.pathname).toMatch(
      /^\/kult-media\/scheduler\/workspace-1\/[a-f0-9-]+\.jpg$/,
    );
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe(
      "content-length;content-type;host",
    );
    expect(url.searchParams.get("X-Amz-Expires")).toBe("900");
    expect(result.mediaUrl).toBe(
      `https://f005.backblazeb2.com/file${url.pathname}`,
    );
    expect(result.headers).toEqual({ "Content-Type": "image/jpeg" });
    expect(JSON.stringify(result)).not.toContain("test-server-secret");
    expect(JSON.stringify(result)).not.toContain("private-account-token");
    const init = mock.mock.calls[1][1];
    expect(JSON.parse(init.body)).toEqual({
      accountId: "account-id",
      bucketId: "test-bucket-id",
    });
    expect(init.redirect).toBe("error");
  });
  it("does not reuse object keys and caches discovery across workspace requests", async () => {
    const mock = stubStorage();
    const [first, second] = await Promise.all([
      createSchedulerUpload("workspace-1", "image/jpeg", 100),
      createSchedulerUpload("workspace-2", "image/jpeg", 100),
    ]);
    expect(first.mediaUrl).not.toBe(second.mediaUrl);
    expect(second.mediaUrl).toContain("/scheduler/workspace-2/");
    expect(mock).toHaveBeenCalledTimes(2);
  });
  it.each([
    { ...photo, pathname: "scheduler/other/file.jpg" },
    { ...photo, contentType: "text/html" },
    { ...photo, contentType: "audio/mpeg" },
    { ...photo, size: 10 * 1024 ** 2 + 1 },
    { ...photo, size: 0 },
    { ...photo, size: 1.5 },
    { ...photo, platform: "INSTAGRAM", contentType: "image/png" },
    { ...photo, kind: "REEL" },
    { ...photo, kind: "TEXT" },
    { ...photo, kind: "CAROUSEL", contentType: "video/mp4" },
  ])(
    "rejects invalid metadata before authorizing storage: %j",
    async (body) => {
      const mock = stubStorage();
      expect((await POST(request(body))).status).toBe(400);
      expect(mock).not.toHaveBeenCalled();
    },
  );
  it("allows a supported 1 GB Facebook video without routing bytes through the app", async () => {
    stubStorage();
    const response = await POST(
      request({
        ...photo,
        kind: "VIDEO",
        contentType: "video/mp4",
        size: 1024 ** 3,
      }),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).mediaUrl).toMatch(/\.mp4$/);
  });
  it("supports private buckets with fresh, workspace-scoped download URLs", async () => {
    const mock = stubStorage("allPrivate");
    const upload = await createSchedulerUpload(
      "workspace-1",
      "image/jpeg",
      100,
    );
    const delivery = new URL(
      await schedulerMediaUrl("workspace-1", upload.mediaUrl),
    );
    const preview = new URL(
      await schedulerMediaUrl("workspace-1", upload.mediaUrl, 3600),
    );
    expect(delivery.hostname).toBe("s3.us-west-005.backblazeb2.com");
    expect(delivery.searchParams.get("X-Amz-Expires")).toBe("86400");
    expect(preview.searchParams.get("X-Amz-Expires")).toBe("3600");
    expect(upload.mediaUrl).not.toContain("X-Amz");
    await expect(
      schedulerMediaUrl("workspace-2", upload.mediaUrl),
    ).rejects.toThrow("workspace");
    await expect(
      schedulerMediaUrl("workspace-1", upload.mediaUrl + "?unexpected=1"),
    ).rejects.toThrow("workspace");
    expect(mock).toHaveBeenCalledTimes(2);
  });
  it("keeps third-party public URLs usable without signing them", async () => {
    stubStorage("allPrivate");
    const external =
      "https://f005.backblazeb2.com/file/external-bucket/public.jpg";
    expect(await schedulerMediaUrl("workspace-1", external)).toBe(external);
    expect(
      await schedulerMediaUrl("workspace-1", "https://example.com/public.jpg"),
    ).toBe("https://example.com/public.jpg");
  });
  it("does not forward an authorization token to an unexpected host", async () => {
    const mock = stubStorage("allPublic", {
      apiUrl: "https://attacker.example",
    });
    expect((await POST(request(photo))).status).toBe(503);
    expect(mock).toHaveBeenCalledTimes(1);
  });
  it("requires a key with write permission and compatible prefix", async () => {
    stubStorage("allPublic", { allowed: { capabilities: ["listBuckets"] } });
    const response = await POST(request(photo));
    expect(response.status).toBe(503);
    expect((await response.json()).error).toContain("writeFiles");
  });
  it("does not return provider error bodies and retries discovery after an error", async () => {
    const mock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ error: "private-account-token" }, { status: 401 }),
      );
    vi.stubGlobal("fetch", mock);
    const response = await POST(request(photo));
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain(
      "private-account-token",
    );
    stubStorage();
    expect((await POST(request(photo))).status).toBe(200);
  });
});
