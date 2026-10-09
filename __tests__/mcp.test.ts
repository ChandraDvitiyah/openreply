import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createServer, type Server } from "node:http";
import { NextRequest } from "next/server";
import { readdir } from "node:fs/promises";
import { z } from "zod";
import Ajv from "ajv";
import { createHash } from "node:crypto";

const mocks = vi.hoisted(() => ({
  clerkAuth: vi.fn(), currentUser: vi.fn(), verify: vi.fn(), oauthVerify: vi.fn(), keyCreate: vi.fn(), keyList: vi.fn(), keyGet: vi.fn(), keyRevoke: vi.fn(),
  membership: vi.fn(), accounts: vi.fn(), account: vi.fn(), workspace: vi.fn(), createCampaign: vi.fn(),
  user: vi.fn(), memberList: vi.fn(), invitations: vi.fn(), memberUpsert: vi.fn(), campaignLookup: vi.fn(),
  storeMedia: vi.fn(),
}));
vi.mock("@/lib/scheduler/storage", async (original) => ({
  ...await original<typeof import("@/lib/scheduler/storage")>(), storeSchedulerMedia: mocks.storeMedia,
}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: mocks.clerkAuth, currentUser: mocks.currentUser,
  clerkClient: async () => ({ idPOAuthAccessToken: { verify: mocks.oauthVerify }, apiKeys: { verify: mocks.verify, create: mocks.keyCreate, list: mocks.keyList, get: mocks.keyGet, revoke: mocks.keyRevoke } }),
}));
vi.mock("@/lib/db/client", () => ({ prisma: {
  workspaceMember: { findUnique: mocks.membership, findMany: mocks.memberList, upsert: mocks.memberUpsert, findFirst: mocks.membership },
  instagramAccount: { findMany: mocks.accounts, findFirst: mocks.account },
  workspace: { findUnique: mocks.workspace }, automation: { create: mocks.createCampaign, findFirst: mocks.campaignLookup },
  user: { findUnique: mocks.user }, workspaceInvitation: { findMany: mocks.invitations },
} }));

import { POST, GET, DELETE } from "@/app/api/mcp/route";
import * as keyRoutes from "@/app/api/agent-keys/route";
import { AGENT_TOOLS } from "@/lib/mcp/tools";
import { agentContext } from "@/lib/mcp/context";
import { getCurrentUserId, getCurrentWorkspaceId } from "@/lib/auth";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";

const clients: Client[] = [];
const httpServers: Server[] = [];
const key = { id: "key_one", subject: "user_one", claims: { purpose: "kult-mcp", workspaceId: "workspace_one" },
  scopes: ["kult:read", "kult:write"], revoked: false, expired: false, expiration: Date.now() + 86400000, secret: "secret" };
function rpc(method: string, params?: unknown, token: string | null = "write-key") {
  return new Request("http://localhost:3000/api/mcp", { method: "POST", headers: {
    ...(token === null ? {} : { Authorization: `Bearer ${token}` }), "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-11-25",
  }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
}
async function connect(token: string | null = "write-key") {
  const client = new Client({ name: "kult-test-agent", version: "1.0.0" });
  clients.push(client);
  await client.connect(new StreamableHTTPClientTransport(new URL("http://localhost:3000/api/mcp"), {
    requestInit: { headers: token === null ? {} : { Authorization: `Bearer ${token}` } },
    fetch: async (input, init) => {
      const request = new Request(input, init);
      return request.method === "GET" ? GET() : request.method === "DELETE" ? DELETE() : POST(request);
    },
  }));
  return client;
}
const campaignBody = { name: "Agent campaign", instagramAccountId: "ig_one", type: "COMMENT_TO_DM",
  autoAddNewReels: true, keywords: ["LINK"], dmMessages: ["Here is your link", "Enjoy!"],
  openingDmEnabled: true, openingDmMessage: "Want the link?", openingDmButtonLabel: "Yes",
  publicReplyEnabled: true, publicReplyMessages: ["Check your inbox"], trackedDestinationUrl: "https://example.com/product" };

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("MCP_OAUTH_SCOPE_MODE", "custom");
  vi.stubEnv("MCP_OAUTH_WRITE_ENABLED", "false");
  vi.stubEnv("MCP_OAUTH_CLIENT_ID", "chatgpt_kult");
  vi.stubEnv("MCP_OAUTH_ISSUER", "https://kult.clerk.accounts.dev");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
  vi.stubEnv("INSTAGRAM_APP_ID", "123"); vi.stubEnv("FACEBOOK_APP_ID", "456"); vi.stubEnv("FACEBOOK_APP_SECRET", "test-only");
  vi.stubEnv("ENCRYPTION_KEY", "a".repeat(64));
  mocks.oauthVerify.mockResolvedValue({ clientId: "chatgpt_kult", type: "oauth_token", subject: "user_one",
    scopes: ["kult:read", "kult:write"], revoked: false, expired: false, expiration: Math.floor(Date.now() / 1000) + 86400 });
  mocks.clerkAuth.mockResolvedValue({ userId: "user_one" });
  mocks.verify.mockImplementation(async (secret: string) => {
    if (secret === "invalid") throw { status: 404 };
    if (secret === "read-key") return { ...key, scopes: ["kult:read"] };
    if (secret === "second-key") return { ...key, subject: "user_two", claims: { purpose: "kult-mcp", workspaceId: "workspace_two" } };
    return { ...key };
  });
  mocks.membership.mockImplementation(async ({ where }) => {
    const target = where.workspaceId_userId ?? where;
    return { userId: target.userId, workspaceId: target.workspaceId ?? "workspace_one", role: "OWNER",
      workspace: { id: target.workspaceId ?? "workspace_one", name: "Kult" } };
  });
  mocks.accounts.mockImplementation(async ({ where }) => [{ id: `ig_${where.workspaceId}`, username: where.workspaceId }]);
  mocks.workspace.mockResolvedValue({ id: "workspace_one" });
  mocks.account.mockImplementation(async ({ where }) => where.id === "ig_other" ? null : { id: "ig_one" });
  mocks.createCampaign.mockImplementation(async ({ data }) => ({ id: "campaign_one", ...data }));
  mocks.user.mockResolvedValue({ id: "user_one", email: "owner@example.com", name: "Owner", image: null });
  mocks.storeMedia.mockImplementation(async (workspaceId, contentType, source) => {
    const chunks = []; for await (const chunk of source) chunks.push(Buffer.from(chunk));
    const bytes = Buffer.concat(chunks);
    return { uploaded: true, mediaUrl: `https://f005.backblazeb2.com/file/kult-media/scheduler/${workspaceId}/00000000-0000-0000-0000-000000000001.jpg`,
      contentType, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
  });
});
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  await Promise.all(httpServers.splice(0).map((server) => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); })));
  vi.unstubAllEnvs();
});

