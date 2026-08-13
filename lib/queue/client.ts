/**
 * Durable Turso queue.
 *
 * Webhook/API processes only insert rows. The Oracle worker claims ready rows
 * with a lease, processes them concurrently, and either completes or schedules
 * a retry. No always-on Redis connection or command-metered polling is needed.
 */

import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/client";
import { Prisma } from "@/app/generated/prisma/client";

export type CommentSource = "WEBHOOK" | "POLLING";

export interface ProcessCommentJob {
  instagramAccountId: string;
  commentId: string;
  commentText: string;
  commenterId: string;
  commenterName?: string;
  mediaId: string;
  requeueAttempt?: number;
  source?: CommentSource;
}

export interface ProcessPostbackJob {
  instagramAccountId: string;
  userId: string;
  payload: string;
  mid?: string;
}

export interface ProcessInboundDmJob {
  instagramAccountId: string;
  senderId: string;
  messageId: string;
  messageText: string;
  requeueAttempt?: number;
}

export interface ProcessFacebookMessageJob {
  pageId: string;
  senderId: string;
  messageId: string;
  messageText: string;
}

export interface ProcessFacebookCommentJob {
  pageId: string;
  senderId: string;
  senderName?: string;
  commentId: string;
  commentText: string;
  postId: string;
}

export type DmQueueJob =
  | ProcessCommentJob
  | ProcessPostbackJob
  | ProcessInboundDmJob
  | ProcessFacebookMessageJob
  | ProcessFacebookCommentJob;

export const POSTBACK_JOB_NAME = "process-postback";
export const INBOUND_DM_JOB_NAME = "process-inbound-dm";
export const FACEBOOK_MESSAGE_JOB_NAME = "process-facebook-message";
export const FACEBOOK_COMMENT_JOB_NAME = "process-facebook-comment";

export interface QueueJob<T = DmQueueJob> {
  id: string;
  name: string;
  data: T;
  attemptsMade: number;
  opts?: { attempts?: number };
}

export interface QueueAddOptions {
  delay?: number;
  jobId?: string;
  attempts?: number;
}

export interface QueueCounts {
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const LEASE_MS = 5 * 60_000;
const EMPTY_POLL_MS = 1_000;
const ERROR_POLL_MS = 5_000;
const PROCESS_ERROR_COOLDOWN_MS = 60_000;
const FAILED_REVIVE_AFTER_MS = 5 * 60_000;
const COMPLETED_RETENTION_MS = 7 * 24 * 60 * 60_000;
const FAILED_RETENTION_MS = 30 * 24 * 60 * 60_000;

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function isUniqueConstraintError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  );
}

function jsonPayload<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export class DurableQueue {
  async add<T extends DmQueueJob>(
    name: string,
    data: T,
    options: QueueAddOptions = {}
  ): Promise<{ id: string }> {
    const now = new Date();
    const availableAt = new Date(now.getTime() + Math.max(0, options.delay ?? 0));
    const dedupeKey = options.jobId ?? null;

    if (dedupeKey) {
      const existing = await prisma.durableJob.findUnique({
        where: { dedupeKey },
        select: { id: true, status: true, failedAt: true },
      });
      if (existing) {
        if (
          existing.status === "FAILED" &&
          existing.failedAt &&
          now.getTime() - existing.failedAt.getTime() >= FAILED_REVIVE_AFTER_MS
        ) {
          await prisma.durableJob.update({
            where: { id: existing.id },
            data: {
              status: "WAITING",
              attemptsMade: 0,
              maxAttempts: options.attempts ?? DEFAULT_MAX_ATTEMPTS,
              availableAt,
              leaseOwner: null,
              leaseExpiresAt: null,
              lastError: null,
              failedAt: null,
            },
          });
        }
        return { id: existing.id };
      }
    }

    const id = randomUUID();
    try {
      await prisma.durableJob.create({
        data: {
          id,
          name,
          payload: jsonPayload(data) as unknown as Prisma.InputJsonValue,
          dedupeKey,
          maxAttempts: options.attempts ?? DEFAULT_MAX_ATTEMPTS,
          availableAt,
        },
      });
      return { id };
    } catch (error) {
      // Concurrent webhook deliveries can race between findUnique and create.
      // The unique key is the authority; return the winning row as success.
      if (dedupeKey && isUniqueConstraintError(error)) {
        const existing = await prisma.durableJob.findUnique({
          where: { dedupeKey },
          select: { id: true },
        });
        if (existing) return existing;
      }
      throw error;
    }
  }

  async getJobCounts(
    ..._types: Array<"waiting" | "active" | "delayed" | "failed">
  ): Promise<QueueCounts> {
    const now = new Date();
    const [waiting, active, delayed, failed] = await Promise.all([
      prisma.durableJob.count({
        where: { status: "WAITING", availableAt: { lte: now } },
      }),
      prisma.durableJob.count({ where: { status: "ACTIVE" } }),
      prisma.durableJob.count({
        where: { status: "WAITING", availableAt: { gt: now } },
      }),
      prisma.durableJob.count({ where: { status: "FAILED" } }),
    ]);
    return { waiting, active, delayed, failed };
  }
}

let queue: DurableQueue | null = null;

export function getDMQueue(): DurableQueue {
  if (!queue) queue = new DurableQueue();
  return queue;
}

