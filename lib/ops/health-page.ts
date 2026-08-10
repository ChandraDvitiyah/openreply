type CheckStatus = "ok" | "error";

interface ServiceCheck {
  status: CheckStatus;
  detail?: string;
}

interface QueueCheck extends ServiceCheck {
  counts?: unknown;
}

interface WorkerCheck {
  healthy: boolean;
  heartbeat: {
    checkedAt?: string;
    startedAt?: string;
  } | null;
  ageMs: number | null;
  error?: string;
}

export interface HealthPageData {
  status: "ok" | "degraded";
  checks: {
    database: ServiceCheck;
    redis: ServiceCheck;
    queue: QueueCheck;
    worker: WorkerCheck;
  };
}

interface QueueCounts {
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
}

const ICONS = {
  database: `<svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="5" rx="7" ry="3"/><path d="M5 5v6c0 1.7 3.1 3 7 3s7-1.3 7-3V5"/><path d="M5 11v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/></svg>`,
  redis: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 8 4-8 4-8-4 8-4Z"/><path d="m4 12 8 4 8-4"/><path d="m4 17 8 4 8-4"/></svg>`,
  queue: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="5" rx="2"/><rect x="4" y="15" width="16" height="5" rx="2"/><path d="M8 9v6M16 9v6"/></svg>`,
  worker: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="4"/><path d="M9 9h6v6H9zM12 4V2M12 22v-2M4 12H2M22 12h-2"/></svg>`,
} as const;

function safeCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : 0;
}

function getQueueCounts(value: unknown): QueueCounts {
  const counts =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {};

  return {
    waiting: safeCount(counts.waiting),
    active: safeCount(counts.active),
    delayed: safeCount(counts.delayed),
    failed: safeCount(counts.failed),
  };
}

function formatAge(ageMs: number | null): string {
  if (ageMs === null || !Number.isFinite(ageMs) || ageMs < 0) {
    return "No recent heartbeat";
  }

  const seconds = Math.floor(ageMs / 1000);
  if (seconds < 5) return "Heartbeat just now";
  if (seconds < 60) return `Heartbeat ${seconds}s ago`;

  const minutes = Math.floor(seconds / 60);
  return `Heartbeat ${minutes}m ago`;
}

function serviceCard(input: {
  icon: keyof typeof ICONS;
  label: string;
  healthy: boolean;
  detail: string;
  extra?: string;
}) {
  const statusLabel = input.healthy ? "Operational" : "Degraded";
  const width = input.healthy ? 100 : 12;

  return `
    <article class="service-card ${input.healthy ? "is-up" : "is-down"}">
      <div class="service-topline">
        <span class="service-icon">${ICONS[input.icon]}</span>
        <span class="status-dot" aria-hidden="true"></span>
      </div>
      <div class="service-copy">
        <p class="eyebrow">${input.label}</p>
        <h2>${statusLabel}</h2>
        <p class="detail">${input.detail}</p>
      </div>
      <div class="health-meter" role="meter" aria-label="${input.label} health" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${width}">
        <span style="width: ${width}%"></span>
      </div>
      ${input.extra ?? ""}
    </article>`;
}

export function prefersHealthHtml(request: Request): boolean {
  const url = new URL(request.url);
  const format = url.searchParams.get("format")?.toLowerCase();
  if (format === "json") return false;
  if (format === "html") return true;

  return (request.headers.get("accept") ?? "")
    .toLowerCase()
    .includes("text/html");
}

