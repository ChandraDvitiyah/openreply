/**
 * Database-backed Instagram DM rate limiter.
 *
 * A unique Turso row per account and UTC hour provides an atomic fixed-window
 * counter without Redis. The worker reserves a slot with one UPSERT ... WHERE
 * statement, so concurrent jobs cannot all pass the limit simultaneously.
 */

import { prisma } from "@/lib/db/client";

const RATE_LIMIT_MAX = 750;
const RATE_LIMIT_WINDOW = 3600;
const REQUEUE_DELAY_MS = 30 * 60 * 1000;
const MAX_REQUEUE_ATTEMPTS = 3;

export interface RateLimitResult {
  allowed: boolean;
  currentCount: number;
  remainingDMs: number;
  shouldRequeue: boolean;
  requeueDelayMs: number;
  shouldSkip: boolean;
  reserved: boolean;
}

function currentWindowStart(now = new Date()) {
  const start = new Date(now);
  start.setUTCMinutes(0, 0, 0);
  return start;
}

function blockedResult(count: number, requeueAttempt: number): RateLimitResult {
  if (requeueAttempt >= MAX_REQUEUE_ATTEMPTS) {
    return {
      allowed: false,
      currentCount: count,
      remainingDMs: 0,
      shouldRequeue: false,
      requeueDelayMs: 0,
      shouldSkip: true,
      reserved: false,
    };
  }

  return {
    allowed: false,
    currentCount: count,
    remainingDMs: 0,
    shouldRequeue: true,
    requeueDelayMs: REQUEUE_DELAY_MS,
    shouldSkip: false,
    reserved: false,
  };
}

async function currentCount(instagramAccountId: string): Promise<number> {
  const bucket = await prisma.dmRateLimitBucket.findUnique({
    where: {
      instagramAccountId_windowStart: {
        instagramAccountId,
        windowStart: currentWindowStart(),
      },
    },
    select: { count: true },
  });
  return bucket?.count ?? 0;
}

export async function checkRateLimit(
  instagramAccountId: string,
  requeueAttempt = 0
): Promise<RateLimitResult> {
  const count = await currentCount(instagramAccountId);
  if (count >= RATE_LIMIT_MAX) return blockedResult(count, requeueAttempt);
  return {
    allowed: true,
    currentCount: count,
    remainingDMs: RATE_LIMIT_MAX - count,
    shouldRequeue: false,
    requeueDelayMs: 0,
    shouldSkip: false,
    reserved: false,
  };
}

export async function reserveDMSlot(
  instagramAccountId: string,
  requeueAttempt = 0
): Promise<RateLimitResult> {
  const now = new Date();
  const windowStart = currentWindowStart(now);
  const rows = await prisma.$queryRawUnsafe<Array<{ count: number | bigint }>>(
    `INSERT INTO "DmRateLimitBucket"
       ("instagramAccountId", "windowStart", "count", "updatedAt")
     VALUES (?, ?, 1, ?)
     ON CONFLICT ("instagramAccountId", "windowStart") DO UPDATE SET
       "count" = "DmRateLimitBucket"."count" + 1,
       "updatedAt" = excluded."updatedAt"
     WHERE "DmRateLimitBucket"."count" < ?
     RETURNING "count"`,
    instagramAccountId,
    windowStart,
    now,
    RATE_LIMIT_MAX
  );

  if (rows.length === 0) {
    return blockedResult(await currentCount(instagramAccountId), requeueAttempt);
  }

  const count = Number(rows[0].count);
  return {
    allowed: true,
    currentCount: count,
    remainingDMs: Math.max(0, RATE_LIMIT_MAX - count),
    shouldRequeue: false,
    requeueDelayMs: 0,
    shouldSkip: false,
    reserved: true,
  };
}

export async function incrementDMCounter(
  instagramAccountId: string
): Promise<number> {
  const result = await reserveDMSlot(instagramAccountId, MAX_REQUEUE_ATTEMPTS);
  return result.currentCount;
}

export async function getCurrentDMCount(
  instagramAccountId: string
): Promise<number> {
  return currentCount(instagramAccountId);
}

export async function resetRateLimit(
  instagramAccountId: string
): Promise<void> {
  await prisma.dmRateLimitBucket.deleteMany({ where: { instagramAccountId } });
}

export {
  RATE_LIMIT_MAX,
  RATE_LIMIT_WINDOW,
  REQUEUE_DELAY_MS,
  MAX_REQUEUE_ATTEMPTS,
};
