import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createClient } from "@libsql/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "@/app/generated/prisma/client";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { WorkspaceContext } from "@/lib/workspace-access";
import { postInputSchema } from "@/lib/scheduler/validation";
import { localDateTime, toScheduledInstant } from "@/lib/scheduler/time";
import { metaPublisher, PublishingError } from "@/lib/scheduler/publisher";

const state = vi.hoisted(() => ({
  db: null as PrismaClient | null,
  context: null as WorkspaceContext | null,
}));
vi.mock("@/lib/db/client", () => ({
  prisma: new Proxy({}, { get: (_, key) => Reflect.get(state.db!, key) }),
}));
vi.mock("@/lib/workspace-access", () => ({
  getCurrentWorkspaceContext: () => Promise.resolve(state.context),
}));
import { createPost, mutatePost } from "@/lib/scheduler/service";
import { runSchedulerTick } from "@/lib/scheduler/worker";
import {
  MEDIA_CLEANUP_GRACE_MS,
  runMediaCleanupTick,
} from "@/lib/scheduler/cleanup";
import { GET, POST } from "@/app/api/scheduler/route";
import { PATCH } from "@/app/api/scheduler/[id]/route";
import { NextRequest } from "next/server";

let directory: string;
let db: PrismaClient;
let context: WorkspaceContext;
let accountId: string;
let pageId: string;
const publisher = {
  prepare: vi.fn(),
  containerStatus: vi.fn(),
  publish: vi.fn(),
  publicationStatus: vi.fn(),
};
const tick = () =>
  runSchedulerTick({ db, publisher, decrypt: () => "decrypted-test-token" });
const future = () => new Date(Date.now() + 3600_000).toISOString();
const input = (extras = {}) =>
  postInputSchema.parse({
    title: "A planned post",
    platform: "INSTAGRAM",
    accountId,
    kind: "IMAGE",
    caption: "Hello!",
    mediaUrls: ["https://cdn.example.com/post.jpg"],
    timezone: "Asia/Kolkata",
    scheduledAt: future(),
    intent: "schedule",
    ...extras,
  });
async function due(extras = {}) {
  const post = await createPost(context, input({ intent: "now", ...extras }));
  return post;
}
async function read(id: string) {
  return db.scheduledPost.findUniqueOrThrow({ where: { id } });
}

beforeAll(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "kult-scheduler-test-"));
  const url = `file:${path.join(directory, "scheduler.db")}`;
  const raw = createClient({ url });
  const root = path.join(process.cwd(), "prisma/turso-migrations");
  for (const name of (await readdir(root, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort())
    await raw.executeMultiple(
      await readFile(path.join(root, name, "migration.sql"), "utf8"),
    );
  raw.close();
  db = new PrismaClient({ adapter: new PrismaLibSql({ url }) });
  state.db = db;
  await db.user.create({
    data: { id: "scheduler-owner", email: "scheduler@example.com" },
  });
});
beforeEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await db.workspace.deleteMany();
  const workspace = await db.workspace.create({
    data: { name: "Scheduler workspace", ownerId: "scheduler-owner" },
  });
  context = {
    workspace,
    workspaceId: workspace.id,
    userId: "scheduler-owner",
    role: "MEMBER",
  };
  state.context = context;
  accountId = (
    await db.instagramAccount.create({
      data: {
        workspaceId: workspace.id,
        instagramId: "ig-test",
        username: "creator",
        accessToken: "encrypted-test-token",
      },
    })
  ).id;
  pageId = (
    await db.facebookPage.create({
      data: {
        workspaceId: workspace.id,
        pageId: "fb-test",
        name: "Creator page",
        accessToken: "encrypted-test-token",
      },
    })
  ).id;
  publisher.prepare.mockReset().mockResolvedValue("container-1");
  publisher.containerStatus.mockReset().mockResolvedValue("FINISHED");
  publisher.publish.mockReset().mockResolvedValue("published-1");
  publisher.publicationStatus.mockReset().mockResolvedValue("PUBLISHED");
});
afterAll(async () => {
  await db.$disconnect();
  await rm(directory, { recursive: true, force: true });
});