describe("Kult MCP protocol and product workflows", () => {
  it("connects a real stdio client through the bundled adapter to HTTP", async () => {
    const server = createServer(async (incoming, outgoing) => {
      const chunks: Buffer[] = [];
      for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) if (value) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
      const request = new Request("http://localhost:3000/api/mcp", { method: incoming.method, headers,
        ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) });
      const response = request.method === "GET" ? GET() : request.method === "DELETE" ? DELETE() : await POST(request);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(await response.text());
    });
    httpServers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as { port: number };
    const client = new Client({ name: "stdio-test", version: "1" }); clients.push(client);
    await client.connect(new StdioClientTransport({ command: process.execPath, args: ["--import", "tsx", "scripts/mcp-stdio.ts"],
      cwd: process.cwd(), env: { KULT_MCP_URL: `http://127.0.0.1:${address.port}/api/mcp`, KULT_MCP_TOKEN: "write-key" }, stderr: "pipe" }));
    expect((await client.callTool({ name: "get_workspace" })).structuredContent).toMatchObject({ workspace: { id: "workspace_one" } });
    expect((await client.listTools()).tools.some((t) => t.name === "create_campaign")).toBe(true);
  });

  it("initializes a real SDK client, lists typed tools, and reads workflow resources", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.length).toBe(AGENT_TOOLS.length + 6);
    expect(tools.find((t) => t.name === "create_campaign")?.inputSchema.properties).toHaveProperty("body");
    const schema = tools.find((t) => t.name === "create_scheduled_post")?.inputSchema;
    expect(JSON.stringify(schema)).toContain("clientRequestId");
    const guide = await client.readResource({ uri: "kult://guide" });
    expect(guide.contents[0]).toHaveProperty("text", expect.stringContaining("NEEDS_REVIEW"));
    const workspace = await client.callTool({ name: "get_workspace", arguments: {} });
    expect(workspace.structuredContent).toMatchObject({ workspace: { id: "workspace_one" }, role: "OWNER" });
  });

  it("calls the actual campaign handler with all advanced fields and workspace ownership", async () => {
    const client = await connect();
    const output = await client.callTool({ name: "create_campaign", arguments: { body: campaignBody } });
    expect(output.isError).toBe(false);
    expect(output.structuredContent).toMatchObject({ status: 201, data: { workspaceId: "workspace_one", openingDmEnabled: true,
      dmMessages: campaignBody.dmMessages, publicReplyMessages: campaignBody.publicReplyMessages, autoAddNewReels: true } });
    expect(mocks.createCampaign).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      instagramAccountId: "ig_one", trackedLinks: { create: expect.objectContaining({ workspaceId: "workspace_one", destinationUrl: campaignBody.trackedDestinationUrl }) },
    }) }));
    expect(mocks.clerkAuth).not.toHaveBeenCalled();
    expect(mocks.currentUser).not.toHaveBeenCalled();
    expect(agentContext.getStore()).toBeUndefined();
  });

  it("keeps two concurrent agents isolated and retains ordinary browser authentication", async () => {
    const [one, two] = await Promise.all([connect(), connect("second-key")]);
    const outputs = await Promise.all([one.callTool({ name: "list_instagram_accounts" }), two.callTool({ name: "list_instagram_accounts" })]);
    expect(outputs[0].structuredContent).toMatchObject({ data: { instagramAccounts: [{ username: "workspace_one" }] } });
    expect(outputs[1].structuredContent).toMatchObject({ data: { instagramAccounts: [{ username: "workspace_two" }] } });
    expect(await getCurrentUserId()).toBe("user_one");
    expect(mocks.clerkAuth).toHaveBeenCalledOnce();
  });

  it("hides writes from read-only keys and rejects guessed mutation calls", async () => {
    const client = await connect("read-key");
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain("list_campaigns");
    expect(names).not.toContain("create_campaign");
    expect(names).not.toContain("connect_instagram");
    const output = await client.callTool({ name: "create_campaign", arguments: { body: campaignBody } });
    expect(output.isError).toBe(true);
    expect(mocks.createCampaign).not.toHaveBeenCalled();
  });

  it("honors role downgrades and removal after connection", async () => {
    const client = await connect();
    mocks.membership.mockResolvedValue({ userId: "user_one", workspaceId: "workspace_one", role: "MEMBER", workspace: { id: "workspace_one" } });
    const output = await client.callTool({ name: "create_campaign", arguments: { body: campaignBody } });
    expect(output.structuredContent).toMatchObject({ status: 403 });
    expect(output.isError).toBe(true);
    expect(mocks.createCampaign).not.toHaveBeenCalled();
    mocks.membership.mockResolvedValue(null);
    expect((await POST(rpc("tools/list"))).status).toBe(403);
  });

  it("rejects accounts outside the key's workspace and invalid input", async () => {
    const client = await connect();
    const output = await client.callTool({ name: "create_campaign", arguments: { body: { ...campaignBody, instagramAccountId: "ig_other" } } });
    expect(output.structuredContent).toMatchObject({ status: 400 });
    expect(mocks.account).toHaveBeenCalledWith({ where: { id: "ig_other", workspaceId: "workspace_one" } });
    const bad = await client.callTool({ name: "create_campaign", arguments: { body: { name: "Invalid" } } });
    expect(bad.isError).toBe(true);
    expect(mocks.createCampaign).not.toHaveBeenCalled();
  });

  it("returns Meta consent as a required user action, and enforces role checks", async () => {
    const client = await connect();
    const output = await client.callTool({ name: "connect_instagram" });
    expect(output.structuredContent).toMatchObject({ status: 200, requiresUserAction: true, url: expect.stringContaining("https://api.instagram.com/") });
    mocks.membership.mockResolvedValue({ userId: "user_one", workspaceId: "workspace_one", role: "MEMBER", workspace: { id: "workspace_one" } });
    expect((await client.callTool({ name: "connect_facebook" })).structuredContent).toMatchObject({ status: 403, requiresUserAction: true });
  });

  it("uses the agent profile without a Clerk browser session", async () => {
    const client = await connect();
    const output = await client.callTool({ name: "get_user_profile" });
    expect(output.structuredContent).toMatchObject({ data: { name: "Owner", email: "owner@example.com" } });
    expect(mocks.currentUser).not.toHaveBeenCalled();
  });

  it("does not disclose another workspace's shared campaign report", async () => {
    mocks.campaignLookup.mockResolvedValue(null);
    const client = await connect();
    const output = await client.callTool({ name: "get_campaign_report", arguments: { id: "campaign_other" } });
    expect(output.structuredContent).toMatchObject({ status: 404 });
    expect(mocks.campaignLookup).toHaveBeenCalledWith({ where: { id: "campaign_other", workspaceId: "workspace_one", reportShareEnabled: true }, select: { reportShareSlug: true } });
  });

  it("has an explicit mapping for every authenticated product API", async () => {
    const files = await readdir("app/api", { recursive: true });
    const excluded = /^(cron\/|webhook\/|health\/|mcp\/|agent-keys\/)|^(instagram|facebook)\/callback\//;
    const paths = files.filter((f) => f.endsWith("route.ts") && !excluded.test(f)).map((f) => `/api/${f.replace(/\/route\.ts$/, "")}`);
    expect(paths.filter((p) => !AGENT_TOOLS.some((t) => t.path === p))).toEqual([]);
    expect(new Set(AGENT_TOOLS.map((t) => t.name)).size).toBe(AGENT_TOOLS.length);
    for (const tool of AGENT_TOOLS) {
      const route = await tool.load();
      expect(route[tool.method], tool.name).toBeTypeOf("function");
      expect(() => z.toJSONSchema(z.object(tool.input), { io: "input" })).not.toThrow();
    }
  });
});

