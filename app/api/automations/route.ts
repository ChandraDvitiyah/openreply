import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { MAX_KEYWORDS } from "@/lib/constants";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { calculateCtr, normalizeTopKeywords } from "@/lib/tracking/analytics";
import { buildTrackedUrl } from "@/lib/tracking/message";
import { generateTrackedLinkSlug } from "@/lib/tracking/server";
import { buildReportUrl, generateReportShareSlug } from "@/lib/reports/share";
import {
  canManageWorkspace,
  getCurrentWorkspaceContext,
} from "@/lib/workspace-access";

// This list is read-your-writes (created/imported campaigns must show up
// immediately), so never cache it at the route or CDN layer.
export const dynamic = "force-dynamic";

const createAutomationSchema = z
  .object({
    name: z.string().min(1).max(100),
    // Which trigger this campaign uses. Defaults to the original comment-to-DM
    // behaviour; DM_AUTORESPONDER replies to inbound DMs instead;
    // COMMENT_TO_COMMENT only posts a public reply (no DM, opening DM, or link).
    type: z
      .enum(["COMMENT_TO_DM", "DM_AUTORESPONDER", "COMMENT_TO_COMMENT"])
      .optional()
      .default("COMMENT_TO_DM"),
    goal: z.string().min(1).max(120).optional().nullable(),
    instagramAccountId: z.string().min(1).optional().nullable(),
    postId: z.string().min(1).optional().nullable(),
    postUrl: z.string().url().optional().nullable(),
    pendingNextReel: z.boolean().optional().default(false),
    matchAnyPost: z.boolean().optional().default(false),
    keywords: z
      .array(z.string().min(1).max(50))
      .max(MAX_KEYWORDS)
      .optional()
      .default([]),
    matchAnyWord: z.boolean().optional().default(false),
    // A comment-to-comment campaign carries no DM, so the DM text is optional
    // and only required for the other types (enforced by the refine below).
    dmMessage: z.string().max(1000).optional().default(""),
    dmMessages: z
      .array(z.string().max(1000))
      .max(10)
      .optional()
      .default([]),
    openingDmEnabled: z.boolean().optional().default(false),
    openingDmMessage: z.string().max(1000).optional().nullable(),
    openingDmButtonLabel: z.string().max(64).optional().nullable(),
    linkButtonLabel: z.string().max(20).optional().nullable(),
    publicReplyEnabled: z.boolean().optional().default(false),
    publicReplyMessage: z.string().max(1000).optional().nullable(),
    publicReplyMessages: z
      .array(z.string().max(1000))
      .max(10)
      .optional()
      .default([]),
    // Empty string means "no tracked link"; a URL sets one.
    trackedDestinationUrl: z
      .union([z.string().url(), z.literal("")])
      .optional()
      .nullable(),
    isActive: z.boolean().optional().default(true),
    wholeWordMatch: z.boolean().optional().default(true),
  })
  // A comment-to-DM campaign must target a specific post, any post, or the next
  // reel. DM auto-responders have no post trigger, so this rule doesn't apply.
  .refine(
    (d) =>
      d.type === "DM_AUTORESPONDER" ||
      d.matchAnyPost ||
      d.pendingNextReel ||
      Boolean(d.postId),
    { message: "Choose which post(s) trigger the campaign", path: ["postId"] }
  )
  // And it must match either specific words or any word.
  .refine((d) => d.matchAnyWord || d.keywords.length >= 1, {
    message: "Add at least one keyword, or match any word",
    path: ["keywords"],
  })
  // Every type except comment-to-comment delivers a DM, so it needs DM text.
  .refine(
    (d) =>
      d.type === "COMMENT_TO_COMMENT" ||
      d.dmMessage.trim().length > 0 ||
      d.dmMessages.some((m) => m.trim().length > 0),
    { message: "Add the DM message", path: ["dmMessage"] }
  )
  // A comment-to-comment campaign's only delivery is the public reply, so it
  // needs an enabled public reply with at least one message.
  .refine(
    (d) =>
      d.type !== "COMMENT_TO_COMMENT" ||
      Boolean(d.publicReplyMessage?.trim()) ||
      d.publicReplyMessages.some((m) => m.trim().length > 0),
    { message: "Add a public reply message", path: ["publicReplyMessages"] }
  )
  // An opening DM needs both a message and a button label.
  .refine(
    (d) =>
      !d.openingDmEnabled ||
      (Boolean(d.openingDmMessage?.trim()) &&
        Boolean(d.openingDmButtonLabel?.trim())),
    { message: "Opening DM needs a message and a button label", path: ["openingDmMessage"] }
  );

const updateAutomationSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  type: z
    .enum(["COMMENT_TO_DM", "DM_AUTORESPONDER", "COMMENT_TO_COMMENT"])
    .optional(),
  goal: z.string().min(1).max(120).optional().nullable(),
  postId: z.string().min(1).optional().nullable(),
  postUrl: z.string().url().optional().nullable(),
  pendingNextReel: z.boolean().optional(),
  matchAnyPost: z.boolean().optional(),
  keywords: z.array(z.string().min(1).max(50)).max(MAX_KEYWORDS).optional(),
  matchAnyWord: z.boolean().optional(),
  // Empty is allowed so a comment-to-comment campaign (which has no DM) can
  // clear the text; the client always sends real DM text for the other types.
  dmMessage: z.string().max(1000).optional(),
  dmMessages: z.array(z.string().max(1000)).max(10).optional(),
  openingDmEnabled: z.boolean().optional(),
  openingDmMessage: z.string().max(1000).optional().nullable(),
  openingDmButtonLabel: z.string().max(64).optional().nullable(),
  linkButtonLabel: z.string().max(20).optional().nullable(),
  publicReplyEnabled: z.boolean().optional(),
  publicReplyMessage: z.string().max(1000).optional().nullable(),
  publicReplyMessages: z.array(z.string().max(1000)).max(10).optional(),
  isActive: z.boolean().optional(),
  wholeWordMatch: z.boolean().optional(),
  reportShareEnabled: z.boolean().optional(),
  // Empty string clears the tracked link; a URL updates/creates it; undefined
  // leaves it unchanged.
  trackedDestinationUrl: z
    .union([z.string().url(), z.literal("")])
    .optional()
    .nullable(),
});

