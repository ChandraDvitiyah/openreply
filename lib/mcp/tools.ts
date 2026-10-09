import { z } from "zod";
import { NextRequest } from "next/server";
import { createAutomationSchema, updateAutomationSchema } from "@/lib/automations/validation";
import { importSchema } from "@/lib/automations/import-validation";
import { facebookAutomationSchema } from "@/lib/automations/facebook-validation";
import { postInputSchema, mutationSchema } from "@/lib/scheduler/validation";
import { postKinds } from "@/lib/scheduler/capabilities";

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
type RouteModule = Partial<Record<Method, (request: NextRequest,
  context: { params: Promise<{ id: string }> }) => Promise<Response>>>;
export type AgentTool = {
  name: string;
  description: string;
  method: Method;
  path: string;
  input: z.ZodRawShape;
  load: () => Promise<RouteModule>;
  destructive?: boolean;
  write?: boolean;
};
const id = z.string().min(1).max(300);
const accountQuery = z.object({ instagramAccountId: id.optional() }).strict();
const days = z.number().int().min(1).max(90).optional();
const webUrl = z.url().refine((s) => ["http:", "https:"].includes(new URL(s).protocol), "Use an HTTP(S) URL.");

// This explicit allowlist is the complete product API surface. Agents cannot
// supply arbitrary routes, server URLs, cookies, identity headers or methods.
export const AGENT_TOOLS: AgentTool[] = [
  { name: "list_instagram_accounts", description: "List connected Instagram accounts and their IDs.", method: "GET", path: "/api/instagram/accounts", input: {}, load: () => import("@/app/api/instagram/accounts/route") },
  { name: "get_instagram_profile", description: "Read profile and connection details for an Instagram account.", method: "GET", path: "/api/instagram/profile", input: { query: accountQuery.optional() }, load: () => import("@/app/api/instagram/profile/route") },
  { name: "list_instagram_posts", description: "List Instagram posts for campaign targeting. Set all=true to load all available posts.", method: "GET", path: "/api/instagram/posts", input: { query: accountQuery.extend({ all: z.boolean().optional(), limit: z.number().int().min(1).max(100).optional() }).optional() }, load: () => import("@/app/api/instagram/posts/route") },
  { name: "list_facebook_pages", description: "List connected Facebook Pages and their IDs.", method: "GET", path: "/api/facebook/pages", input: {}, load: () => import("@/app/api/facebook/pages/route") },
  { name: "connect_instagram", description: "Prepare an Instagram consent URL. Meta requires the account owner to authorize a new connection; returns requiresUserAction and does not claim completion.", method: "GET", path: "/api/instagram/connect", input: {}, load: () => import("@/app/api/instagram/connect/route") },
  { name: "connect_facebook", description: "Prepare a Facebook consent URL. Meta requires the account owner to authorize a new connection; returns requiresUserAction.", method: "GET", path: "/api/facebook/connect", input: {}, load: () => import("@/app/api/facebook/connect/route") },
  { name: "disconnect_instagram", description: "Disconnect one Instagram account. Specify the internal account ID explicitly. Owner/admin only.", method: "POST", path: "/api/instagram/disconnect", input: { body: z.object({ instagramAccountId: id }).strict() }, destructive: true, load: () => import("@/app/api/instagram/disconnect/route") },
  { name: "disconnect_facebook", description: "Disconnect one Facebook Page. Owner/admin only.", method: "POST", path: "/api/facebook/disconnect", input: { body: z.object({ facebookPageId: id }).strict() }, destructive: true, load: () => import("@/app/api/facebook/disconnect/route") },
  { name: "list_campaigns", description: "List Instagram campaigns with delivery analytics, tracked links, and shareable reports. Filter by id for one campaign.", method: "GET", path: "/api/automations", input: { query: accountQuery.extend({ id: id.optional() }).optional() }, load: () => import("@/app/api/automations/route") },
  { name: "get_campaign_report", description: "Read a campaign's full shareable report including seven-day delivery/click trends, top keywords and tracked link metrics. Sharing must be enabled; only this workspace's campaigns are accessible.", method: "GET", path: "/api/automations/[id]/report", input: { id }, load: () => import("@/app/api/automations/[id]/report/route") },
  { name: "create_campaign", description: "Create and optionally activate an Instagram comment-to-DM, DM auto-responder, or public reply campaign. Supports message variants, opening DMs, tracked links, next reel and all future reels. Owner/admin only.", method: "POST", path: "/api/automations", input: { body: createAutomationSchema }, load: () => import("@/app/api/automations/route") },
  { name: "update_campaign", description: "Edit a campaign, pause/resume using isActive, change targeting/messages/link, or toggle report sharing. Owner/admin only.", method: "PATCH", path: "/api/automations", input: { query: z.object({ id }).strict(), body: updateAutomationSchema }, load: () => import("@/app/api/automations/route") },
  { name: "delete_campaign", description: "Delete an Instagram campaign and associated records. Owner/admin only.", method: "DELETE", path: "/api/automations", input: { query: z.object({ id }).strict() }, destructive: true, load: () => import("@/app/api/automations/route") },
  { name: "import_campaigns", description: "Bulk import up to 200 campaign rows into an Instagram account. Returns created rows and skipped duplicates; accepts the structured rows from a CSV import. Owner/admin only.", method: "POST", path: "/api/automations/import", input: { body: importSchema }, load: () => import("@/app/api/automations/import/route") },
  { name: "list_facebook_automations", description: "List Messenger auto-responders and comment-to-message automations, with recent delivery logs.", method: "GET", path: "/api/facebook/automations", input: {}, load: () => import("@/app/api/facebook/automations/route") },
  { name: "create_facebook_automation", description: "Create a Facebook Messenger auto-responder or comment-to-message automation. Owner/admin only.", method: "POST", path: "/api/facebook/automations", input: { body: facebookAutomationSchema }, load: () => import("@/app/api/facebook/automations/route") },
  { name: "set_facebook_automation_active", description: "Pause or resume a Facebook automation. Owner/admin only.", method: "PATCH", path: "/api/facebook/automations", input: { query: z.object({ id }).strict(), body: z.object({ isActive: z.boolean() }).strict() }, load: () => import("@/app/api/facebook/automations/route") },
  { name: "delete_facebook_automation", description: "Delete a Facebook automation and associated records. Owner/admin only.", method: "DELETE", path: "/api/facebook/automations", input: { query: z.object({ id }).strict() }, destructive: true, load: () => import("@/app/api/facebook/automations/route") },
  { name: "list_scheduled_posts", description: "List drafts, scheduled posts, published outcomes, counts and publishing worker health. Follow nextCursor for more results; use this to monitor queued publication to a terminal status.", method: "GET", path: "/api/scheduler", input: { query: z.object({ cursor: id.optional(), status: z.enum(["DRAFT", "SCHEDULED", "PUBLISHING", "PUBLISHED", "FAILED", "CANCELLED", "NEEDS_REVIEW"]).optional(), search: z.string().max(120).optional(), start: z.iso.datetime({ offset: true }).optional(), end: z.iso.datetime({ offset: true }).optional() }).strict().optional() }, load: () => import("@/app/api/scheduler/route") },
  { name: "create_scheduled_post", description: "Create a draft, schedule for later, or publish now (intent=now). Supports platform-specific images, Reels, videos, carousels and stories. Pass a stable UUID clientRequestId to deduplicate retries. Publication is asynchronous; monitor status before declaring success.", method: "POST", path: "/api/scheduler", input: { body: postInputSchema }, load: () => import("@/app/api/scheduler/route") },
  { name: "mutate_scheduled_post", description: "Save/edit, cancel, retry, duplicate, or resolve uncertain delivery. Pass the latest revision from list_scheduled_posts. confirm-published/confirm-not-published require evidence from Meta; never guess when status is NEEDS_REVIEW.", method: "PATCH", path: "/api/scheduler/[id]", input: { id, body: mutationSchema }, load: () => import("@/app/api/scheduler/[id]/route") },
  { name: "prepare_media_upload", description: "For clients with an HTTP uploader; ChatGPT should use upload_media_file instead. Get a workspace-scoped signed PUT URL and stable media reference. Upload file bytes to uploadUrl using the returned headers, then pass mediaUrl to create_scheduled_post. Requires configured Backblaze storage.", method: "POST", path: "/api/scheduler/upload", input: { body: z.object({ platform: z.enum(["INSTAGRAM", "FACEBOOK"]), kind: z.enum(postKinds), contentType: z.string().max(100), size: z.number().int().positive().max(1024 ** 3) }).strict() }, load: () => import("@/app/api/scheduler/upload/route") },
  { name: "get_media_preview_url", description: "Get a temporary download URL for workspace media. Published media may have been cleaned up and need re-uploading.", method: "POST", write: false, path: "/api/scheduler/media", input: { body: z.object({ url: z.url().max(2048) }).strict() }, load: () => import("@/app/api/scheduler/media/route") },
  { name: "get_dashboard", description: "Read workspace dashboard, usage, accounts, campaign and performance metrics.", method: "GET", path: "/api/dashboard/stats", input: { query: z.object({ days }).strict().optional() }, load: () => import("@/app/api/dashboard/stats/route") },
  { name: "get_content_performance", description: "Read content views and insights across Instagram and Facebook, filtered by account/platform/window.", method: "GET", path: "/api/views", input: { query: z.object({ days, platform: z.enum(["INSTAGRAM", "FACEBOOK", "ALL"]).optional(), accountId: id.optional() }).strict().optional() }, load: () => import("@/app/api/views/route") },
  { name: "sync_performance", description: "Refresh social performance metrics from Meta for this workspace.", method: "POST", path: "/api/dashboard/performance/sync", input: { query: z.object({ days }).strict().optional() }, load: () => import("@/app/api/dashboard/performance/sync/route") },
  { name: "list_dm_logs", description: "Read paginated Instagram delivery logs and errors. Supports account and delivery-status filters.", method: "GET", path: "/api/logs", input: { query: accountQuery.extend({ page: z.number().int().positive().optional(), limit: z.number().int().min(1).max(50).optional(), status: z.enum(["PENDING", "SENT", "FAILED", "SKIPPED_DEDUP", "SKIPPED_RATE_LIMIT", "SKIPPED_PLAN_LIMIT", "SKIPPED_NO_MATCH"]).optional() }).optional() }, load: () => import("@/app/api/logs/route") },
  { name: "list_conversations", description: "Read Instagram inbox conversations with recipient IDs and latest messages.", method: "GET", path: "/api/instagram/conversations", input: { query: accountQuery.optional() }, load: () => import("@/app/api/instagram/conversations/route") },
  { name: "get_conversation", description: "Read the most recent messages in an Instagram conversation.", method: "GET", path: "/api/instagram/conversations/[id]", input: { id, query: accountQuery.optional() }, load: () => import("@/app/api/instagram/conversations/[id]/route") },
  { name: "send_instagram_message", description: "Send a reply in the Instagram inbox. Meta messaging-window and recipient rules apply. Sends immediately; do not retry blindly after a network timeout.", method: "POST", path: "/api/instagram/conversations", input: { body: z.object({ instagramAccountId: id, recipientId: id, text: z.string().trim().min(1).max(1000) }).strict() }, load: () => import("@/app/api/instagram/conversations/route") },
  { name: "get_bio_page", description: "Read your Link Studio profile, public slug, theme, links and click totals.", method: "GET", path: "/api/bio", input: {}, load: () => import("@/app/api/bio/route") },
  { name: "update_bio_page", description: "Update your public Link Studio profile and URL.", method: "POST", path: "/api/bio", input: { body: z.object({ slug: z.string().min(1).max(80), displayName: z.string().max(80), bio: z.string().max(240), avatarUrl: webUrl.nullable().optional(), theme: z.enum(["ember", "ink", "mint"]) }).strict() }, load: () => import("@/app/api/bio/route") },
  { name: "create_bio_link", description: "Add a Link Studio link, optionally with smart iOS/Android destinations.", method: "PUT", path: "/api/bio", input: { body: z.object({ title: z.string().trim().min(1).max(80), url: webUrl, icon: z.string().max(24).optional(), smartAppLink: z.boolean().optional(), iosUrl: webUrl.nullable().optional(), androidUrl: webUrl.nullable().optional() }).strict() }, load: () => import("@/app/api/bio/route") },
  { name: "update_bio_link", description: "Edit, enable/disable, or reorder a Link Studio link using position.", method: "PATCH", path: "/api/bio/links/[id]", input: { id, body: z.object({ title: z.string().trim().min(1).max(80).optional(), url: webUrl.optional(), icon: z.string().max(24).optional(), enabled: z.boolean().optional(), smartAppLink: z.boolean().optional(), iosUrl: webUrl.nullable().optional(), androidUrl: webUrl.nullable().optional(), position: z.number().int().nonnegative().optional() }).strict() }, load: () => import("@/app/api/bio/links/[id]/route") },
  { name: "delete_bio_link", description: "Delete a Link Studio link.", method: "DELETE", path: "/api/bio/links/[id]", input: { id }, destructive: true, load: () => import("@/app/api/bio/links/[id]/route") },
  { name: "list_workspace_members", description: "Read your role, workspace members and pending invitations.", method: "GET", path: "/api/workspace/members", input: {}, load: () => import("@/app/api/workspace/members/route") },
  { name: "invite_workspace_member", description: "Add an existing user or create an invitation URL for a new user. Returns the invite URL; does not send email. Owner/admin only.", method: "POST", path: "/api/workspace/members", input: { body: z.object({ email: z.email(), role: z.enum(["ADMIN", "MEMBER"]).default("MEMBER") }).strict() }, load: () => import("@/app/api/workspace/members/route") },
  { name: "update_workspace_member", description: "Change a workspace member's role. Owner/admin only; cannot change the owner.", method: "PATCH", path: "/api/workspace/members", input: { body: z.object({ memberId: id, role: z.enum(["ADMIN", "MEMBER"]) }).strict() }, load: () => import("@/app/api/workspace/members/route") },
  { name: "remove_workspace_member", description: "Remove a workspace member or revoke a pending invitation. Owner/admin only.", method: "DELETE", path: "/api/workspace/members", input: { body: z.object({ memberId: id.optional(), invitationId: id.optional() }).strict().refine((d) => d.memberId || d.invitationId, "Specify a member or invitation.") }, destructive: true, load: () => import("@/app/api/workspace/members/route") },
  { name: "accept_workspace_invitation", description: "Accept a workspace invitation addressed to the delegating user's verified email. This key remains bound to its original workspace; provision a key in the new workspace to operate there.", method: "POST", path: "/api/workspace/invitations/accept", input: { body: z.object({ token: id }).strict() }, load: () => import("@/app/api/workspace/invitations/accept/route") },
  { name: "get_user_profile", description: "Read the profile of the user who delegated this agent key.", method: "GET", path: "/api/user/profile", input: {}, load: () => import("@/app/api/user/profile/route") },
  { name: "update_user_profile", description: "Change the delegating user's display name.", method: "PATCH", path: "/api/user/profile", input: { body: z.object({ name: z.string().trim().min(1).max(80) }).strict() }, load: () => import("@/app/api/user/profile/route") },
  { name: "get_diagnostics", description: "Read workspace delivery failures and service/worker health.", method: "GET", path: "/api/admin/diagnostics", input: {}, load: () => import("@/app/api/admin/diagnostics/route") },
];

