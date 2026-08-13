import { createDMWorker } from "@/lib/queue/dm-worker";
import { loadEnvConfig } from "@next/env";
import { recordWorkerHeartbeat } from "@/lib/ops/worker-health";
import { reconcileComments } from "@/lib/polling/comment-reconciler";
import { syncAllWorkspacePerformance } from "@/lib/performance/social-sync";
import { replayFailedWebhookEvents } from "@/lib/queue/webhook-enqueue";
import os from "node:os";

loadEnvConfig(process.cwd());

const worker = createDMWorker();
const startedAt = new Date().toISOString();
const HEARTBEAT_INTERVAL_MS = 60_000;
// Polling safety net for comments that webhooks miss. Runs in the worker because
// it must fire every few minutes and Vercel's free crons only run once a day.
const POLL_INTERVAL_MS = Number(
  process.env.COMMENT_POLL_INTERVAL_MS ?? 5 * 60_000
);
const PERFORMANCE_SYNC_INTERVAL_MS = Number(
  process.env.PERFORMANCE_SYNC_INTERVAL_MS ?? 12 * 60 * 60_000
);

console.log("[DM Worker] Started");

async function heartbeat() {
  try {
    await recordWorkerHeartbeat({
      pid: process.pid,
      hostname: os.hostname(),
      startedAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[DM Worker] Heartbeat failed:", message);
  }
}

void heartbeat();
const heartbeatTimer = setInterval(() => void heartbeat(), HEARTBEAT_INTERVAL_MS);

async function poll() {
  try {
    await reconcileComments();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[DM Worker] Comment reconciliation failed:", message);
  }
}

// Kick off one sweep shortly after boot, then on a fixed interval.
setTimeout(() => void poll(), 10_000);
const pollTimer = setInterval(() => void poll(), POLL_INTERVAL_MS);

async function replayWebhooks() {
  try {
    const result = await replayFailedWebhookEvents();
    if (result.scanned > 0) {
      console.log(
        `[Webhook Replay] ${result.replayed} recovered, ${result.failed} still failed`
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[Webhook Replay] Failed:", message);
  }
}

setTimeout(() => void replayWebhooks(), 2_000);
const replayTimer = setInterval(() => void replayWebhooks(), POLL_INTERVAL_MS);

async function syncPerformance() {
  try {
    const results = await syncAllWorkspacePerformance(30);
    const accounts = results.reduce((sum, result) => sum + result.synced, 0);
    const failures = results.reduce((sum, result) => sum + result.failed, 0);
    console.log(`[Performance Sync] ${accounts} accounts refreshed, ${failures} failed`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[Performance Sync] Failed:", message);
  }
}

// Refresh the 30-day snapshot even when nobody opens the dashboard.
setTimeout(() => void syncPerformance(), 30_000);
const performanceSyncTimer = setInterval(
  () => void syncPerformance(),
  PERFORMANCE_SYNC_INTERVAL_MS
);

async function shutdown(signal: string) {
  console.log(`[DM Worker] ${signal} received, closing worker`);
  clearInterval(heartbeatTimer);
  clearInterval(pollTimer);
  clearInterval(replayTimer);
  clearInterval(performanceSyncTimer);
  await worker.close();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
