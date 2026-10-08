import { getBaseUrl } from "@/lib/env";
import { AgentAuthError, READ_SCOPE, WRITE_SCOPE } from "./credentials";

// Use a dedicated, predefined Clerk OAuth client for this resource. The client
// is pinned on the resource server; enabling dynamic registration cannot widen
// the set of tokens accepted here.
export function getOAuthConfig() {
  const clientId = process.env.MCP_OAUTH_CLIENT_ID;
  const configuredIssuer = process.env.MCP_OAUTH_ISSUER;
  if (!clientId || !configuredIssuer)
    throw new AgentAuthError("ChatGPT connection is not configured. Contact the Kult administrator.", 503);
  let issuer;
  try { issuer = new URL(configuredIssuer); }
  catch { throw new AgentAuthError("ChatGPT authentication configuration is invalid.", 503); }
  if (issuer.protocol !== "https:" || issuer.username || issuer.password || issuer.search || issuer.hash || issuer.pathname !== "/")
    throw new AgentAuthError("ChatGPT authentication configuration is invalid.", 503);
  const scopeMode = oauthScopeMode();
  return { clientId, issuer: issuer.origin, scopeMode, writeEnabled: process.env.MCP_OAUTH_WRITE_ENABLED === "true" };
}

// Explicit compatibility mode for Clerk instances whose public API only accepts
// OIDC account-linking scopes. Product permissions remain a server-owned grant
// to the dedicated, resource-bound client, never inferred from profile/email.
export function oauthScopeMode() {
  const mode = process.env.MCP_OAUTH_SCOPE_MODE ?? "custom";
  if (mode !== "custom" && mode !== "clerk")
    throw new AgentAuthError("ChatGPT scope configuration is invalid.", 503);
  return mode;
}
export function oauthToolScopes(write: boolean) {
  return oauthScopeMode() === "clerk" ? ["profile", "email"] : write ? [READ_SCOPE, WRITE_SCOPE] : [READ_SCOPE];
}

export function resourceUrl() { return new URL("/api/mcp", getBaseUrl()).href; }
export function metadataUrl() { return new URL("/.well-known/oauth-protected-resource/api/mcp", getBaseUrl()).href; }
export function authChallenge(error = "invalid_token", scope?: string) {
  const mode = process.env.MCP_OAUTH_SCOPE_MODE;
  scope ??= mode === "clerk" ? "openid profile email offline_access" : `${READ_SCOPE} ${WRITE_SCOPE} offline_access`;
  return `Bearer resource_metadata="${metadataUrl()}", scope="${scope}", error="${error}", error_description="Connect your Kult account to continue"`;
}

export async function protectedResourceMetadata() {
  try {
    const { issuer } = getOAuthConfig();
    return Response.json({ resource: resourceUrl(), authorization_servers: [issuer],
      scopes_supported: oauthToolScopes(true), bearer_methods_supported: ["header"], resource_name: "Kult" },
      { headers: metadataHeaders });
  } catch {
    return Response.json({ error: "ChatGPT OAuth is not configured." }, { status: 503, headers: metadataHeaders });
  }
}

const metadataHeaders = { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" };
export function metadataOptions() {
  return new Response(null, { status: 204, headers: { ...metadataHeaders,
    "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" } });
}
