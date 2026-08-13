import { describe, expect, it } from "vitest";
import {
  prefersHealthHtml,
  renderHealthPage,
  type HealthPageData,
} from "../lib/ops/health-page";

const healthyPayload: HealthPageData = {
  status: "ok",
  checks: {
    database: { status: "ok" },
    queue: {
      status: "ok",
      counts: { waiting: 1, active: 2, delayed: 3, failed: 0 },
    },
    worker: {
      healthy: true,
      heartbeat: { checkedAt: "2026-08-10T14:41:31.554Z" },
      ageMs: 6_000,
    },
  },
};

describe("health content negotiation", () => {
  it("renders HTML for browsers and JSON for generic clients", () => {
    expect(
      prefersHealthHtml(
        new Request("https://kultreply.vercel.app/api/health", {
          headers: { accept: "text/html,application/xhtml+xml" },
        })
      )
    ).toBe(true);

    expect(
      prefersHealthHtml(
        new Request("https://kultreply.vercel.app/api/health", {
          headers: { accept: "*/*" },
        })
      )
    ).toBe(false);
  });

  it("supports explicit format overrides", () => {
    expect(
      prefersHealthHtml(
        new Request("https://kultreply.vercel.app/api/health?format=json", {
          headers: { accept: "text/html" },
        })
      )
    ).toBe(false);

    expect(
      prefersHealthHtml(
        new Request("https://kultreply.vercel.app/api/health?format=html")
      )
    ).toBe(true);
  });
});

describe("health status page", () => {
  it("renders all live services and queue counts", () => {
    const html = renderHealthPage(healthyPayload);

    expect(html).toContain("All systems operational");
    expect(html).toContain("Live component checks");
    expect(html).toContain("Database");
    expect(html).toContain("Message queue");
    expect(html).toContain("Automation worker");
    expect(html).toContain("Heartbeat 6s ago");
    expect(html).toContain("<dd>3</dd>");
    expect(html).toContain("/api/health?format=json");
    expect(html.match(/role="meter"/g)).toHaveLength(3);
  });

  it("renders a clear degraded state without exposing raw service errors", () => {
    const html = renderHealthPage({
      ...healthyPayload,
      status: "degraded",
      checks: {
        ...healthyPayload.checks,
        database: {
          status: "error",
          detail: '<script>alert("secret")</script>',
        },
      },
    });

    expect(html).toContain("Some systems are degraded");
    expect(html).toContain("The database check did not complete");
    expect(html).not.toContain("<script>alert");
  });
});
