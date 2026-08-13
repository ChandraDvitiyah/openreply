import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { getDMQueue } from "@/lib/queue/client";
import { getWorkerHealth } from "@/lib/ops/worker-health";
import {
  prefersHealthHtml,
  renderHealthPage,
  type HealthPageData,
} from "@/lib/ops/health-page";

export const runtime = "nodejs";
// Health must reflect live state (worker heartbeat, queue depth), never a
// cached response, or it reports stale worker start times.
export const dynamic = "force-dynamic";

type CheckStatus = "ok" | "error";

interface HealthCheck {
  status: CheckStatus;
  detail?: string;
}

async function checkDatabase(): Promise<HealthCheck> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { status: "ok" };
  } catch (error) {
    return {
      status: "error",
      detail: error instanceof Error ? error.message : "Database check failed",
    };
  }
}

async function checkQueue(): Promise<HealthCheck & { counts?: unknown }> {
  try {
    const counts = await getDMQueue().getJobCounts(
      "waiting",
      "active",
      "delayed",
      "failed"
    );
    return { status: "ok", counts };
  } catch (error) {
    return {
      status: "error",
      detail: error instanceof Error ? error.message : "Queue check failed",
    };
  }
}

export async function GET(request: Request) {
  const [database, queue, worker] = await Promise.all([
    checkDatabase(),
    checkQueue(),
    getWorkerHealth().catch((error) => ({
      healthy: false,
      heartbeat: null,
      ageMs: null,
      error: error instanceof Error ? error.message : "Worker check failed",
    })),
  ]);

  const healthy =
    database.status === "ok" &&
    queue.status === "ok" &&
    worker.healthy;

  const payload: HealthPageData = {
    status: healthy ? "ok" : "degraded",
    checks: {
      database,
      queue,
      worker,
    },
  };
  const status = healthy ? 200 : 503;

  if (prefersHealthHtml(request)) {
    return new Response(renderHealthPage(payload), {
      status,
      headers: {
        "Cache-Control": "no-store, max-age=0",
        "Content-Security-Policy":
          "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        "Content-Type": "text/html; charset=utf-8",
        Vary: "Accept",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  return NextResponse.json(payload, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      Vary: "Accept",
    },
  });
}
