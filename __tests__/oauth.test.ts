import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  createOAuthState,
  decryptToken,
  encryptToken,
  exchangeCodeForToken,
  verifyOAuthState,
} from "../lib/meta/oauth";

beforeEach(() => {
  vi.stubEnv(
    "ENCRYPTION_KEY",
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("OAuth state and token encryption", () => {
  it("round-trips encrypted tokens", () => {
    const encrypted = encryptToken("long-lived-token");
    expect(encrypted).not.toBe("long-lived-token");
    expect(decryptToken(encrypted)).toBe("long-lived-token");
  });

  it("signs and verifies Instagram OAuth state", () => {
    const state = createOAuthState("workspace_123");
    expect(verifyOAuthState(state)?.workspaceId).toBe("workspace_123");
  });

  it("rejects tampered OAuth state", () => {
    const state = createOAuthState("workspace_123");
    expect(verifyOAuthState(`${state}tampered`)).toBeNull();
  });
});

describe("Instagram authorization-code response", () => {
  beforeEach(() => {
    vi.stubEnv("INSTAGRAM_APP_ID", "test-app");
    vi.stubEnv("INSTAGRAM_APP_SECRET", "test-secret");
    vi.spyOn(console, "info").mockImplementation(() => {});
  });

  it.each([
    { access_token: "short-token", user_id: 123 },
    { data: [{ access_token: "short-token", user_id: "123" }] },
  ])("accepts flat and single-account wrapped token responses", async (body) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(body)));
    expect(await exchangeCodeForToken("code", "https://kult.example/api/instagram/callback"))
      .toEqual({ accessToken: "short-token", userId: "123" });
    expect(console.info).toHaveBeenCalledWith("[Instagram OAuth] Code exchange completed", {
      responseFormat: "data" in body ? "wrapped" : "flat", tokenLength: 11,
    });
  });

  it.each([
    {}, { access_token: "", user_id: "123" }, { access_token: "token" },
    { data: [{ access_token: "one", user_id: "1" }, { access_token: "two", user_id: "2" }] },
  ])("rejects missing or ambiguous token responses without logging credentials", async (body) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(body)));
    await expect(exchangeCodeForToken("code", "https://kult.example/api/instagram/callback"))
      .rejects.toThrow("invalid token response");
    expect(console.info).not.toHaveBeenCalled();
  });
});