describe("scheduler time and content validation", () => {
  it("round-trips across fractional timezone offsets", () => {
    expect(toScheduledInstant("2026-10-06T09:30", "Asia/Kolkata")).toBe(
      "2026-10-06T04:00:00.000Z",
    );
    expect(
      localDateTime(new Date("2026-10-06T04:00:00Z"), "Asia/Kathmandu"),
    ).toBe("2026-10-06T09:45");
  });
  it("rejects nonexistent, ambiguous, and invalid dates", () => {
    expect(() =>
      toScheduledInstant("2026-03-08T02:30", "America/New_York"),
    ).toThrow("does not exist");
    expect(() =>
      toScheduledInstant("2026-11-01T01:30", "America/New_York"),
    ).toThrow("occurs twice");
    expect(() => toScheduledInstant("2026-02-30T10:00", "UTC")).toThrow();
    expect(() => toScheduledInstant("2026-10-06T10:00", "Bad/Zone")).toThrow();
  });
  it("rejects past dates, invalid media counts and unsupported post types", () => {
    expect(() => input({ scheduledAt: "2020-01-01T00:00:00Z" })).toThrow();
    expect(() => input({ mediaUrls: [] })).toThrow();
    expect(() =>
      input({
        kind: "CAROUSEL",
        mediaUrls: ["https://cdn.example.com/one.jpg"],
      }),
    ).toThrow();
    expect(() => input({ platform: "INSTAGRAM", kind: "TEXT" })).toThrow();
    expect(() => input({ caption: "x".repeat(2201) })).toThrow();
    expect(() =>
      input({ intent: "draft", mediaUrls: [], caption: "" }),
    ).not.toThrow();
  });
  it.each([
    "http://example.com/a.jpg",
    "https://localhost/a.jpg",
    "https://127.0.0.1/a.jpg",
    "https://[::1]/a.jpg",
    "https://192.168.1.1/a.jpg",
    "https://cdn.internal/a.jpg",
    "https://token:secret@example.com/a.jpg",
  ])("rejects unsafe media %s", (url) => {
    expect(() => input({ mediaUrls: [url] })).toThrow();
  });
});