describe("MCP credential and transport boundaries", () => {
  it.each([null, "application/json", "*/*", "application/*", "application/json; q=0.8", "application/json, text/event-stream"])(
    "discovers tools with ordinary JSON HTTP Accept headers: %s", async (accept) => {
      for (const token of [null, "write-key", "oat_valid"]) {
        const initialize = rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "discovery", version: "1" } }, token);
        if (accept === null) initialize.headers.delete("accept"); else initialize.headers.set("accept", accept);
        expect((await POST(initialize)).status).toBe(200);
        const request = rpc("tools/list", undefined, token);
        if (accept === null) request.headers.delete("accept"); else request.headers.set("accept", accept);
        const response = await POST(request);
        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toContain("application/json");
        expect((await response.json()).result.tools).toHaveLength(49);
      }
    });

  it.each(["text/plain", "text/event-stream", "application/json;q=0", "application/json;q=0, */*;q=1"])(
    "rejects clients that exclude JSON: %s", async (accept) => {
      const request = rpc("tools/list", undefined, null); request.headers.set("accept", accept);
      expect((await POST(request)).status).toBe(406);
      expect(mocks.accounts).not.toHaveBeenCalled();
    });

  it("validates every advertised input and output schema with a Draft 7 discovery validator", async () => {
    const body = await (await POST(rpc("tools/list", undefined, null))).json();
    const validator = new Ajv({ allErrors: true, logger: false });
    for (const tool of body.result.tools) {
      for (const schema of [tool.inputSchema, tool.outputSchema].filter(Boolean)) {
        expect(() => validator.compile(schema), tool.name).not.toThrow();
      }
    }
    const create = body.result.tools.find((tool: { name: string }) => tool.name === "create_campaign");
    const validate = validator.compile(create.inputSchema);
    expect(validate({ body: campaignBody })).toBe(true);
    expect(validate({ body: { name: "" } })).toBe(false);
  });

  it("preserves authentication and mutation protection with JSON-only discovery headers", async () => {
    const invalid = rpc("tools/list", undefined, "invalid"); invalid.headers.set("accept", "application/json");
    expect((await POST(invalid)).status).toBe(401);
    const mutation = rpc("tools/call", { name: "create_campaign", arguments: { body: campaignBody } }, null);
    mutation.headers.set("accept", "application/json");
    const output = await (await POST(mutation)).json();
    expect(output.result.isError).toBe(true);
    expect(output.result._meta["mcp/www_authenticate"]).toHaveLength(1);
    expect(mocks.createCampaign).not.toHaveBeenCalled();
  });

  it("rejects invalid keys even with a browser cookie", async () => {
    const request = rpc("tools/list", undefined, "invalid");
    request.headers.set("Cookie", "__session=browser-session");
    const response = await POST(request);
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain("Bearer");
    expect(mocks.accounts).not.toHaveBeenCalled();
  });

  it.each([
    { revoked: true }, { expired: true }, { expiration: Date.now() - 1000 },
    { claims: { workspaceId: "workspace_one" } }, { subject: "org_other" }, { scopes: [] },
  ])("rejects invalid credential properties: %j", async (properties) => {
    mocks.verify.mockResolvedValue({ ...key, ...properties });
    expect((await POST(rpc("tools/list"))).status).toBe(401);
  });

  it("fails closed when Clerk is unavailable and rejects foreign Origins", async () => {
    mocks.verify.mockRejectedValue(new Error("provider offline"));
    const unavailable = await POST(rpc("tools/list"));
    expect(unavailable.status).toBe(503);
    const request = rpc("tools/list"); request.headers.set("Origin", "https://evil.example");
    expect((await POST(request)).status).toBe(403);
    expect((await GET()).status).toBe(405); expect((await DELETE()).headers.get("Allow")).toBe("POST");
  });

  it("does not trust tool-provided identity, and isolates nested auth helpers", async () => {
    const context = { userId: "user_two", workspaceId: "workspace_two", role: "ADMIN" as const,
      workspace: { id: "workspace_two" } } as Awaited<ReturnType<typeof getCurrentWorkspaceContext>>;
    await agentContext.run(context!, async () => {
      expect(await getCurrentUserId()).toBe("user_two");
      expect(await getCurrentWorkspaceId()).toBe("workspace_two");
      expect(await getCurrentWorkspaceContext()).toBe(context);
    });
    expect(agentContext.getStore()).toBeUndefined();
  });

  it("limits payload size before parsing", async () => {
    const request = rpc("tools/list"); request.headers.set("Content-Length", String(4 * 1024 * 1024 + 1));
    expect((await POST(request)).status).toBe(413);
  });
});

