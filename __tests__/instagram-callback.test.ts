import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/instagram/callback/route";
import { createOAuthState, decryptToken } from "@/lib/meta/oauth";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), membership: vi.fn(), upsert: vi.fn(), canConnect: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/db/client", () => ({ prisma: {
  workspaceMember: { findFirst: mocks.membership },
  instagramAccount: { upsert: mocks.upsert },
} }));
vi.mock("@/lib/instagram-accounts", () => ({ canConnectInstagramAccount: mocks.canConnect }));
vi.mock("@/lib/workspace-access", () => ({ canManageWorkspace: (role: string) => role === "OWNER" || role === "ADMIN" }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://kult.example");
  vi.stubEnv("ENCRYPTION_KEY", "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
  vi.stubEnv("INSTAGRAM_APP_ID", "test-app");
  vi.stubEnv("INSTAGRAM_APP_SECRET", "test-secret");
  vi.stubEnv("META_GRAPH_API_VERSION", "v25.0");
  mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
  mocks.membership.mockResolvedValue({ role: "OWNER" });
  mocks.canConnect.mockResolvedValue({ allowed: true });
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function callbackRequest() {
  const url = new URL("https://kult.example/api/instagram/callback");
  url.searchParams.set("code", "authorization-code");
  url.searchParams.set("state", createOAuthState("workspace-1"));
  return new NextRequest(url);
}

describe("Instagram connection callback", () => {
  it.each(["GET", "POST"])("completes Meta consent with a %s exchange and saves the encrypted account", async (exchangeMethod) => {
    const fetchMock = vi.fn(async (input: string | URL | Request, options?: RequestInit) => {
      const url = new URL(String(input));
      if (url.href === "https://api.instagram.com/oauth/access_token") {
        expect(options?.method).toBe("POST");
        expect(new URLSearchParams(String(options?.body)).get("redirect_uri"))
          .toBe("https://kult.example/api/instagram/callback");
        return Response.json({ access_token: "short-token", user_id: "ig-1" });
      }
      if (url.origin + url.pathname === "https://graph.instagram.com/access_token") {
        if (exchangeMethod === "POST" && options?.method !== "POST") {
          return Response.json({ error: { code: 100, message: "Unsupported request - method type: get" } }, { status: 400 });
        }
        return Response.json({ access_token: "long-token", expires_in: 5184000 });
      }
      if (url.pathname === "/v25.0/me") {
        return Response.json({ id: "app-scoped-id", user_id: "ig-1", username: "tester" });
      }
      if (url.pathname === "/v25.0/ig-1/subscribed_apps") {
        return Response.json({ success: true });
      }
      // Reproduce Meta's production error for the old versioned token URL.
      return Response.json({ error: { code: 100, message: "Unsupported request - method type: get" } }, { status: 400 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(callbackRequest());
    expect(response.headers.get("location")).toBe("https://kult.example/settings?instagram=connected");
    expect(mocks.upsert).toHaveBeenCalledOnce();
    const saved = mocks.upsert.mock.calls[0][0];
    expect(saved.where).toEqual({ instagramId: "ig-1" });
    expect(saved.create).toMatchObject({ workspaceId: "workspace-1", username: "tester", webhookSubscribed: true });
    expect(decryptToken(saved.create.accessToken)).toBe("long-token");
    expect(saved.update.accessToken).toBe(saved.create.accessToken);
  });

  it("returns a visible failure without saving an account when token exchange fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(Response.json({ access_token: "short-token", user_id: "ig-1" }))
      .mockResolvedValueOnce(Response.json({ error: { code: 190, message: "Invalid access token" } }, { status: 400 })));
    const response = await GET(callbackRequest());
    expect(response.headers.get("location")).toBe("https://kult.example/settings?instagram=failed");
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("rejects invalid state before exchanging or saving tokens", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await GET(new NextRequest("https://kult.example/api/instagram/callback?code=test&state=invalid"));
    expect(response.headers.get("location")).toBe("https://kult.example/settings?instagram=invalid");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
});