describe("durable scheduling and delivery", () => {
  it("persists drafts and schedules without leaking encrypted tokens", async () => {
    const draft = await createPost(
      context,
      input({ intent: "draft", mediaUrls: [] }),
    );
    expect(draft.status).toBe("DRAFT");
    expect(draft.availableAt).toBeNull();
    const post = await createPost(context, input());
    expect(post.status).toBe("SCHEDULED");
    expect(post.mediaUrls).toEqual(["https://cdn.example.com/post.jpg"]);
    expect(await tick()).toBe(false);
    expect(JSON.stringify(post)).not.toContain("encrypted-test-token");
  });
  it("deduplicates retried create requests and rejects conflicting content", async () => {
    const content = input({
      clientRequestId: "cc4be119-9fc4-4d75-a83f-5ec07fcdf9b8",
    });
    const [first, second] = await Promise.all([
      createPost(context, content),
      createPost(context, content),
    ]);
    expect(second.id).toBe(first.id);
    expect(await db.scheduledPost.count()).toBe(1);
    await expect(
      createPost(context, { ...content, caption: "Changed after timeout" }),
    ).rejects.toThrow("previous save succeeded");
  });
  it("allows only one worker to publish a due post", async () => {
    const post = await due();
    await Promise.all([tick(), tick()]);
    expect(publisher.publish).toHaveBeenCalledTimes(1);
    const saved = await read(post.id);
    expect(saved.status).toBe("PUBLISHED");
    expect(saved.externalPostId).toBe("published-1");
    await tick();
    expect(publisher.publish).toHaveBeenCalledTimes(1);
  });
  it("publishes Facebook text and images without Instagram container preparation", async () => {
    await due({
      platform: "FACEBOOK",
      accountId: pageId,
      kind: "TEXT",
      mediaUrls: [],
    });
    await due({ platform: "FACEBOOK", accountId: pageId, kind: "IMAGE" });
    await tick();
    await tick();
    expect(publisher.prepare).not.toHaveBeenCalled();
    expect(publisher.publish).toHaveBeenCalledTimes(2);
  });
  it("waits for media readiness and reuses the saved container", async () => {
    const post = await due({
      kind: "REEL",
      mediaUrls: ["https://cdn.example.com/video.mp4"],
    });
    publisher.containerStatus.mockResolvedValueOnce("IN_PROGRESS");
    await tick();
    expect((await read(post.id)).status).toBe("SCHEDULED");
    expect(publisher.publish).not.toHaveBeenCalled();
    await db.scheduledPost.update({
      where: { id: post.id },
      data: { availableAt: new Date(0) },
    });
    await tick();
    expect(publisher.prepare).toHaveBeenCalledTimes(1);
    expect((await read(post.id)).status).toBe("PUBLISHED");
  });
  it("bounds automatic retries with durable backoff", async () => {
    const post = await due();
    publisher.prepare.mockRejectedValue(
      new PublishingError("Meta is busy", true),
    );
    for (let attempt = 1; attempt <= 3; attempt++) {
      await tick();
      const saved = await read(post.id);
      expect(saved.attempts).toBe(attempt);
      expect(saved.status).toBe(attempt === 3 ? "FAILED" : "SCHEDULED");
      if (attempt < 3) {
        expect(saved.availableAt!.getTime()).toBeGreaterThan(Date.now());
        await db.scheduledPost.update({
          where: { id: post.id },
          data: { availableAt: new Date(0) },
        });
      }
    }
    await tick();
    expect(publisher.prepare).toHaveBeenCalledTimes(3);
  });
  it("never blindly retries a publish whose response was lost", async () => {
    const post = await due();
    publisher.publish.mockRejectedValue(
      new PublishingError("Response lost", true, false),
    );
    await tick();
    const saved = await read(post.id);
    expect(saved.status).toBe("NEEDS_REVIEW");
    await tick();
    expect(publisher.publish).toHaveBeenCalledTimes(1);
    await expect(
      mutatePost(context, post.id, {
        revision: saved.revision,
        action: "retry",
      }),
    ).rejects.toThrow("resolve");
    await mutatePost(context, post.id, {
      revision: saved.revision,
      action: "confirm-not-published",
    });
    const confirmed = await read(post.id);
    await mutatePost(context, post.id, {
      revision: confirmed.revision,
      action: "retry",
    });
    publisher.publish.mockResolvedValue("published-2");
    await tick();
    expect((await read(post.id)).status).toBe("PUBLISHED");
  });
  it("recovers expired pre-publish leases and flags interrupted outbound deliveries", async () => {
    const safe = await due();
    const uncertain = await due();
    await db.scheduledPost.update({
      where: { id: safe.id },
      data: {
        status: "PUBLISHING",
        leaseExpiresAt: new Date(0),
        leaseOwner: "dead",
      },
    });
    await db.scheduledPost.update({
      where: { id: uncertain.id },
      data: {
        status: "PUBLISHING",
        leaseExpiresAt: new Date(0),
        leaseOwner: "dead",
        publishStartedAt: new Date(0),
      },
    });
    await tick();
    expect((await read(safe.id)).status).toBe("PUBLISHED");
    expect((await read(uncertain.id)).status).toBe("NEEDS_REVIEW");
  });
  it("keeps disconnected account history and fails delivery with an actionable error", async () => {
    const post = await due();
    await db.instagramAccount.delete({ where: { id: accountId } });
    await tick();
    const saved = await read(post.id);
    expect(saved.instagramAccountId).toBeNull();
    expect(saved.accountName).toBe("@creator");
    expect(saved.status).toBe("FAILED");
    expect(saved.lastError).toContain("disconnected");
  });
  it("handles expired tokens before attempting publication", async () => {
    const post = await due();
    await db.instagramAccount.update({
      where: { id: accountId },
      data: { tokenExpiresAt: new Date(0) },
    });
    await tick();
    expect((await read(post.id)).status).toBe("FAILED");
    expect(publisher.publish).not.toHaveBeenCalled();
  });
  it("does not republish when persistence fails after the outbound request", async () => {
    const post = await due();
    const original = db.scheduledPost.updateMany.bind(db.scheduledPost);
    vi.spyOn(db.scheduledPost, "updateMany").mockImplementation((args) => {
      if (args.data.status === "PUBLISHED")
        throw new Error("database temporarily unavailable");
      return original(args);
    });
    await tick();
    expect((await read(post.id)).status).toBe("NEEDS_REVIEW");
    await tick();
    expect(publisher.publish).toHaveBeenCalledTimes(1);
  });
});