describe("browser-only credential management", () => {
  it("creates a bounded credential without persisting or listing its secret", async () => {
    mocks.keyCreate.mockResolvedValue({ ...key, name: "Agent" });
    const request = new Request("http://localhost:3000/api/agent-keys", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Agent", access: "write", expiresInDays: 30 }) });
    const response = await keyRoutes.POST(request);
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ secret: "secret" });
    expect(mocks.keyCreate).toHaveBeenCalledWith(expect.objectContaining({ subject: "user_one", secondsUntilExpiration: 30 * 86400,
      claims: { purpose: "kult-mcp", workspaceId: "workspace_one" }, scopes: ["kult:read", "kult:write"] }));
    mocks.keyList.mockResolvedValue({ data: [{ ...key, name: "Agent" }, { ...key, claims: { purpose: "kult-mcp", workspaceId: "other" } }], totalCount: 2 });
    const listed = await (await keyRoutes.GET(new Request("http://localhost:3000/api/agent-keys"))).json();
    expect(listed.keys).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toContain("secret");
    expect(AGENT_TOOLS.some((t) => t.path.includes("agent-keys"))).toBe(false);
  });

  it("prevents revoking somebody else's or another workspace's key", async () => {
    mocks.keyGet.mockResolvedValue({ ...key, subject: "user_other" });
    const request = () => new Request("http://localhost:3000/api/agent-keys", { method: "DELETE", body: JSON.stringify({ id: key.id }) });
    expect((await keyRoutes.DELETE(request())).status).toBe(404);
    mocks.keyGet.mockResolvedValue({ ...key, claims: { purpose: "kult-mcp", workspaceId: "other" } });
    expect((await keyRoutes.DELETE(request())).status).toBe(404);
    expect(mocks.keyRevoke).not.toHaveBeenCalled();
    mocks.keyGet.mockResolvedValue(key);
    expect((await keyRoutes.DELETE(request())).status).toBe(200);
    expect(mocks.keyRevoke).toHaveBeenCalledWith(expect.objectContaining({ apiKeyId: key.id }));
    mocks.verify.mockResolvedValue({ ...key, revoked: true });
    expect((await POST(rpc("tools/list"))).status).toBe(401);
  });

  it("prevents invitation-based owner demotion", async () => {
    const { POST: invite } = await import("@/app/api/workspace/members/route");
    const response = await invite(new NextRequest("http://localhost:3000/api/workspace/members", { method: "POST",
      body: JSON.stringify({ email: "owner@example.com", role: "MEMBER" }) }));
    expect(response.status).toBe(400);
    expect(mocks.memberUpsert).not.toHaveBeenCalled();
  });

  it("rejects cross-site credential creation", async () => {
    const response = await keyRoutes.POST(new Request("http://localhost:3000/api/agent-keys", { method: "POST", headers: { Origin: "https://evil.example" } }));
    expect(response.status).toBe(403);
    expect(mocks.keyCreate).not.toHaveBeenCalled();
  });
});