type Processor = (job: QueueJob<DmQueueJob>) => Promise<void>;

interface DurableWorkerOptions {
  concurrency?: number;
  settings?: {
    backoffStrategy?: (attemptsMade: number) => number;
  };
}

export class DurableWorker extends EventEmitter {
  private readonly workerId = `${process.pid}:${randomUUID()}`;
  private readonly concurrency: number;
  private readonly inFlight = new Set<Promise<void>>();
  private readonly runner: Promise<void>;
  private closing = false;
  private lastProcessErrorAt = 0;
  private lastCleanupAt = 0;

  constructor(
    private readonly processor: Processor,
    private readonly options: DurableWorkerOptions = {}
  ) {
    super();
    this.concurrency = Math.max(1, options.concurrency ?? 1);
    this.runner = this.run();
  }

  private async claimNext(): Promise<QueueJob<DmQueueJob> | null> {
    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + LEASE_MS);

    for (let collision = 0; collision < 5; collision += 1) {
      const candidate = await prisma.durableJob.findFirst({
        where: {
          OR: [
            { status: "WAITING", availableAt: { lte: now } },
            { status: "ACTIVE", leaseExpiresAt: { lt: now } },
          ],
        },
        orderBy: [{ availableAt: "asc" }, { createdAt: "asc" }],
      });
      if (!candidate) return null;

      const claimed = await prisma.durableJob.updateMany({
        where: {
          id: candidate.id,
          OR: [
            { status: "WAITING", availableAt: { lte: now } },
            { status: "ACTIVE", leaseExpiresAt: { lt: now } },
          ],
        },
        data: {
          status: "ACTIVE",
          leaseOwner: this.workerId,
          leaseExpiresAt,
        },
      });
      if (claimed.count !== 1) continue;

      return {
        id: candidate.id,
        name: candidate.name,
        data: candidate.payload as unknown as DmQueueJob,
        attemptsMade: candidate.attemptsMade,
        opts: { attempts: candidate.maxAttempts },
      };
    }
    return null;
  }

  private async complete(job: QueueJob<DmQueueJob>) {
    await prisma.durableJob.updateMany({
      where: { id: job.id, leaseOwner: this.workerId },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        leaseOwner: null,
        leaseExpiresAt: null,
        lastError: null,
      },
    });
    this.emit("completed", job);
  }

  private async fail(job: QueueJob<DmQueueJob>, error: Error) {
    const attemptsMade = job.attemptsMade + 1;
    const maxAttempts = job.opts?.attempts ?? DEFAULT_MAX_ATTEMPTS;
    const retry = attemptsMade < maxAttempts;
    const backoffMs = retry
      ? Math.max(
          0,
          this.options.settings?.backoffStrategy?.(attemptsMade) ?? 5 * 60_000
        )
      : 0;

    await prisma.durableJob.updateMany({
      where: { id: job.id, leaseOwner: this.workerId },
      data: {
        status: retry ? "WAITING" : "FAILED",
        attemptsMade,
        availableAt: new Date(Date.now() + backoffMs),
        failedAt: retry ? null : new Date(),
        leaseOwner: null,
        leaseExpiresAt: null,
        lastError: error.message.slice(0, 2000),
      },
    });
    this.emit("failed", { ...job, attemptsMade }, error);
  }

  private process(job: QueueJob<DmQueueJob>) {
    let task: Promise<void>;
    task = this.processor(job)
      .then(() => this.complete(job))
      .catch((error: unknown) =>
        this.fail(
          job,
          error instanceof Error ? error : new Error("Unknown worker error")
        )
      )
      .finally(() => this.inFlight.delete(task));
    this.inFlight.add(task);
  }

  private reportProcessError(error: unknown) {
    const now = Date.now();
    if (now - this.lastProcessErrorAt < PROCESS_ERROR_COOLDOWN_MS) return;
    this.lastProcessErrorAt = now;
    this.emit(
      "error",
      error instanceof Error ? error : new Error("Unknown queue polling error")
    );
  }

  private async cleanupIfDue() {
    const now = Date.now();
    if (now - this.lastCleanupAt < 60 * 60_000) return;
    this.lastCleanupAt = now;
    await Promise.all([
      prisma.durableJob.deleteMany({
        where: {
          status: "COMPLETED",
          completedAt: { lt: new Date(now - COMPLETED_RETENTION_MS) },
        },
      }),
      prisma.durableJob.deleteMany({
        where: {
          status: "FAILED",
          failedAt: { lt: new Date(now - FAILED_RETENTION_MS) },
        },
      }),
      prisma.dmRateLimitBucket.deleteMany({
        where: { windowStart: { lt: new Date(now - 48 * 60 * 60_000) } },
      }),
    ]);
  }

  private async run() {
    while (!this.closing) {
      try {
        await this.cleanupIfDue();
        let claimedAny = false;
        while (!this.closing && this.inFlight.size < this.concurrency) {
          const job = await this.claimNext();
          if (!job) break;
          claimedAny = true;
          this.process(job);
        }
        if (!claimedAny) await wait(EMPTY_POLL_MS);
      } catch (error) {
        this.reportProcessError(error);
        await wait(ERROR_POLL_MS);
      }
    }
    await Promise.allSettled(this.inFlight);
  }

  async close() {
    this.closing = true;
    await this.runner;
  }
}