describe("scheduler editing and workspace access", () => {
  it("reschedules, cancels, and duplicates into an unscheduled draft", async () => {
    const post = await due();
    await mutatePost(context, post.id, {
      action: "save",
      revision: post.revision,
      post: input(),
    });
    const scheduled = await read(post.id);
    await mutatePost(context, post.id, {
      action: "cancel",
      revision: scheduled.revision,
    });
    expect((await read(post.id)).status).toBe("CANCELLED");
    expect(await tick()).toBe(false);
    const copy = await mutatePost(context, post.id, {
      action: "duplicate",
      revision: (await read(post.id)).revision,
    });
    expect(copy.status).toBe("DRAFT");
    expect(copy.scheduledAt).toBeNull();
    expect(copy.caption).toBe(post.caption);
  });
  it("rejects stale revisions and changes during publication", async () => {
    const post = await due();
    await db.scheduledPost.update({
      where: { id: post.id },
      data: { revision: 1, status: "PUBLISHING" },
    });
    await expect(
      mutatePost(context, post.id, { action: "cancel", revision: 0 }),
    ).rejects.toThrow("changed");
    await expect(
      mutatePost(context, post.id, {
        action: "save",
        revision: 1,
        post: input(),
      }),
    ).rejects.toThrow("cannot be changed");
  });
  it("blocks cross-workspace accounts and post mutations", async () => {
    const post = await due();
    const other = await db.workspace.create({
      data: { ownerId: "scheduler-owner", name: "Other" },
    });
    const otherContext = {
      ...context,
      workspaceId: other.id,
      workspace: other,
    };
    await expect(createPost(otherContext, input())).rejects.toThrow(
      "workspace",
    );
    await expect(
      mutatePost(otherContext, post.id, { action: "cancel", revision: 0 }),
    ).rejects.toThrow("not found");
  });
  it("returns unauthorized and invalid JSON responses from actual API handlers", async () => {
    state.context = null;
    expect(
      (await GET(new NextRequest("https://kult.test/api/scheduler"))).status,
    ).toBe(401);
    expect(
      (
        await POST(
          new Request("https://kult.test/api/scheduler", {
            method: "POST",
            body: "{}",
          }),
        )
      ).status,
    ).toBe(401);
    state.context = context;
    expect(
      (
        await POST(
          new Request("https://kult.test/api/scheduler", {
            method: "POST",
            body: "not json",
          }),
        )
      ).status,
    ).toBe(400);
    const created = await POST(
      new Request("https://kult.test/api/scheduler", {
        method: "POST",
        body: JSON.stringify(input()),
      }),
    );
    expect(created.status).toBe(201);
    const payload = await (
      await GET(
        new NextRequest("https://kult.test/api/scheduler?status=SCHEDULED"),
      )
    ).json();
    expect(payload.data.posts).toHaveLength(1);
    expect(payload.data.counts.SCHEDULED).toBe(1);
    expect(payload.data.accounts).toHaveLength(2);
    expect(JSON.stringify(payload)).not.toContain("encrypted-test-token");
    const unknown = await PATCH(
      new Request("https://kult.test/api/scheduler/missing", {
        method: "PATCH",
        body: JSON.stringify({ revision: 0, action: "cancel" }),
      }),
      { params: Promise.resolve({ id: "missing" }) },
    );
    expect(unknown.status).toBe(404);
  });
});

