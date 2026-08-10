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
  const segments = Array.from(
    { length: 36 },
    () => '<span aria-hidden="true"></span>'
  ).join("");

  return `
    <article class="service-row ${input.healthy ? "is-up" : "is-down"}">
      <div class="service-heading">
        <div class="service-name">
          <span class="service-icon">${ICONS[input.icon]}</span>
          <div>
            <h2>${input.label}</h2>
            <p>${input.detail}</p>
          </div>
        </div>
        <span class="service-status"><span aria-hidden="true"></span>${statusLabel}</span>
      </div>

      <div class="segment-meter" role="meter" aria-label="${input.label} health" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${width}">
        ${segments}
      </div>

      <div class="meter-caption">
        <span>Live check</span>
        <i aria-hidden="true"></i>
        <strong>${input.healthy ? "100% healthy" : "Attention required"}</strong>
        <i aria-hidden="true"></i>
        <span>Now</span>
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
        --tertiary: #8a8a8a;
        --surface: #ffffff;
        --line: #e7e7e3;
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
        background: var(--surface);
        color: var(--ink);
        font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Helvetica Neue", Arial, sans-serif;
        font-size: 13px;
        letter-spacing: -.15px;
      }

      a { color: inherit; }

      .shell {
        width: min(1120px, calc(100% - 32px));
        margin: 0 auto;
        padding: 40px 0 64px;
      }

      .nav {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: clamp(64px, 8vw, 104px);
      }

      .brand {
        display: inline-flex;
        align-items: center;
        gap: 12px;
        text-decoration: none;
        font-size: 20px;
        font-weight: 600;
      }

      .brand-mark {
        display: grid;
        width: 38px;
        height: 38px;
        place-items: center;
        border-radius: 12px;
        background: var(--brand-dark);
        color: var(--brand);
        font-weight: 700;
        transform: rotate(-3deg);
      }

      .json-link {
        display: inline-flex;
        min-height: 42px;
        align-items: center;
        border: 1px solid var(--brand-dark);
        border-radius: 8px;
        background: var(--brand-dark);
        padding: 0 18px;
        color: #fff;
        font-size: 11px;
        font-weight: 600;
        letter-spacing: .14em;
        text-decoration: none;
        text-transform: uppercase;
        transition: background 160ms ease, transform 160ms ease;
      }

      .json-link:hover { background: #075a56; transform: translateY(-1px); }

      .overall-banner {
        display: flex;
        min-height: 96px;
        align-items: center;
        justify-content: space-between;
        gap: 24px;
        border: 1px solid ${healthy ? "#86cd51" : "#e98f82"};
        border-radius: 10px;
        background: ${healthy ? "var(--brand)" : "var(--danger-soft)"};
        padding: 24px 28px;
        color: ${healthy ? "#173412" : "#6f1710"};
      }

      .overall-copy {
        display: flex;
        align-items: center;
        gap: 14px;
      }

      .overall-dot {
        width: 12px;
        height: 12px;
        flex: 0 0 auto;
        border-radius: 50%;
        background: ${healthy ? "var(--brand-dark)" : "var(--danger)"};
        box-shadow: 0 0 0 6px ${healthy ? "rgba(4,67,64,.1)" : "rgba(180,35,24,.12)"};
      }

      .overall-banner h1 {
        margin: 0;
        font-size: 24px;
        font-weight: 500;
        line-height: 1.2;
      }

      .overall-banner p {
        margin: 0;
        font-size: 12px;
        opacity: .72;
      }

      .section-intro {
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        gap: 24px;
        margin: 86px 0 14px;
      }

      .section-intro h2 {
        margin: 0;
        font-size: 14px;
        font-weight: 500;
      }

      .section-intro p {
        margin: 0;
        color: var(--secondary);
        font-size: 12px;
      }

      .services {
        border: 1px solid var(--line);
        border-radius: 10px;
        overflow: hidden;
      }

      .service-row {
        padding: 28px 26px 24px;
        background: #fff;
      }

      .service-row + .service-row { border-top: 1px solid var(--line); }

      .service-heading {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 24px;
        margin-bottom: 20px;
      }

      .service-name {
        display: flex;
        min-width: 0;
        align-items: center;
        gap: 12px;
      }

      .service-icon {
        display: grid;
        width: 34px;
        height: 34px;
        flex: 0 0 auto;
        place-items: center;
        border: 1px solid var(--line);
        border-radius: 9px;
        background: #fafaf8;
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

      .service-name h2 {
        margin: 0;
        font-size: 14px;
        font-weight: 500;
      }

      .service-name p {
        margin: 4px 0 0;
        color: var(--tertiary);
        font-size: 12px;
      }

      .service-status {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        color: #348025;
        font-size: 12px;
        font-weight: 500;
      }

      .service-status span {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: #62bc4b;
      }

      .is-down .service-status { color: var(--danger); }
      .is-down .service-status span { background: var(--danger); }

      .segment-meter {
        display: grid;
        grid-template-columns: repeat(36, minmax(2px, 1fr));
        gap: 4px;
        height: 42px;
      }

      .segment-meter span {
        min-width: 0;
        border-radius: 2px;
        background: #75c95c;
      }

      .is-down .segment-meter span { background: #df7669; }

      .meter-caption {
        display: flex;
        align-items: center;
        gap: 14px;
        margin-top: 12px;
        color: var(--tertiary);
        font-size: 11px;
      }

      .meter-caption i {
        height: 1px;
        flex: 1;
        background: var(--line);
      }

      .meter-caption strong {
        color: var(--secondary);
        font-weight: 500;
        white-space: nowrap;
      }

      .queue-stats {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 8px;
        margin: 22px 0 0;
        padding-top: 18px;
        border-top: 1px solid var(--line);
      }

      .queue-stats div {
        display: grid;
        gap: 4px;
      }

      .queue-stats dt {
        color: var(--tertiary);
        font-size: 11px;
      }

      .queue-stats dd {
        margin: 0;
        font-size: 14px;
        font-weight: 500;
      }

      .footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 24px;
        margin-top: 20px;
        padding: 0 4px;
        color: var(--tertiary);
        font-size: 12px;
      }

      .footer a { color: var(--secondary); text-decoration: none; }
      .footer a:hover { text-decoration: underline; }

      @media (max-width: 540px) {
        .shell { width: min(100% - 24px, 1120px); padding: 20px 0 40px; }
        .nav { margin-bottom: 48px; }
        .brand { font-size: 16px; }
        .brand-mark { width: 34px; height: 34px; }
        .json-link { min-height: 38px; padding: 0 13px; font-size: 10px; }
        .overall-banner { min-height: 104px; align-items: flex-start; flex-direction: column; padding: 22px; }
        .overall-banner h1 { font-size: 20px; }
        .section-intro { align-items: flex-start; flex-direction: column; gap: 6px; margin-top: 58px; }
        .service-row { padding: 22px 18px 20px; }
        .service-heading { align-items: flex-start; }
        .service-name p { max-width: 180px; }
        .segment-meter { gap: 2px; height: 34px; }
        .meter-caption { gap: 8px; }
        .meter-caption i { display: none; }
        .meter-caption strong { margin-left: auto; }
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

      <section class="overall-banner" aria-labelledby="status-title">
        <div class="overall-copy">
          <span class="overall-dot" aria-hidden="true"></span>
          <h1 id="status-title">${healthy ? "All systems operational" : "Some systems are degraded"}</h1>
        </div>
        <p>Updated ${checkedAtLabel} UTC</p>
      </section>

      <div class="section-intro">
        <h2>Live component checks</h2>
        <p>Current status · refreshes automatically every 30 seconds</p>
      </div>

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
