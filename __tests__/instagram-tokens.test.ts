import { afterEach, describe, expect, it, vi } from "vitest";
import { getLongLivedToken, getUserInfo, refreshLongLivedToken } from "@/lib/meta/client";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Instagram token lifecycle endpoints", () => {
  it("exchanges a short-lived token without a Graph API version in the path", async () => {
    vi.stubEnv("META_GRAPH_API_VERSION", "v25.0");
    vi.stubEnv("INSTAGRAM_APP_SECRET", "test-secret");
    const fetchMock = vi.fn().mockResolvedValue(Response.json({
      access_token: "long-lived-token", expires_in: 5184000,
    }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await getLongLivedToken("short-lived-token")).toEqual({
      accessToken: "long-lived-token", expiresIn: 5184000,
    });
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.origin + url.pathname).toBe("https://graph.instagram.com/access_token");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      grant_type: "ig_exchange_token", client_secret: "test-secret", access_token: "short-lived-token",
    });
  });

  it("refreshes a long-lived token without a Graph API version in the path", async () => {
    vi.stubEnv("META_GRAPH_API_VERSION", "v26.0");
    const fetchMock = vi.fn().mockResolvedValue(Response.json({
      access_token: "refreshed-token", expires_in: 5183999,
    }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await refreshLongLivedToken("long-lived-token")).toEqual({
      accessToken: "refreshed-token", expiresIn: 5183999,
    });
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.origin + url.pathname).toBe("https://graph.instagram.com/refresh_access_token");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      grant_type: "ig_refresh_token", access_token: "long-lived-token",
    });
  });

  it("continues using the configured API version for account requests", async () => {
    vi.stubEnv("META_GRAPH_API_VERSION", "v26.0");
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ id: "ig-account", username: "tester" }));
    vi.stubGlobal("fetch", fetchMock);
    await getUserInfo("access-token");
    expect(new URL(fetchMock.mock.calls[0][0]).pathname).toBe("/v26.0/me");
  });

  it("does not accept a failed token exchange", async () => {
    vi.stubEnv("INSTAGRAM_APP_SECRET", "test-secret");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      error: { code: 190, message: "Invalid access token" },
    }, { status: 400 })));
    await expect(getLongLivedToken("expired-token")).rejects.toThrow("Invalid access token");
  });
});