describe("extended scheduler persistence and delivery", () => {
  it.each(["VIDEO", "REEL", "STORY_VIDEO"])(
    "confirms Facebook %s asynchronously without republishing",
    async (kind) => {
      const post = await due({
        platform: "FACEBOOK",
        accountId: pageId,
        kind,
        caption: kind === "STORY_VIDEO" ? "" : "Hello",
        mediaUrls: ["https://cdn.example.com/clip.mp4"],
      });
      await tick();
      const saved = await read(post.id);
      expect(saved.status).toBe("SCHEDULED");
      expect(saved.publishStartedAt).not.toBeNull();
      expect(saved.preparation).toMatchObject({ accepted: true });
      expect(saved.publishedAt).toBeNull();
      await expect(
        mutatePost(context, post.id, {
          action: "cancel",
          revision: saved.revision,
        }),
      ).rejects.toThrow("uncertain delivery");
      publisher.publicationStatus.mockResolvedValueOnce("IN_PROGRESS");
      await db.scheduledPost.update({
        where: { id: post.id },
        data: { availableAt: new Date(0) },
      });
      await tick();
      expect((await read(post.id)).status).toBe("SCHEDULED");
      await db.scheduledPost.update({
        where: { id: post.id },
        data: { availableAt: new Date(0) },
      });
      await tick();
      expect((await read(post.id)).status).toBe("PUBLISHED");
      expect(publisher.publish).toHaveBeenCalledTimes(1);
      expect(publisher.prepare).toHaveBeenCalledTimes(kind === "VIDEO" ? 0 : 1);
    },
  );
  it("preserves uncertain delivery when account disappears after Facebook accepts a video", async () => {
    const post = await due({
      platform: "FACEBOOK",
      accountId: pageId,
      kind: "REEL",
      mediaUrls: ["https://cdn.example.com/clip.mp4"],
    });
    await tick();
    await db.facebookPage.delete({ where: { id: pageId } });
    await db.scheduledPost.update({
      where: { id: post.id },
      data: { availableAt: new Date(0) },
    });
    await tick();
    expect((await read(post.id)).status).toBe("NEEDS_REVIEW");
    expect(publisher.publish).toHaveBeenCalledTimes(1);
  });
  it("bounds confirmation timeouts without resending an accepted video", async () => {
    const post = await due({
      platform: "FACEBOOK",
      accountId: pageId,
      kind: "VIDEO",
      mediaUrls: ["https://cdn.example.com/clip.mp4"],
    });
    await tick();
    publisher.publicationStatus.mockResolvedValue("IN_PROGRESS");
    await db.scheduledPost.update({
      where: { id: post.id },
      data: { availableAt: new Date(0), processingChecks: 120 },
    });
    await tick();
    expect((await read(post.id)).status).toBe("NEEDS_REVIEW");
    expect(publisher.publish).toHaveBeenCalledTimes(1);
  });
  it("persists staged preparation while waiting for carousel children", async () => {
    const post = await due({
      kind: "CAROUSEL",
      mediaUrls: [
        "https://cdn.example.com/1.jpg",
        "https://cdn.example.com/clip.mp4",
      ],
    });
    publisher.prepare.mockImplementationOnce(
      async (_p, _token, _account, checkpoint) => {
        await checkpoint({ children: ["image", "video"] });
        return null;
      },
    );
    await tick();
    const saved = await read(post.id);
    expect(saved.preparation).toEqual({ children: ["image", "video"] });
    expect(saved.attempts).toBe(0);
    await db.scheduledPost.update({
      where: { id: post.id },
      data: { availableAt: new Date(0) },
    });
    await tick();
    expect(publisher.prepare.mock.calls[1][0].preparation).toEqual({
      children: ["image", "video"],
    });
    expect((await read(post.id)).status).toBe("PUBLISHED");
  });
  it("copies publishing options but resets upload/delivery stages in a duplicate", async () => {
    const post = await due({
      kind: "REEL",
      mediaUrls: ["https://cdn.example.com/clip.mp4"],
      publishingOptions: {
        audioName: "Original voice",
        coverUrl: "https://cdn.example.com/cover.jpg",
        shareToFeed: false,
      },
    });
    await tick();
    const saved = await read(post.id);
    const copy = await mutatePost(context, saved.id, {
      action: "duplicate",
      revision: saved.revision,
    });
    expect(copy.publishingOptions).toEqual(saved.publishingOptions);
    expect(copy.preparation).toEqual({});
    expect(copy.publishStartedAt).toBeNull();
    expect(copy.containerId).toBeNull();
  });
  it("detects idempotency conflicts in publishing options", async () => {
    const requestId = "212a3b75-8c53-46a1-9221-dfd6f5f7bc29";
    await createPost(
      context,
      input({ intent: "draft", clientRequestId: requestId }),
    );
    await expect(
      createPost(
        context,
        input({
          intent: "draft",
          clientRequestId: requestId,
          publishingOptions: { altTexts: ["different"] },
        }),
      ),
    ).rejects.toThrow("different content");
  });
});

