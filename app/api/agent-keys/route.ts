import { clerkClient } from "@clerk/nextjs/server";
import { z } from "zod";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { agentClaims, READ_SCOPE, WRITE_SCOPE } from "@/lib/mcp/auth";

export const dynamic = "force-dynamic";
const createSchema = z.object({
  name: z.string().trim().min(1).max(80), access: z.enum(["read", "write"]),
  expiresInDays: z.number().int().min(1).max(365).default(90),
}).strict();
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return (!origin || origin === new URL(request.url).origin) && request.headers.get("sec-fetch-site") !== "cross-site";
}

// Credential management is browser-authenticated and is deliberately absent
// from the MCP tool allowlist: an agent cannot mint more credentials.
export async function GET(request: Request) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return reply({ error: "Unauthorized" }, 401);
  const offset = z.coerce.number().int().min(0).safeParse(new URL(request.url).searchParams.get("offset") ?? 0);
  if (!offset.success) return reply({ error: "Invalid offset" }, 400);
  try {
    const client = await clerkClient();
    const keys = await client.apiKeys.list({ subject: context.userId, limit: 100, offset: offset.data, includeInvalid: true });
    return reply({ keys: keys.data.filter((key) => {
      const claims = agentClaims.safeParse(key.claims);
      return claims.success && claims.data.workspaceId === context.workspaceId;
    }).map((key) => ({ id: key.id, name: key.name, scopes: key.scopes, createdAt: key.createdAt,
      expiration: key.expiration, revoked: key.revoked, expired: key.expired, lastUsedAt: key.lastUsedAt })),
      nextOffset: offset.data + keys.data.length < keys.totalCount ? offset.data + keys.data.length : null });
  } catch { return reply({ error: "Unable to load agent keys. Enable API keys in your Clerk instance and check its availability." }, 503); }
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return reply({ error: "Origin is not allowed" }, 403);
  const context = await getCurrentWorkspaceContext();
  if (!context) return reply({ error: "Unauthorized" }, 401);
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return reply({ error: "Enter a name, access level and expiration of 1–365 days." }, 400);
  try {
    const client = await clerkClient();
    const key = await client.apiKeys.create({ subject: context.userId, createdBy: context.userId,
      name: parsed.data.name, scopes: parsed.data.access === "write" ? [READ_SCOPE, WRITE_SCOPE] : [READ_SCOPE],
      claims: { purpose: "kult-mcp", workspaceId: context.workspaceId },
      secondsUntilExpiration: parsed.data.expiresInDays * 86400 });
    const secret = key.secret ?? (await client.apiKeys.getSecret(key.id)).secret;
    return reply({ id: key.id, secret, name: key.name, expiration: key.expiration }, 201);
  } catch { return reply({ error: "Unable to create an agent key. Enable API keys in your Clerk instance and try again." }, 503); }
}

export async function DELETE(request: Request) {
  if (!isSameOrigin(request)) return reply({ error: "Origin is not allowed" }, 403);
  const context = await getCurrentWorkspaceContext();
  if (!context) return reply({ error: "Unauthorized" }, 401);
  const parsed = z.object({ id: z.string().min(1).max(200) }).strict().safeParse(await request.json().catch(() => null));
  if (!parsed.success) return reply({ error: "Missing key ID" }, 400);
  try {
    const client = await clerkClient();
    const key = await client.apiKeys.get(parsed.data.id);
    const claims = agentClaims.safeParse(key.claims);
    if (key.subject !== context.userId || !claims.success || claims.data.workspaceId !== context.workspaceId)
      return reply({ error: "Key not found" }, 404);
    await client.apiKeys.revoke({ apiKeyId: key.id, revocationReason: "Revoked in Kult agent settings" });
    return reply({ success: true });
  } catch { return reply({ error: "Unable to revoke the agent key." }, 503); }
}
