import { clerkClient } from "@clerk/nextjs/server";
import { z } from "zod";
import { getOAuthConfig, oauthToolScopes, resourceUrl } from "./oauth";
import { prisma } from "@/lib/db/client";
import type { WorkspaceContext } from "@/lib/workspace-access";

import { AgentAuthError, READ_SCOPE, WRITE_SCOPE } from "./credentials";
export { AgentAuthError, READ_SCOPE, WRITE_SCOPE } from "./credentials";
export const agentClaims = z.object({
  purpose: z.literal("kult-mcp"),
  workspaceId: z.string().min(1),
});
export type AgentIdentity = { userId: string; workspaceId: string; scopes: string[] };

export async function resolveAgentWorkspace(identity: AgentIdentity): Promise<WorkspaceContext> {
  const membership = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: identity.workspaceId, userId: identity.userId } },
    include: { workspace: true },
  });
  if (!membership) throw new AgentAuthError("Workspace access has been removed.", 403);
  return { userId: identity.userId, workspaceId: membership.workspaceId,
    workspace: membership.workspace, role: membership.role };
}

export async function authenticateAgent(request: Request): Promise<AgentIdentity> {
  const token = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
  if (!token || token.length > 4096) throw new AgentAuthError("Connect your Kult account or provide an agent key.", 401);
  // Clerk opaque OAuth access tokens and JWTs go only to OAuth verification;
  // they can never fall back to API-key verification. Browser sessions are not OAuth.
  if (token.startsWith("oat_") || token.split(".").length === 3) return authenticateOAuth(token);
  let key;
  try {
    const client = await clerkClient();
    key = await client.apiKeys.verify(token);
  } catch (error) {
    const status = (error as { status?: number })?.status;
    if (status && status >= 400 && status < 500 && status !== 429)
      throw new AgentAuthError("The agent API key is invalid, expired, or revoked.", 401);
    throw new AgentAuthError("Agent authentication is temporarily unavailable.", 503);
  }
  const claims = agentClaims.safeParse(key.claims);
  if (!claims.success || !key.subject.startsWith("user_") || key.revoked || key.expired ||
      (key.expiration !== null && key.expiration <= Date.now()) || !key.scopes.includes(READ_SCOPE))
    throw new AgentAuthError("The key is not a valid Kult agent credential.", 401);
  const identity = { userId: key.subject, workspaceId: claims.data.workspaceId, scopes: key.scopes };
  await resolveAgentWorkspace(identity);
  return identity;
}

async function authenticateOAuth(token: string): Promise<AgentIdentity> {
  const config = getOAuthConfig();
  let access;
  try {
    // Clerk introspection verifies authenticity and provider-reported status.
    // JWT grants cannot be instantly revoked; live workspace checks still apply.
    access = await (await clerkClient()).idPOAuthAccessToken.verify(token);
  } catch (error) {
    const status = (error as { status?: number })?.status;
    if (status && status >= 400 && status < 500 && status !== 429)
      throw new AgentAuthError("The OAuth access token is invalid, expired, or revoked.", 401);
    throw new AgentAuthError("Account authentication is temporarily unavailable.", 503);
  }
  // OAuth introspection uses Unix seconds (unlike Clerk API-key expiry).
  if (access.clientId !== config.clientId || !access.subject.startsWith("user_") ||
      access.revoked || access.expired || typeof access.expiration !== "number" || !Number.isFinite(access.expiration) || access.expiration * 1000 <= Date.now())
    throw new AgentAuthError("The OAuth token is not valid for Kult MCP.", 401);
  const requiredScopes = oauthToolScopes(false);
  if (!requiredScopes.every((scope) => access.scopes.includes(scope)))
    throw new AgentAuthError("Reconnect Kult with the required account permissions.", 403, "insufficient_scope");
  // Account-linking scopes cannot bind opaque tokens to a resource audience.
  // Compatibility mode requires an audience-bearing JWT, verified by Clerk.
  if (config.scopeMode === "clerk" && token.split(".").length !== 3)
    throw new AgentAuthError("Kult requires a resource-bound OAuth JWT. Reconnect your account.", 401);
  if (token.split(".").length === 3) {
    // Introspection above establishes authenticity. Resource-bound JWTs must
    // also name our issuer and this resource as audience, never the client ID.
    try {
      const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
      const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
      if (claims.iss !== config.issuer || !audiences.includes(resourceUrl()) ||
          typeof claims.exp !== "number" || claims.exp * 1000 <= Date.now() ||
          (claims.nbf !== undefined && (typeof claims.nbf !== "number" || claims.nbf * 1000 > Date.now())))
        throw new Error("Invalid resource binding");
    } catch { throw new AgentAuthError("The OAuth token has an invalid issuer, audience, or lifetime.", 401); }
  }
  // Opaque tokens are bound through trusted introspection to the dedicated
  // OAuth application's client ID. Never reuse that application for another API.
  // Use the same earliest workspace as the browser; no agent-supplied IDs.
  const membership = await prisma.workspaceMember.findFirst({ where: { userId: access.subject },
    include: { workspace: true }, orderBy: { createdAt: "asc" } });
  if (!membership) throw new AgentAuthError("Sign in to Kult and join a workspace before connecting ChatGPT.", 403);
  const scopes = config.scopeMode === "clerk"
    ? [READ_SCOPE, ...(config.writeEnabled ? [WRITE_SCOPE] : [])]
    : access.scopes;
  return { userId: access.subject, workspaceId: membership.workspaceId, scopes };
}