describe("worker and real Meta HTTP publisher integration", () => {
  it.each(["REEL", "STORY_VIDEO"])(
    "finishes Facebook %s before waiting for processing",
    async (kind) => {
      let finished = false;
      let delivered = false;
      let finishCalls = 0;
      const fetch = vi.fn(async (url: URL, init: RequestInit) => {
        const fields = init.body as URLSearchParams | undefined;
        let body: unknown;
        if (fields?.get("upload_phase") === "start")
          body = { video_id: "fb-video" };
        else if (String(url).includes("rupload.facebook.com"))
          body = { success: true };
        else if (fields?.get("upload_phase") === "finish") {
          finished = true;
          finishCalls++;
          body = { success: true };
        } else
          body = {
            status: {
              video_status: delivered ? "ready" : "processing",
              uploading_phase: { status: "complete" },
              processing_phase: {
                status: finished ? "in_progress" : "not_started",
              },
              publishing_phase: {
                status: delivered ? "complete" : "not_started",
              },
            },
          };
        return new Response(JSON.stringify(body));
      });
      vi.stubGlobal("fetch", fetch);
      const post = await due({
        platform: "FACEBOOK",
        accountId: pageId,
        kind,
        caption: "",
        mediaUrls: ["https://cdn.example.com/clip.mp4"],
      });
      const run = () =>
        runSchedulerTick({
          db,
          publisher: metaPublisher,
          decrypt: () => "test-token",
        });
      await run();
      expect(finished).toBe(true);
      expect((await read(post.id)).status).toBe("SCHEDULED");
      expect((await read(post.id)).preparation).toMatchObject({
        accepted: true,
      });
      delivered = true;
      await db.scheduledPost.update({
        where: { id: post.id },
        data: { availableAt: new Date(0) },
      });
      await run();
      expect((await read(post.id)).status).toBe("PUBLISHED");
      expect(finishCalls).toBe(1);
      vi.unstubAllGlobals();
    },
  );
});

