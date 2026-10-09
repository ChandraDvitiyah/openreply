import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { authenticateAgent, AgentAuthError } from "@/lib/mcp/auth";
import { createAgentServer } from "@/lib/mcp/server";
import { authChallenge } from "@/lib/mcp/oauth";
import { getBaseUrl } from "@/lib/env";
import { MAX_MCP_REQUEST_BYTES } from "@/lib/mcp/media-upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function acceptsJson(request: Request) {
  const accept = request.headers.get("accept");
  if (!accept) return true;
  const ranges = accept.split(",").map((entry) => {
    const [type, ...parameters] = entry.trim().toLowerCase().split(";");
    const quality = parameters.find((parameter) => parameter.trim().startsWith("q="));
    return { type: type.trim(), q: quality ? Number(quality.trim().slice(2)) : 1 };
  });
  for (const type of ["application/json", "application/*", "*/*"]) {
    const matches = ranges.filter((range) => range.type === type);
    if (matches.length) return matches.some((range) => Number.isFinite(range.q) && range.q > 0 && range.q <= 1);
  }
  return false;
}

function logFailure(request: Request, phase: "authentication" | "transport", status: number, reason?: string) {
  // Only protocol headers and a controlled error message; never tokens, cookies,
  // request bodies, tool arguments, workspace identity or provider responses.
  console.warn("[Kult MCP] Request rejected", { phase, status, reason,
    accept: request.headers.get("accept")?.slice(0, 200) ?? null,
    protocolVersion: request.headers.get("mcp-protocol-version")?.slice(0, 40) ?? null });
}

export async function POST(request: Request) {
  // Validate supplied Origin even for authenticated clients. Native agents
  // normally omit Origin. No wildcard CORS or browser-session auth here.
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(getBaseUrl()).origin)
    return Response.json({ error: "Origin is not allowed." }, { status: 403 });
  try {
    // ChatGPT discovers the protocol and OAuth-protected tool catalogue before
    // account linking. Supplied credentials still fail closed; anonymous tool
    // calls are gated by the server and return a tool-level OAuth challenge.
    const identity = request.headers.has("authorization") ? await authenticateAgent(request) : null;
    // This endpoint always returns JSON. The SDK additionally requires an SSE
    // Accept value even with enableJsonResponse. Adapt JSON/wildcard clients
    // without changing their body, credentials or the response media type.
    if (!acceptsJson(request)) {
      logFailure(request, "transport", 406, "The client does not accept JSON.");
      return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32000,
        message: "Not Acceptable: Client must accept application/json" } }, { status: 406 });
    }
    const headers = new Headers(request.headers);
    headers.set("accept", "application/json, text/event-stream");
    const transportRequest = new Request(request, { headers });
    const server = createAgentServer(identity, getBaseUrl());
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined, enableJsonResponse: true, maxRequestBodySize: MAX_MCP_REQUEST_BYTES,
    });
    try {
      await server.connect(transport);
      const response = await transport.handleRequest(transportRequest);
      if (response.status >= 400) logFailure(request, "transport", response.status);
      response.headers.set("Cache-Control", "private, no-store");
      return response;
    } finally {
      await server.close();
    }
  } catch (error) {
    const status = error instanceof AgentAuthError ? error.status : 500;
    logFailure(request, "authentication", status, error instanceof AgentAuthError ? error.message : "MCP request failed.");
    return Response.json({ error: error instanceof AgentAuthError ? error.message : "MCP request failed." }, {
      status, headers: { "Cache-Control": "no-store", ...(status === 401 || (error instanceof AgentAuthError && error.challenge) ? { "WWW-Authenticate": authChallenge(error instanceof AgentAuthError && error.challenge ? error.challenge : "invalid_token") } : {}) },
    });
  }
}

// Stateless transport has no persistent SSE session to open or terminate.
function methodNotAllowed() {
  return Response.json({ error: "Use POST for the stateless MCP endpoint." }, { status: 405, headers: { Allow: "POST" } });
}
export const GET = methodNotAllowed;
export const DELETE = methodNotAllowed;