describe("ChatGPT OAuth account connection", () => {
  it("advertises native ChatGPT attachment inputs with the exact fileParams schema", async () => {
    const body = await (await POST(rpc("tools/list", undefined, null))).json();
    const file = body.result.tools.find((t: { name: string }) => t.name === "upload_media_file");
    expect(file._meta["openai/fileParams"]).toEqual(["file"]);
    expect(file.inputSchema.properties.file.required).toEqual(["download_url", "file_id"]);
    expect(Object.keys(file.inputSchema.properties.file.properties).sort()).toEqual(["download_url", "file_id", "file_name", "mime_type"]);
    expect(file.securitySchemes[0].type).toBe("oauth2");
    expect(file.annotations).toMatchObject({ readOnlyHint: false, idempotentHint: false });
    expect(file.outputSchema.properties.uploaded.const).toBe(true);
  });

  it("stores actual bytes from a JSON MCP request over 1 MB in the authenticated workspace", async () => {
    const bytes = Buffer.concat([Buffer.from([255, 216, 255]), Buffer.alloc(2 * 1024 ** 2, 123)]);
    const args = { platform: "INSTAGRAM", kind: "IMAGE", contentType: "image/jpeg", dataBase64: bytes.toString("base64") };
    const request = rpc("tools/call", { name: "upload_media_bytes", arguments: args });
    request.headers.set("Accept", "application/json");
    const response = await POST(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result.isError).toBe(false);
    expect(body.result.structuredContent).toMatchObject({ uploaded: true, size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"), mediaUrl: expect.stringContaining("/scheduler/workspace_one/") });
    expect(mocks.storeMedia).toHaveBeenCalledWith("workspace_one", "image/jpeg", expect.anything(), bytes.length, expect.any(AbortSignal), bytes.length);
    expect(JSON.stringify(body)).not.toContain(args.dataBase64);
  });

  it("rejects read-only and anonymous uploads before storing or fetching file bytes", async () => {
    const args = { platform: "FACEBOOK", kind: "IMAGE", contentType: "image/jpeg", dataBase64: "/9j/" };
    const read = await connect("read-key");
    expect((await read.listTools()).tools.some(t => t.name.startsWith("upload_media_"))).toBe(false);
    expect((await read.callTool({ name: "upload_media_bytes", arguments: args })).isError).toBe(true);
    const body = await (await POST(rpc("tools/call", { name: "upload_media_bytes", arguments: args }, null))).json();
    expect(body.result._meta["mcp/www_authenticate"]).toHaveLength(1);
    expect(mocks.storeMedia).not.toHaveBeenCalled();
  });

  it("lets an anonymous SDK client initialize and discover all protected tools without accessing account data", async () => {
    const client = await connect(null);
    const tools = (await client.listTools()).tools;
    expect(tools).toHaveLength(49);
    expect(tools.some((tool) => tool.name === "create_campaign")).toBe(true);
    expect(tools.every((tool) => (tool._meta?.securitySchemes as { type: string }[])[0].type === "oauth2")).toBe(true);
    const response = await POST(rpc("tools/list", undefined, null));
    const body = await response.json();
    expect(body.result.tools.every((tool: { securitySchemes: { type: string }[] }) => tool.securitySchemes[0].type === "oauth2")).toBe(true);
    expect((await client.readResource({ uri: "kult://guide" })).contents[0]).toHaveProperty("text");
    expect(mocks.verify).not.toHaveBeenCalled();
    expect(mocks.oauthVerify).not.toHaveBeenCalled();
    expect(mocks.membership).not.toHaveBeenCalled();
    expect(mocks.user).not.toHaveBeenCalled();
  });

  it.each([
    { name: "get_workspace" }, { name: "get_connected_profile" },
    { name: "list_campaign_templates" }, { name: "get_publishing_capabilities" },
    { name: "list_instagram_accounts" }, { name: "connect_instagram" },
    { name: "create_campaign", arguments: { body: campaignBody } },
  ])("prompts anonymous callers to link OAuth before $name, including callers with browser cookies", async (params) => {
    const request = rpc("tools/call", params, null);
    request.headers.set("Cookie", "__session=browser-session");
    const response = await POST(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result.isError).toBe(true);
    expect(body.result.structuredContent).toMatchObject({ status: 401 });
    expect(body.result._meta["mcp/www_authenticate"]).toEqual([
      expect.stringContaining('resource_metadata="http://localhost:3000/.well-known/oauth-protected-resource/api/mcp"'),
    ]);
    expect(mocks.clerkAuth).not.toHaveBeenCalled();
    expect(mocks.verify).not.toHaveBeenCalled();
    expect(mocks.oauthVerify).not.toHaveBeenCalled();
    expect(mocks.membership).not.toHaveBeenCalled();
    expect(mocks.user).not.toHaveBeenCalled();
    expect(mocks.accounts).not.toHaveBeenCalled();
    expect(mocks.createCampaign).not.toHaveBeenCalled();
  });

  it("publishes public canonical resource discovery with browser-readable metadata", async () => {
    const root = await import("@/app/.well-known/oauth-protected-resource/route");
    const path = await import("@/app/.well-known/oauth-protected-resource/api/mcp/route");
    for (const handler of [root.GET, path.GET]) {
      const response = await handler();
      expect(response.status).toBe(200);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
      expect(await response.json()).toMatchObject({ resource: "http://localhost:3000/api/mcp",
        authorization_servers: ["https://kult.clerk.accounts.dev"], scopes_supported: ["kult:read", "kult:write"] });
    }
    expect(root.OPTIONS().status).toBe(204);
    const request = rpc("tools/call", { name: "get_workspace" }, null);
    const response = await POST(request);
    expect((await response.json()).result._meta["mcp/www_authenticate"][0]).toContain('resource_metadata="http://localhost:3000/.well-known/oauth-protected-resource/api/mcp"');
    expect(mocks.clerkAuth).not.toHaveBeenCalled();
  });

  it("calls product tools with OAuth and emits accurate OpenAI security and profile metadata", async () => {
    const client = await connect("oat_valid");
    expect((await client.callTool({ name: "create_campaign", arguments: { body: campaignBody } })).isError).toBe(false);
    expect(mocks.oauthVerify).toHaveBeenCalledWith("oat_valid");
    expect(mocks.verify).not.toHaveBeenCalled();
    const response = await POST(rpc("tools/list", undefined, "oat_valid"));
    const body = await response.json();
    const read = body.result.tools.find((t: { name: string }) => t.name === "get_workspace");
    const write = body.result.tools.find((t: { name: string }) => t.name === "create_campaign");
    expect(read.securitySchemes).toEqual([{ type: "oauth2", scopes: ["kult:read"] }]);
    expect(write.securitySchemes).toEqual([{ type: "oauth2", scopes: ["kult:read", "kult:write"] }]);
    expect(write._meta.securitySchemes).toEqual(write.securitySchemes);
    expect(write.annotations.readOnlyHint).toBe(false);
    const profileTool = body.result.tools.find((t: { name: string }) => t.name === "get_connected_profile");
    expect(profileTool._meta["openai/profile"]).toBe(true);
    expect(profileTool.inputSchema.additionalProperties).toBe(false);
    expect(profileTool.outputSchema.additionalProperties).toBe(false);
    expect(profileTool.outputSchema.required).toEqual(["id"]);
    const first = await client.callTool({ name: "get_connected_profile" });
    expect(first.structuredContent).toEqual({ id: "user_one", name: "Owner", email: "owner@example.com", nickname: "Kult" });
    mocks.user.mockResolvedValue({ name: "Renamed owner", email: "new@example.com" });
    const reconnected = await connect("oat_refreshed");
    expect((await reconnected.callTool({ name: "get_connected_profile" })).structuredContent).toMatchObject({ id: "user_one", name: "Renamed owner" });
  });

  it("uses live existing membership and never creates a workspace through OAuth", async () => {
    await connect("oat_valid");
    expect(mocks.membership).toHaveBeenCalledWith({ where: { userId: "user_one" }, include: { workspace: true }, orderBy: { createdAt: "asc" } });
    mocks.membership.mockResolvedValue(null);
    expect((await POST(rpc("tools/list", undefined, "oat_valid"))).status).toBe(403);
    expect(mocks.user).not.toHaveBeenCalled();
  });

  it.each([{ clientId: "another_app" }, { subject: "org_other" }, { revoked: true }, { expired: true },
    { expiration: Math.floor(Date.now() / 1000) - 1 }, { expiration: null }, { expiration: undefined },
    { expiration: NaN }, { expiration: Infinity }])("rejects invalid OAuth properties %j", async (properties) => {
    const good = await mocks.oauthVerify();
    mocks.oauthVerify.mockResolvedValue({ ...good, ...properties });
    expect((await POST(rpc("tools/list", undefined, "oat_invalid"))).status).toBe(401);
    expect(mocks.verify).not.toHaveBeenCalled();
    expect(mocks.membership).not.toHaveBeenCalled();
  });

  it("enforces read scopes and excludes write tools for a read-only consent", async () => {
    const good = await mocks.oauthVerify();
    mocks.oauthVerify.mockResolvedValue({ ...good, scopes: ["profile", "email"] });
    const response = await POST(rpc("tools/list", undefined, "oat_valid"));
    expect(response.status).toBe(403);
    expect(response.headers.get("WWW-Authenticate")).toContain('error="insufficient_scope"');
    mocks.oauthVerify.mockResolvedValue({ ...good, scopes: ["kult:read"] });
    const client = await connect("oat_read");
    expect((await client.listTools()).tools.some((t) => t.name === "create_campaign")).toBe(false);
    expect((await client.callTool({ name: "create_campaign", arguments: { body: campaignBody } })).isError).toBe(true);
    expect(mocks.createCampaign).not.toHaveBeenCalled();
  });

  it("fails closed on misconfiguration and provider failures without API key fallback", async () => {
    vi.stubEnv("MCP_OAUTH_CLIENT_ID", "");
    expect((await POST(rpc("tools/list", undefined, "oat_valid"))).status).toBe(503);
    expect(mocks.oauthVerify).not.toHaveBeenCalled();
    expect((await POST(rpc("tools/list"))).status).toBe(200);
    mocks.verify.mockClear();
    const { GET: metadata } = await import("@/app/.well-known/oauth-protected-resource/route");
    expect((await metadata()).status).toBe(503);
    vi.stubEnv("MCP_OAUTH_CLIENT_ID", "chatgpt_kult");
    mocks.oauthVerify.mockRejectedValue({ status: 404 });
    expect((await POST(rpc("tools/list", undefined, "oat_unknown"))).status).toBe(401);
    mocks.oauthVerify.mockRejectedValue(new Error("provider offline"));
    expect((await POST(rpc("tools/list", undefined, "oat_unknown"))).status).toBe(503);
    expect(mocks.verify).not.toHaveBeenCalled();
  });

  function jwt(properties: Record<string, unknown> = {}) {
    return `${Buffer.from(JSON.stringify({ typ: "at+jwt", alg: "RS256" })).toString("base64url")}.${Buffer.from(JSON.stringify({
      iss: "https://kult.clerk.accounts.dev", aud: "http://localhost:3000/api/mcp", exp: Math.floor(Date.now() / 1000) + 3600,
      ...properties,
    })).toString("base64url")}.provider-verified-signature`;
  }
  it("accepts Clerk's OAuth Unix-second expiry through initialization, tool discovery and profile calls", async () => {
    vi.stubEnv("MCP_OAUTH_SCOPE_MODE", "clerk");
    vi.stubEnv("MCP_OAUTH_WRITE_ENABLED", "true");
    const now = Math.floor(Date.now() / 1000);
    mocks.oauthVerify.mockResolvedValue({ clientId: "chatgpt_kult", subject: "user_one",
      scopes: ["openid", "profile", "email", "offline_access"], revoked: false, expired: false,
      expiration: now + 86400 });
    const token = jwt();
    const client = await connect(token);
    expect((await client.listTools()).tools).toHaveLength(49);
    expect((await client.callTool({ name: "get_connected_profile" })).structuredContent).toMatchObject({ id: "user_one" });
    expect((await client.callTool({ name: "get_workspace" })).structuredContent).toMatchObject({ scopes: ["kult:read", "kult:write"] });
    // The same provider response expires at the Unix-second boundary even if
    // Clerk's expired flag has not caught up. JWT exp is independently checked.
    mocks.oauthVerify.mockResolvedValue({ clientId: "chatgpt_kult", subject: "user_one",
      scopes: ["profile", "email"], revoked: false, expired: false, expiration: now });
    expect((await POST(rpc("tools/list", undefined, token))).status).toBe(401);
  });
  it("requires trusted introspection before using JWT claims and accepts the bound resource", async () => {
    expect((await POST(rpc("tools/list", undefined, jwt()))).status).toBe(200);
    mocks.oauthVerify.mockRejectedValue({ status: 401 });
    expect((await POST(rpc("tools/list", undefined, jwt()))).status).toBe(401);
    expect(mocks.verify).not.toHaveBeenCalled();
  });
  it.each([{ aud: "other-resource" }, { aud: "chatgpt_kult" }, { aud: undefined },
    { iss: "https://other.clerk.accounts.dev" }, { exp: 0 }, { nbf: Math.floor(Date.now() / 1000) + 3600 }])(
    "rejects resource-bound JWTs with invalid issuer/audience/lifetime %j", async (properties) => {
      expect((await POST(rpc("tools/list", undefined, jwt(properties)))).status).toBe(401);
      expect(mocks.membership).not.toHaveBeenCalled();
    });
  it("supports Clerk account linking with an explicit resource-bound write grant", async () => {
    vi.stubEnv("MCP_OAUTH_SCOPE_MODE", "clerk");
    vi.stubEnv("MCP_OAUTH_WRITE_ENABLED", "true");
    const good = await mocks.oauthVerify();
    mocks.oauthVerify.mockResolvedValue({ ...good, scopes: ["openid", "profile", "email", "offline_access"] });
    const client = await connect(jwt());
    expect((await client.callTool({ name: "get_workspace" })).structuredContent).toMatchObject({ scopes: ["kult:read", "kult:write"] });
    const response = await POST(rpc("tools/list", undefined, jwt()));
    const body = await response.json();
    expect(body.result.tools.find((t: { name: string }) => t.name === "create_campaign").securitySchemes)
      .toEqual([{ type: "oauth2", scopes: ["profile", "email"] }]);
    expect((await client.callTool({ name: "create_campaign", arguments: { body: campaignBody } })).isError).toBe(false);
    mocks.membership.mockResolvedValue({ userId: "user_one", workspaceId: "workspace_one", role: "MEMBER", workspace: { id: "workspace_one" } });
    expect((await client.callTool({ name: "create_campaign", arguments: { body: campaignBody } })).structuredContent).toMatchObject({ status: 403 });
  });

  it("does not infer product writes from provider scopes or unbound opaque tokens", async () => {
    vi.stubEnv("MCP_OAUTH_SCOPE_MODE", "clerk");
    const good = await mocks.oauthVerify();
    mocks.oauthVerify.mockResolvedValue({ ...good, scopes: ["profile", "email", "kult:write"] });
    const client = await connect(jwt());
    expect((await client.listTools()).tools.some((t) => t.name === "create_campaign")).toBe(false);
    expect((await POST(rpc("tools/list", undefined, "oat_unbound"))).status).toBe(401);
    vi.stubEnv("MCP_OAUTH_WRITE_ENABLED", "true");
    expect((await POST(rpc("tools/list", undefined, jwt({ aud: "another_api" })))).status).toBe(401);
    mocks.oauthVerify.mockResolvedValue({ ...good, clientId: "another_client", scopes: ["profile", "email"] });
    expect((await POST(rpc("tools/list", undefined, jwt()))).status).toBe(401);
    expect(mocks.createCampaign).not.toHaveBeenCalled();
  });

  it("publishes supported Clerk account scopes and rejects incomplete account consent", async () => {
    vi.stubEnv("MCP_OAUTH_SCOPE_MODE", "clerk");
    const { GET: metadata } = await import("@/app/.well-known/oauth-protected-resource/route");
    expect(await (await metadata()).json()).toMatchObject({ scopes_supported: ["profile", "email"] });
    const good = await mocks.oauthVerify();
    mocks.oauthVerify.mockResolvedValue({ ...good, scopes: ["profile"] });
    const response = await POST(rpc("tools/list", undefined, jwt()));
    expect(response.status).toBe(403);
    expect(response.headers.get("WWW-Authenticate")).toContain('scope="openid profile email offline_access"');
    vi.stubEnv("MCP_OAUTH_SCOPE_MODE", "unknown");
    expect((await POST(rpc("tools/list", undefined, jwt()))).status).toBe(503);
  });

});
