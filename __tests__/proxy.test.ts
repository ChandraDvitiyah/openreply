import { describe, expect, it } from "vitest";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { config } from "../proxy";

describe("proxy routing", () => {
  it("keeps the public health endpoint outside Clerk", () => {
    expect(
      unstable_doesMiddlewareMatch({
        config,
        nextConfig: {},
        url: "/api/health",
      })
    ).toBe(false);
  });

  it("continues loading Clerk for authenticated pages and other APIs", () => {
    expect(
      unstable_doesMiddlewareMatch({
        config,
        nextConfig: {},
        url: "/dashboard",
      })
    ).toBe(true);

    expect(
      unstable_doesMiddlewareMatch({
        config,
        nextConfig: {},
        url: "/api/dashboard/stats",
      })
    ).toBe(true);
  });

  it("lets MCP verify bearer keys without a browser handshake", () => {
    expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: "/api/mcp" })).toBe(false);
    expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: "/.well-known/oauth-protected-resource" })).toBe(false);
    expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: "/.well-known/oauth-protected-resource/api/mcp" })).toBe(false);
    expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: "/api/agent-keys" })).toBe(true);
    expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: "/agents" })).toBe(true);
  });
});