export function renderHealthPage(data: HealthPageData): string {
  const queueCounts = getQueueCounts(data.checks.queue.counts);
  const healthy = data.status === "ok";
  const checkedAt = new Date().toISOString();
  const checkedAtLabel = new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(checkedAt));

  const cards = [
    serviceCard({
      icon: "database",
      label: "Database",
      healthy: data.checks.database.status === "ok",
      detail:
        data.checks.database.status === "ok"
          ? "Turso is accepting queries"
          : "The database check did not complete",
    }),
    serviceCard({
      icon: "redis",
      label: "Redis",
      healthy: data.checks.redis.status === "ok",
      detail:
        data.checks.redis.status === "ok"
          ? "Upstash responded successfully"
          : "The Redis check did not complete",
    }),
    serviceCard({
      icon: "queue",
      label: "Message queue",
      healthy: data.checks.queue.status === "ok",
      detail:
        data.checks.queue.status === "ok"
          ? "Jobs are flowing normally"
          : "The queue check did not complete",
      extra: `
        <dl class="queue-stats">
          <div><dt>Waiting</dt><dd>${queueCounts.waiting}</dd></div>
          <div><dt>Active</dt><dd>${queueCounts.active}</dd></div>
          <div><dt>Delayed</dt><dd>${queueCounts.delayed}</dd></div>
          <div><dt>Failed</dt><dd>${queueCounts.failed}</dd></div>
        </dl>`,
    }),
    serviceCard({
      icon: "worker",
      label: "Automation worker",
      healthy: data.checks.worker.healthy,
      detail: data.checks.worker.healthy
        ? formatAge(data.checks.worker.ageMs)
        : "No fresh worker heartbeat",
    }),
  ].join("");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="theme-color" content="${healthy ? "#9ce069" : "#ffb4a8"}" />
    <meta http-equiv="refresh" content="30" />
    <title>Kult Status — ${healthy ? "All systems operational" : "Service disruption"}</title>
    <style>
      :root {
        color-scheme: light;
        --ink: #292929;
        --secondary: #5d5d5d;
        --tertiary: #8b8b85;
        --paper: #f5f4ee;
        --surface: rgba(255, 255, 255, .9);
        --line: #deded7;
        --brand: #9ce069;
        --brand-dark: #044340;
        --danger: #b42318;
        --danger-soft: #ffb4a8;
      }

      * { box-sizing: border-box; }

      html { min-height: 100%; }

      body {
        min-height: 100vh;
        margin: 0;
        background:
          radial-gradient(circle at 50% -10%, rgba(156, 224, 105, .32), transparent 34rem),
          linear-gradient(180deg, #fbfbf7 0%, var(--paper) 72%);
        color: var(--ink);
        font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Helvetica Neue", Arial, sans-serif;
        font-size: 13px;
        letter-spacing: -.15px;
      }

      a { color: inherit; }

      .shell {
        width: min(1040px, calc(100% - 32px));
        margin: 0 auto;
        padding: 28px 0 48px;
      }

      .nav {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: clamp(56px, 9vw, 112px);
      }

      .brand {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        text-decoration: none;
        font-size: 14px;
        font-weight: 600;
      }

      .brand-mark {
        display: grid;
        width: 30px;
        height: 30px;
        place-items: center;
        border-radius: 10px;
        background: var(--brand-dark);
        color: var(--brand);
        font-weight: 700;
        transform: rotate(-3deg);
      }

      .json-link {
        display: inline-flex;
        min-height: 34px;
        align-items: center;
        border: 1px solid var(--line);
        border-radius: 999px;
        background: rgba(255,255,255,.72);
        padding: 0 14px;
        color: var(--secondary);
        text-decoration: none;
        transition: border-color 160ms ease, background 160ms ease;
      }

      .json-link:hover { border-color: #a9aaa2; background: #fff; }

      .hero {
        max-width: 700px;
        margin: 0 auto 42px;
        text-align: center;
      }

      .overall-pill {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 18px;
        border: 1px solid ${healthy ? "rgba(4,67,64,.15)" : "rgba(180,35,24,.2)"};
        border-radius: 999px;
        background: ${healthy ? "rgba(156,224,105,.32)" : "rgba(255,180,168,.38)"};
        padding: 7px 12px;
        color: ${healthy ? "var(--brand-dark)" : "var(--danger)"};
        font-size: 12px;
        font-weight: 600;
      }

      .pulse {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: currentColor;
        box-shadow: 0 0 0 4px ${healthy ? "rgba(4,67,64,.1)" : "rgba(180,35,24,.1)"};
      }

      h1 {
        max-width: 640px;
        margin: 0 auto;
        font-size: clamp(36px, 6vw, 64px);
        font-weight: 500;
        line-height: .98;
        letter-spacing: -.055em;
      }

      .hero p {
        max-width: 520px;
        margin: 20px auto 0;
        color: var(--secondary);
        font-size: 14px;
        line-height: 1.65;
      }

      .services {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 12px;
      }

      .service-card {
        min-height: 264px;
        display: flex;
        flex-direction: column;
        border: 1px solid var(--line);
        border-radius: 16px;
        background: var(--surface);
        padding: 18px;
        box-shadow: 0 18px 50px rgba(41,41,41,.045), inset 0 1px 0 rgba(255,255,255,.9);
        backdrop-filter: blur(14px);
      }

      .service-topline {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 36px;
      }

      .service-icon {
        display: grid;
        width: 40px;
        height: 40px;
        place-items: center;
        border-radius: 13px;
        background: #f0efe9;
        color: var(--ink);
      }

      .service-icon svg {
        width: 20px;
        height: 20px;
        fill: none;
        stroke: currentColor;
        stroke-width: 1.6;
        stroke-linecap: round;
        stroke-linejoin: round;
      }

      .status-dot {
        width: 9px;
        height: 9px;
        border-radius: 50%;
        background: var(--brand-dark);
        box-shadow: 0 0 0 5px rgba(4,67,64,.09);
      }

      .is-down .status-dot {
        background: var(--danger);
        box-shadow: 0 0 0 5px rgba(180,35,24,.09);
      }

      .service-copy { min-height: 92px; }

      .eyebrow {
        margin: 0 0 8px;
        color: var(--tertiary);
        font-size: 12px;
      }

      h2 {
        margin: 0;
        font-size: 24px;
        font-weight: 500;
        line-height: 1.1;
      }

      .detail {
        margin: 10px 0 0;
        color: var(--secondary);
        font-size: 12px;
        line-height: 1.45;
      }

      .health-meter {
        height: 7px;
        margin-top: auto;
        overflow: hidden;
        border-radius: 999px;
        background: #e8e8e2;
      }

      .health-meter span {
        display: block;
        height: 100%;
        border-radius: inherit;
        background: linear-gradient(90deg, var(--brand-dark), var(--brand));
      }

      .is-down .health-meter span {
        background: linear-gradient(90deg, var(--danger), var(--danger-soft));
      }

      .queue-stats {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 5px;
        margin: 14px 0 0;
      }

      .queue-stats div {
        display: flex;
        min-width: 0;
        flex-direction: column-reverse;
        gap: 3px;
      }

      .queue-stats dt {
        overflow: hidden;
        color: var(--tertiary);
        font-size: 10px;
        text-overflow: ellipsis;
      }

      .queue-stats dd {
        margin: 0;
        font-size: 12px;
        font-weight: 600;
      }

      .footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 24px;
        margin-top: 22px;
        padding: 0 4px;
        color: var(--tertiary);
        font-size: 12px;
      }

      .footer a { color: var(--secondary); text-decoration: none; }
      .footer a:hover { text-decoration: underline; }

      @media (max-width: 860px) {
        .services { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      }

      @media (max-width: 540px) {
        .shell { width: min(100% - 24px, 1040px); padding-top: 18px; }
        .nav { margin-bottom: 64px; }
        .services { grid-template-columns: 1fr; }
        .service-card { min-height: 226px; }
        .service-topline { margin-bottom: 28px; }
        .footer { align-items: flex-start; flex-direction: column; gap: 8px; }
      }

      @media (prefers-reduced-motion: reduce) {
        *, *::before, *::after { scroll-behavior: auto !important; }
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <nav class="nav" aria-label="Status navigation">
        <a class="brand" href="/"><span class="brand-mark">K</span><span>Kult</span></a>
        <a class="json-link" href="/api/health?format=json">View JSON</a>
      </nav>

      <section class="hero" aria-labelledby="status-title">
        <span class="overall-pill"><span class="pulse" aria-hidden="true"></span>${healthy ? "All systems operational" : "Some systems need attention"}</span>
        <h1 id="status-title">${healthy ? "Everything is running smoothly." : "Kult is experiencing a disruption."}</h1>
        <p>Live checks across the database, queue, and automation worker. This page refreshes itself every 30 seconds.</p>
      </section>

      <section class="services" aria-label="Service health">
        ${cards}
      </section>

      <footer class="footer">
        <span>Last checked ${checkedAtLabel} UTC</span>
        <a href="/">Return to Kult</a>
      </footer>
    </main>
  </body>
</html>`;
}