export function isWriteTool(tool: AgentTool) {
  // Consent-link generation grants access and therefore requires write scope.
  return tool.write ?? (tool.method !== "GET" || tool.name.startsWith("connect_"));
}

export async function invokeProductTool(tool: AgentTool, args: Record<string, unknown>, baseUrl: string) {
  const path = tool.path.replace("[id]", encodeURIComponent(String(args.id ?? "")));
  const url = new URL(path, baseUrl);
  for (const [key, value] of Object.entries((args.query ?? {}) as Record<string, unknown>))
    if (value !== undefined) url.searchParams.set(key, String(value));
  const request = new NextRequest(url, {
    method: tool.method,
    headers: { "Content-Type": "application/json" },
    ...(args.body !== undefined ? { body: JSON.stringify(args.body) } : {}),
  });
  const route = await tool.load();
  const handler = route[tool.method];
  if (!handler) throw new Error("Missing product handler.");
  const response = await handler(request, { params: Promise.resolve({ id: String(args.id ?? "") }) });
  const location = response.headers.get("location");
  if (location) {
    const consentUrl = new URL(location);
    const isConsent = tool.name === "connect_instagram" || tool.name === "connect_facebook";
    const externalConsent = isConsent && consentUrl.protocol === "https:" &&
      ["api.instagram.com", "www.instagram.com", "www.facebook.com", "instagram.com", "facebook.com"].includes(consentUrl.hostname);
    return { status: externalConsent ? 200 : 403, data: { url: location,
      requiresUserAction: true, message: externalConsent ? "The account owner must complete Meta consent." : "This role cannot connect this account." } };
  }
  return { status: response.status, data: await response.json() as Record<string, unknown> };
}