export async function GET(request: NextRequest) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }
  const instagramAccountId =
    request.nextUrl.searchParams.get("instagramAccountId");
  const accountFilter =
    instagramAccountId && instagramAccountId !== "all"
      ? { instagramAccountId }
      : {};

  const automations = await prisma.automation.findMany({
    where: { workspaceId, ...accountFilter },
    include: {
      instagramAccount: {
        select: { username: true, instagramId: true },
      },
      _count: {
        select: { dmLogs: true },
      },
      trackedLinks: {
        select: {
          id: true,
          slug: true,
          label: true,
          destinationUrl: true,
          _count: { select: { clicks: true } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const automationsWithReports = await Promise.all(
    automations.map(async (automation) => {
      if (automation.reportShareSlug) return automation;

      const updated = await prisma.automation.update({
        where: { id: automation.id },
        data: { reportShareSlug: generateReportShareSlug() },
        select: { reportShareSlug: true },
      });

      return {
        ...automation,
        reportShareSlug: updated.reportShareSlug,
      };
    })
  );

  const [statusCounts, clickCounts, keywordCounts] = await Promise.all([
    prisma.dmLog.groupBy({
      by: ["automationId", "status"],
      where: { workspaceId },
      _count: { _all: true },
    }),
    prisma.linkClick.groupBy({
      by: ["automationId"],
      where: { workspaceId },
      _count: { _all: true },
    }),
    prisma.dmLog.groupBy({
      by: ["automationId", "matchedKeyword"],
      where: { workspaceId, matchedKeyword: { not: null } },
      _count: { _all: true },
    }),
  ]);

  const analytics = new Map<
    string,
    {
      sent: number;
      skipped: number;
      failed: number;
      clicks: number;
      topKeywords: { keyword: string; count: number }[];
    }
  >();

  for (const automation of automationsWithReports) {
    analytics.set(automation.id, {
      sent: 0,
      skipped: 0,
      failed: 0,
      clicks: 0,
      topKeywords: [],
    });
  }

  for (const row of statusCounts) {
    const item = analytics.get(row.automationId);
    if (!item) continue;
    const count = row._count._all;
    if (row.status === "SENT") item.sent += count;
    if (row.status === "FAILED") item.failed += count;
    if (row.status.startsWith("SKIPPED_")) item.skipped += count;
  }

  for (const row of clickCounts) {
    const item = analytics.get(row.automationId);
    if (item) item.clicks = row._count._all;
  }

  for (const automation of automationsWithReports) {
    const item = analytics.get(automation.id);
    if (!item) continue;
    item.topKeywords = normalizeTopKeywords(
      keywordCounts
        .filter((row) => row.automationId === automation.id)
        .map((row) => ({
          matchedKeyword: row.matchedKeyword,
          _count: row._count._all,
        })),
      3
    );
  }

  return NextResponse.json(
    {
    success: true,
    data: automationsWithReports.map((automation) => {
      const item = analytics.get(automation.id) ?? {
        sent: 0,
        skipped: 0,
        failed: 0,
        clicks: 0,
        topKeywords: [],
      };

      return {
        ...automation,
        trackedLinks: automation.trackedLinks.map((link) => ({
          ...link,
          trackedUrl: buildTrackedUrl(link.slug),
        })),
        reportUrl: automation.reportShareSlug
          ? buildReportUrl(automation.reportShareSlug)
          : null,
        analytics: {
          ...item,
          ctr: calculateCtr(item.clicks, item.sent),
        },
      };
    }),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  if (!canManageWorkspace(context.role)) {
    return NextResponse.json(
      { success: false, error: "Only owners and admins can create campaigns" },
      { status: 403 }
    );
  }

  const workspaceId = context.workspaceId;

  const body = await request.json();
  const parsed = createAutomationSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        error: "Invalid input",
        details: parsed.error.flatten(),
      },
      { status: 400 }
    );
  }

  const requestedInstagramAccountId =
    parsed.data.instagramAccountId && parsed.data.instagramAccountId !== "all"
      ? parsed.data.instagramAccountId
      : null;

  const [workspace, instagramAccount] = await Promise.all([
    prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true },
    }),
    requestedInstagramAccountId
      ? prisma.instagramAccount.findFirst({
          where: { id: requestedInstagramAccountId, workspaceId },
        })
      : prisma.instagramAccount.findFirst({
          where: { workspaceId },
          orderBy: { connectedAt: "desc" },
        }),
  ]);

  if (!workspace) {
    return NextResponse.json(
      { success: false, error: "Workspace not found" },
      { status: 404 }
    );
  }

  if (!instagramAccount) {
    return NextResponse.json(
      { success: false, error: "Connect Instagram before creating campaigns" },
      { status: 400 }
    );
  }

  const { trackedDestinationUrl } = parsed.data;

  const isDmAutoresponder = parsed.data.type === "DM_AUTORESPONDER";
  const isCommentToComment = parsed.data.type === "COMMENT_TO_COMMENT";
  const { matchAnyWord } = parsed.data;
  // A DM auto-responder has no post trigger, public reply, or opening DM.
  const pendingNextReel = isDmAutoresponder ? false : parsed.data.pendingNextReel;
  const matchAnyPost = isDmAutoresponder ? false : parsed.data.matchAnyPost;
  // Neither a DM auto-responder nor a comment-to-comment campaign uses an
  // opening DM.
  const openingDmEnabled =
    isDmAutoresponder || isCommentToComment
      ? false
      : parsed.data.openingDmEnabled;
  // A DM auto-responder never has a public reply; it is the entire delivery of
  // a comment-to-comment campaign, so force it on there.
  const publicReplyEnabled = isDmAutoresponder
    ? false
    : isCommentToComment
      ? true
      : parsed.data.publicReplyEnabled;
  // A post is only stored for the "specific post" trigger.
  const isSpecificPost = !isDmAutoresponder && !pendingNextReel && !matchAnyPost;
  const publicReplyList = (
    parsed.data.publicReplyMessages.length > 0
      ? parsed.data.publicReplyMessages
      : parsed.data.publicReplyMessage
        ? [parsed.data.publicReplyMessage]
        : []
  )
    .map((m) => m.trim())
    .filter(Boolean);

  // Reply-DM variants. One is picked at random per send; the primary dmMessage
  // stays in sync as the first variant for back-compat. A comment-to-comment
  // campaign has no DM at all.
  const dmList = isCommentToComment
    ? []
    : (parsed.data.dmMessages.length > 0
        ? parsed.data.dmMessages
        : [parsed.data.dmMessage]
      )
        .map((m) => m.trim())
        .filter(Boolean);
  const primaryDmMessage = isCommentToComment
    ? ""
    : dmList[0] ?? parsed.data.dmMessage;

  const automation = await prisma.automation.create({
    data: {
      type: parsed.data.type,
      name: parsed.data.name,
      goal: parsed.data.goal,
      // A next-reel campaign has no post yet; the cron binds it once a reel is posted.
      postId: isSpecificPost ? parsed.data.postId : null,
      postUrl: isSpecificPost ? parsed.data.postUrl : null,
      pendingNextReel,
      matchAnyPost,
      keywords: matchAnyWord ? [] : parsed.data.keywords,
      matchAnyWord,
      dmMessage: primaryDmMessage,
      dmMessages: dmList,
      openingDmEnabled,
      openingDmMessage: openingDmEnabled
        ? parsed.data.openingDmMessage || null
        : null,
      openingDmButtonLabel: openingDmEnabled
        ? parsed.data.openingDmButtonLabel || null
        : null,
      // A comment-to-comment campaign has no link, so no button label either.
      linkButtonLabel: isCommentToComment
        ? null
        : parsed.data.linkButtonLabel || null,
      publicReplyEnabled,
      publicReplyMessages: publicReplyEnabled ? publicReplyList : [],
      publicReplyMessage: publicReplyEnabled
        ? publicReplyList[0] ?? parsed.data.publicReplyMessage ?? null
        : null,
      isActive: parsed.data.isActive,
      wholeWordMatch: parsed.data.wholeWordMatch,
      workspaceId,
      instagramAccountId: instagramAccount.id,
      reportShareSlug: generateReportShareSlug(),
      // A comment-to-comment campaign never has a tracked link.
      ...(trackedDestinationUrl && !isCommentToComment
        ? {
            trackedLinks: {
              create: {
                workspaceId,
                slug: generateTrackedLinkSlug(),
                label: "Primary campaign link",
                destinationUrl: trackedDestinationUrl,
              },
            },
          }
        : {}),
    },
    include: {
      trackedLinks: true,
    },
  });

  return NextResponse.json(
    { success: true, data: automation },
    { status: 201 }
  );
}

export async function PATCH(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  if (!canManageWorkspace(context.role)) {
    return NextResponse.json(
      { success: false, error: "Only owners and admins can update campaigns" },
      { status: 403 }
    );
  }

  const workspaceId = context.workspaceId;

  const automationId = request.nextUrl.searchParams.get("id");
  if (!automationId) {
    return NextResponse.json(
      { success: false, error: "Missing campaign ID" },
      { status: 400 }
    );
  }

  const body = await request.json();
  const parsed = updateAutomationSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        error: "Invalid input",
        details: parsed.error.flatten(),
      },
      { status: 400 }
    );
  }

  const existing = await prisma.automation.findFirst({
    where: { id: automationId, workspaceId },
  });

  if (!existing) {
    return NextResponse.json(
      { success: false, error: "Campaign not found" },
      { status: 404 }
    );
  }

  const { trackedDestinationUrl, ...automationData } = parsed.data;

  // A DM auto-responder has no post trigger, public reply, or opening DM —
  // clear those so a type switch can't leave stale comment-only config behind.
  if (automationData.type === "DM_AUTORESPONDER") {
    automationData.postId = null;
    automationData.postUrl = null;
    automationData.matchAnyPost = false;
    automationData.pendingNextReel = false;
    automationData.openingDmEnabled = false;
    automationData.openingDmMessage = null;
    automationData.openingDmButtonLabel = null;
    automationData.publicReplyEnabled = false;
    automationData.publicReplyMessages = [];
    automationData.publicReplyMessage = null;
  }

  // A comment-to-comment campaign has no DM, opening DM, or link — the public
  // reply is its whole delivery. Clear the DM-side config and force the reply
  // on so a type switch can't leave a stale DM behind. The tracked link, if
  // any, is cleared below when the client sends an empty destination URL.
  if (automationData.type === "COMMENT_TO_COMMENT") {
    automationData.dmMessage = "";
    automationData.dmMessages = [];
    automationData.openingDmEnabled = false;
    automationData.openingDmMessage = null;
    automationData.openingDmButtonLabel = null;
    automationData.linkButtonLabel = null;
    automationData.publicReplyEnabled = true;
  }

  // Keep dependent fields consistent: any-word clears keywords; a disabled
  // opening DM clears its message and button.
  if (automationData.matchAnyWord === true) automationData.keywords = [];
  if (automationData.openingDmEnabled === false) {
    automationData.openingDmMessage = null;
    automationData.openingDmButtonLabel = null;
  }
  // Any-post / next-reel campaigns carry no specific post.
  if (automationData.matchAnyPost === true || automationData.pendingNextReel === true) {
    automationData.postId = null;
    automationData.postUrl = null;
  }
  // Keep the reply-DM variations list and the legacy single field in sync.
  if (automationData.dmMessages !== undefined) {
    const list = automationData.dmMessages
      .map((m) => m.trim())
      .filter(Boolean);
    automationData.dmMessages = list;
    if (list[0]) automationData.dmMessage = list[0];
  }

  // Keep the public-reply variations list and the legacy single field in sync.
  if (automationData.publicReplyMessages !== undefined) {
    const list = automationData.publicReplyMessages
      .map((m) => m.trim())
      .filter(Boolean);
    automationData.publicReplyMessages = list;
    automationData.publicReplyMessage = list[0] ?? null;
  }
  if (automationData.publicReplyEnabled === false) {
    automationData.publicReplyMessages = [];
    automationData.publicReplyMessage = null;
  }

  const updated = await prisma.automation.update({
    where: { id: automationId },
    data: automationData,
  });

  // Update, create, or clear the campaign's primary tracked link when a
  // destination URL was supplied. `undefined` means "leave it alone".
  if (trackedDestinationUrl !== undefined && trackedDestinationUrl !== null) {
    const primaryLink = await prisma.trackedLink.findFirst({
      where: { automationId },
      orderBy: { createdAt: "asc" },
    });

    if (trackedDestinationUrl === "") {
      if (primaryLink) {
        await prisma.trackedLink.delete({ where: { id: primaryLink.id } });
      }
    } else if (primaryLink) {
      await prisma.trackedLink.update({
        where: { id: primaryLink.id },
        data: { destinationUrl: trackedDestinationUrl },
      });
    } else {
      await prisma.trackedLink.create({
        data: {
          workspaceId,
          automationId,
          slug: generateTrackedLinkSlug(),
          label: "Primary campaign link",
          destinationUrl: trackedDestinationUrl,
        },
      });
    }
  }

  return NextResponse.json({ success: true, data: updated });
}

export async function DELETE(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  if (!canManageWorkspace(context.role)) {
    return NextResponse.json(
      { success: false, error: "Only owners and admins can delete campaigns" },
      { status: 403 }
    );
  }

  const workspaceId = context.workspaceId;

  const automationId = request.nextUrl.searchParams.get("id");
  if (!automationId) {
    return NextResponse.json(
      { success: false, error: "Missing campaign ID" },
      { status: 400 }
    );
  }

  const existing = await prisma.automation.findFirst({
    where: { id: automationId, workspaceId },
  });

  if (!existing) {
    return NextResponse.json(
      { success: false, error: "Campaign not found" },
      { status: 404 }
    );
  }

  await prisma.automation.delete({ where: { id: automationId } });

  return NextResponse.json({ success: true, data: { deleted: true } });
}
