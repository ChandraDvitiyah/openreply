import { prisma } from "@/lib/db/client";

const WORKER_STATE_KEY = "dm";
const WORKER_HEARTBEAT_TTL_MS = 3 * 60_000;
const DUPLICATE_ALERT_WINDOW_MS = 5 * 60_000;

export interface WorkerHeartbeat {
  status: "running";
  worker: "dm";
  pid: number;
  hostname?: string;
  startedAt?: string;
  checkedAt: string;
}

export interface WorkerHealth {
  healthy: boolean;
  heartbeat: WorkerHeartbeat | null;
  ageMs: number | null;
}

export interface WorkerAlert {
  level: "warning" | "error";
  message: string;
  jobId?: string;
  instagramAccountId?: string;
  facebookPageId?: string;
  commentId?: string;
  createdAt: string;
}

export async function recordWorkerHeartbeat(
  heartbeat: Omit<WorkerHeartbeat, "checkedAt" | "status" | "worker">
) {
  const checkedAt = new Date();
  await prisma.workerState.upsert({
    where: { key: WORKER_STATE_KEY },
    create: {
      key: WORKER_STATE_KEY,
      status: "running",
      pid: heartbeat.pid,
      hostname: heartbeat.hostname,
      startedAt: heartbeat.startedAt ? new Date(heartbeat.startedAt) : null,
      checkedAt,
    },
    update: {
      status: "running",
      pid: heartbeat.pid,
      hostname: heartbeat.hostname,
      startedAt: heartbeat.startedAt ? new Date(heartbeat.startedAt) : null,
      checkedAt,
    },
  });
}

export async function getWorkerHealth(): Promise<WorkerHealth> {
  const state = await prisma.workerState.findUnique({
    where: { key: WORKER_STATE_KEY },
  });
  if (!state) return { healthy: false, heartbeat: null, ageMs: null };

  const ageMs = Date.now() - state.checkedAt.getTime();
  return {
    healthy: state.status === "running" && ageMs <= WORKER_HEARTBEAT_TTL_MS,
    heartbeat: {
      status: "running",
      worker: "dm",
      pid: state.pid,
      hostname: state.hostname ?? undefined,
      startedAt: state.startedAt?.toISOString(),
      checkedAt: state.checkedAt.toISOString(),
    },
    ageMs,
  };
}

export async function recordWorkerAlert(alert: Omit<WorkerAlert, "createdAt">) {
  const level = alert.level === "warning" ? "WARNING" : "ERROR";
  const duplicate = await prisma.operationalEvent.findFirst({
    where: {
      source: "WORKER",
      level,
      message: alert.message,
      createdAt: { gte: new Date(Date.now() - DUPLICATE_ALERT_WINDOW_MS) },
    },
    select: { id: true },
  });
  if (duplicate) return;

  const account = alert.instagramAccountId
    ? await prisma.instagramAccount.findUnique({
        where: { instagramId: alert.instagramAccountId },
        select: { workspaceId: true },
      })
    : null;
  const facebookPage = alert.facebookPageId
    ? await prisma.facebookPage.findUnique({
        where: { pageId: alert.facebookPageId },
        select: { workspaceId: true },
      })
    : null;

  await prisma.operationalEvent.create({
    data: {
      workspaceId: account?.workspaceId ?? facebookPage?.workspaceId ?? null,
      source: "WORKER",
      level,
      message: alert.message,
      payload: {
        jobId: alert.jobId ?? null,
        instagramAccountId: alert.instagramAccountId ?? null,
        facebookPageId: alert.facebookPageId ?? null,
        commentId: alert.commentId ?? null,
      },
    },
  });
}

export async function getWorkerAlerts(limit = 10): Promise<WorkerAlert[]> {
  const events = await prisma.operationalEvent.findMany({
    where: { source: "WORKER", level: { in: ["WARNING", "ERROR"] } },
    orderBy: { createdAt: "desc" },
    take: Math.max(0, limit),
    select: { level: true, message: true, payload: true, createdAt: true },
  });

  return events.map((event) => {
    const payload =
      typeof event.payload === "object" && event.payload !== null
        ? (event.payload as Record<string, unknown>)
        : {};
    const optionalString = (value: unknown) =>
      typeof value === "string" ? value : undefined;
    return {
      level: event.level === "WARNING" ? "warning" : "error",
      message: event.message,
      jobId: optionalString(payload.jobId),
      instagramAccountId: optionalString(payload.instagramAccountId),
      facebookPageId: optionalString(payload.facebookPageId),
      commentId: optionalString(payload.commentId),
      createdAt: event.createdAt.toISOString(),
    };
  });
}
