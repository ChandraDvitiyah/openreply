import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ context: { workspaceId: "workspace-1" } as { workspaceId: string } | null }));
vi.mock("@/lib/workspace-access", () => ({ getCurrentWorkspaceContext: async () => state.context }));
import { POST } from "@/app/api/seo/bulk-dr/route";
import { domainRatingsCsv, normalizeDomain, parseDomains } from "@/lib/seo/domains";

const request = (input: string, headers: Record<string, string> = {}) => new Request("https://kult.example/api/seo/bulk-dr", {
  method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify({ input }),
});
const providerResponse = (targets: unknown[]) => Response.json({ domain_rating: { license: "https://ahrefs.com/legal/domain-rating-license", targets } });
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  state.context = { workspaceId: "workspace-1" };
  vi.stubEnv("AHREFS_API_KEY", "test-secret-never-returned");
  fetchMock = vi.fn().mockResolvedValue(providerResponse([{ target: "example.com", domain_rating: 42.5 }]));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("domain list normalization", () => {
  it("normalizes URLs and IDNs, preserves subdomains, and deduplicates across separators", () => {
    expect(parseDomains("HTTPS://Example.COM/path?q=1\nexample.com.; www.example.com,blog.example.com\thttps://bücher.de")).toEqual({
      domains: ["example.com", "www.example.com", "blog.example.com", "xn--bcher-kva.de"], duplicates: 1, invalid: [],
    });
  });
  it.each(["localhost", "127.0.0.1", "[::1]", "https://user:password@example.com", "ftp://example.com", "example.com:8080", "-bad.com", "bad_.com", "example.local", "javascript:alert(1)", "a..com", "example.com\\evil", `${"a".repeat(64)}.com`])("rejects invalid domain %s", (value) => {
    expect(normalizeDomain(value)).toBeNull();
  });
  it("exports zero ratings separately from unavailable values", () => {
    const csv = domainRatingsCsv([{ domain: "example.com", rating: 0 }, { domain: "missing.com", rating: null }], "2026-10-23T12:00:00Z");
    expect(csv).toContain('"example.com","0","Checked"');
    expect(csv).toContain('"missing.com","","Unavailable"');
    expect(csv).toContain("Domain Rating by Ahrefs");
  });
});

describe("authenticated bulk DR endpoint", () => {
  it("denies anonymous users before contacting Ahrefs", async () => {
    state.context = null;
    expect((await POST(request("example.com"))).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each(["origin", "sec-fetch-site"])("denies cross-site requests via %s", async (header) => {
    expect((await POST(request("example.com", { [header]: header === "origin" ? "https://foreign.example" : "cross-site" }))).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("sends one authenticated batch and maps reordered results by hostname", async () => {
    fetchMock.mockResolvedValueOnce(providerResponse([
      { target: "https://second.com/", domain_rating: 0 },
      { target: "example.com", domain_rating: 42.5 },
    ]));
    const response = await POST(request("https://Example.com/path\nsecond.com\nmissing.com\nexample.com", { origin: "https://kult.example" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const result = await response.json();
    expect(result).toMatchObject({ results: [{ domain: "example.com", rating: 42.5 }, { domain: "second.com", rating: 0 }, { domain: "missing.com", rating: null }], duplicates: 1 });
    expect(Number.isNaN(Date.parse(result.checkedAt))).toBe(false);
    expect(JSON.stringify(result)).not.toContain("test-secret");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.ahrefs.com/v3/public/domain-rating-free?output=json");
    expect(options.headers.Authorization).toBe("Bearer test-secret-never-returned");
    expect(options).toMatchObject({ method: "POST", cache: "no-store", redirect: "error" });
    expect(JSON.parse(options.body)).toEqual({ targets: ["example.com", "second.com", "missing.com"], version: "dr3" });
  });
  it.each(["", "  , ; ", "example.com\nnot-a-domain", Array.from({ length: 1001 }, (_, i) => `d${i}.com`).join("\n"), "a".repeat(300001)])("rejects empty, invalid, or oversized lists without calling Ahrefs", async (input) => {
    expect((await POST(request(input))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("accepts exactly 1,000 unique domains in a single call", async () => {
    const response = await POST(request(Array.from({ length: 1000 }, (_, i) => `d${i}.com`).join("\n")));
    expect(response.status).toBe(200);
    expect((await response.json()).results).toHaveLength(1000);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it("handles a missing key without contacting Ahrefs", async () => {
    vi.stubEnv("AHREFS_API_KEY", " ");
    expect((await POST(request("example.com"))).status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([[401, 503], [403, 503], [429, 429], [500, 502]])("handles provider HTTP %i without leaking its body", async (upstream, expected) => {
    fetchMock.mockResolvedValueOnce(new Response("provider-secret-details", { status: upstream }));
    const response = await POST(request("example.com"));
    expect(response.status).toBe(expected);
    expect(await response.text()).not.toContain("provider-secret-details");
  });
  it("handles provider timeouts", async () => {
    fetchMock.mockRejectedValueOnce(new DOMException("Timeout", "TimeoutError"));
    expect((await POST(request("example.com"))).status).toBe(504);
  });
  it.each([{}, { domain_rating: { targets: [{ target: "example.com", domain_rating: 101 }] } }])("rejects malformed provider data", async (body) => {
    fetchMock.mockResolvedValueOnce(Response.json(body));
    expect((await POST(request("example.com"))).status).toBe(502);
  });
  it("rejects malformed JSON", async () => {
    const response = await POST(new Request("https://kult.example/api/seo/bulk-dr", { method: "POST", body: "{" }));
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("bounds request bytes even without a Content-Length header", async () => {
    const response = await POST(new Request("https://kult.example/api/seo/bulk-dr", { method: "POST", body: "a".repeat(1_000_001) }));
    expect(response.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
