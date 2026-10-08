import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { authenticateAgent, AgentAuthError } from "@/lib/mcp/auth";
import { createAgentServer } from "@/lib/mcp/server";
import { authChallenge } from "@/lib/mcp/oauth";
import { getBaseUrl } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
    const server = createAgentServer(identity, getBaseUrl());
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined, enableJsonResponse: true, maxRequestBodySize: 1024 * 1024,
    });
    try {
      await server.connect(transport);
      const response = await transport.handleRequest(request);
      response.headers.set("Cache-Control", "private, no-store");
      return response;
    } finally {
      await server.close();
    }
  } catch (error) {
    const status = error instanceof AgentAuthError ? error.status : 500;
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