describe("automatic post-publication media cleanup", () => {
  beforeEach(() => {
    vi.stubEnv("B2_BUCKET_NAME", "kult-media");
  });
  const mediaUrl = (name = "abcd1234") =>
    `https://f005.backblazeb2.com/file/kult-media/scheduler/${context.workspaceId}/${name}.jpg`;
  async function publishedMedia(extras = {}) {
    const post = await due({ mediaUrls: [mediaUrl()], ...extras });
    return db.scheduledPost.update({
      where: { id: post.id },
      data: {
        status: "PUBLISHED",
        publishedAt: new Date(Date.now() - MEDIA_CLEANUP_GRACE_MS - 1000),
        externalPostId: "live-meta-id",
      },
    });
  }
  it("only removes files after live confirmation and the safety window", async () => {
    const post = await due({ mediaUrls: [mediaUrl()] });
    const remove = vi.fn().mockResolvedValue(undefined);
    await db.scheduledPost.update({
      where: { id: post.id },
      data: {
        status: "SCHEDULED",
        preparation: { accepted: true },
        publishStartedAt: new Date(),
        externalPostId: "accepted-id",
      },
    });
    expect(await runMediaCleanupTick({ db, remove })).toBe(false);
    await db.scheduledPost.update({
      where: { id: post.id },
      data: { status: "PUBLISHED", publishedAt: new Date() },
    });
    expect(await runMediaCleanupTick({ db, remove })).toBe(false);
    await db.scheduledPost.update({
      where: { id: post.id },
      data: {
        publishedAt: new Date(Date.now() - MEDIA_CLEANUP_GRACE_MS - 1000),
      },
    });
    expect(await runMediaCleanupTick({ db, remove })).toBe(true);
    expect(remove).toHaveBeenCalledOnce();
    expect(
      await db.scheduledMediaCleanup.findUnique({ where: { url: mediaUrl() } }),
    ).toMatchObject({ state: "DELETED" });
    expect(await read(post.id)).toMatchObject({
      status: "PUBLISHED",
      externalPostId: "accepted-id",
    });
  });
  it("cleans media and an uploaded Reel cover while preserving third-party URLs", async () => {
    const post = await publishedMedia({
      kind: "REEL",
      mediaUrls: ["https://cdn.example.com/external.mp4"],
      publishingOptions: { coverUrl: mediaUrl("ffff1234") },
    });
    const remove = vi.fn().mockResolvedValue(undefined);
    await runMediaCleanupTick({ db, remove });
    expect(remove).toHaveBeenCalledExactlyOnceWith(
      context.workspaceId,
      mediaUrl("ffff1234"),
    );
    expect((await read(post.id)).mediaUrls).toEqual([
      "https://cdn.example.com/external.mp4",
    ]);
  });
  it("retains a shared file while a draft, failed post, or recent publication needs it", async () => {
    await publishedMedia();
    const draft = await createPost(
      context,
      input({ intent: "draft", mediaUrls: [mediaUrl()] }),
    );
    const remove = vi.fn().mockResolvedValue(undefined);
    await runMediaCleanupTick({ db, remove });
    expect(remove).not.toHaveBeenCalled();
    await db.scheduledPost.update({
      where: { id: draft.id },
      data: { status: "PUBLISHED", publishedAt: new Date() },
    });
    await db.scheduledMediaCleanup.updateMany({
      data: { availableAt: new Date(0) },
    });
    await runMediaCleanupTick({ db, remove });
    expect(remove).not.toHaveBeenCalled();
    await db.scheduledPost.update({
      where: { id: draft.id },
      data: { publishedAt: new Date(0) },
    });
    await db.scheduledMediaCleanup.updateMany({
      data: { availableAt: new Date(0) },
    });
    await runMediaCleanupTick({ db, remove });
    expect(remove).toHaveBeenCalledOnce();
  });
  it("retries failed deletion durably without allowing partially removed files to be reused", async () => {
    await publishedMedia();
    const remove = vi
      .fn()
      .mockRejectedValueOnce(new Error("Storage unavailable"))
      .mockResolvedValue(undefined);
    await runMediaCleanupTick({ db, remove });
    expect(
      await db.scheduledMediaCleanup.findUnique({ where: { url: mediaUrl() } }),
    ).toMatchObject({ state: "DELETING", attempts: 1 });
    await expect(
      createPost(context, input({ intent: "draft", mediaUrls: [mediaUrl()] })),
    ).rejects.toThrow("removed after publication");
    await runMediaCleanupTick({ db, remove });
    expect(remove).toHaveBeenCalledTimes(1);
    await db.scheduledMediaCleanup.updateMany({
      data: { leaseExpiresAt: new Date(0) },
    });
    await runMediaCleanupTick({ db, remove });
    expect(remove).toHaveBeenCalledTimes(2);
    expect(
      await db.scheduledMediaCleanup.findUnique({ where: { url: mediaUrl() } }),
    ).toMatchObject({ state: "DELETED", lastError: null });
  });
  it("serializes a deletion claim against a concurrent save and copies published text without removed media", async () => {
    const post = await publishedMedia();
    const remove = vi.fn(async () => {
      await expect(
        createPost(context, input({ mediaUrls: [mediaUrl()] })),
      ).rejects.toThrow("removed after publication");
    });
    await Promise.all([
      runMediaCleanupTick({ db, remove }),
      runMediaCleanupTick({ db, remove }),
    ]);
    expect(remove).toHaveBeenCalledOnce();
    const copy = await mutatePost(context, post.id, {
      action: "duplicate",
      revision: post.revision,
    });
    expect(copy).toMatchObject({
      status: "DRAFT",
      caption: "Hello!",
      mediaUrls: [],
    });
    expect(await read(post.id)).toMatchObject({
      status: "PUBLISHED",
      externalPostId: "live-meta-id",
    });
  });
  it("never deletes foreign workspace files or ordinary external links", async () => {
    const post = await publishedMedia();
    await db.scheduledPost.update({
      where: { id: post.id },
      data: {
        mediaUrls: [
          "https://f005.backblazeb2.com/file/kult-media/scheduler/foreign/abcd1234.jpg",
          "https://example.com/post.jpg",
        ],
      },
    });
    const remove = vi.fn();
    await runMediaCleanupTick({ db, remove });
    expect(remove).not.toHaveBeenCalled();
    expect(await db.scheduledMediaCleanup.count()).toBe(0);
  });
});
