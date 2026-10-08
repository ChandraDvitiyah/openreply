import { createAutomationSchema, updateAutomationSchema } from "@/lib/automations/validation";
import { NextRequest, NextResponse } from "next/server";
import {
  DEFAULT_PUBLIC_REPLY_MESSAGE,
} from "@/lib/constants";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { calculateCtr, normalizeTopKeywords } from "@/lib/tracking/analytics";
import { buildTrackedUrl } from "@/lib/tracking/message";
import { generateTrackedLinkSlug } from "@/lib/tracking/server";
import { buildReportUrl, generateReportShareSlug } from "@/lib/reports/share";
import { asStringArray } from "@/lib/utils/string-list";
import {
  canManageWorkspace,
  getCurrentWorkspaceContext,
} from "@/lib/workspace-access";

// This list is read-your-writes (created/imported campaigns must show up
// immediately), so never cache it at the route or CDN layer.
export const dynamic = "force-dynamic";

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
  const automationId = request.nextUrl.searchParams.get("id");
  const accountFilter =
    instagramAccountId && instagramAccountId !== "all"
      ? { instagramAccountId }
      : {};
  const automationFilter = automationId ? { id: automationId } : {};
  const analyticsAutomationFilter = automationId ? { automationId } : {};

  const automations = await prisma.automation.findMany({
    where: { workspaceId, ...accountFilter, ...automationFilter },
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
      where: { workspaceId, ...analyticsAutomationFilter },
      _count: { _all: true },
    }),
    prisma.linkClick.groupBy({
      by: ["automationId"],
      where: { workspaceId, ...analyticsAutomationFilter },
      _count: { _all: true },
    }),
    prisma.dmLog.groupBy({
      by: ["automationId", "matchedKeyword"],
      where: { workspaceId, ...analyticsAutomationFilter, matchedKeyword: { not: null } },
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
  const autoAddNewReels = isDmAutoresponder ? false : parsed.data.autoAddNewReels;
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
  const isSpecificPost =
    !isDmAutoresponder && !pendingNextReel && !matchAnyPost && !autoAddNewReels;
  const publicReplyList = (
    parsed.data.publicReplyMessages.length > 0
      ? parsed.data.publicReplyMessages
      : parsed.data.publicReplyMessage
        ? [parsed.data.publicReplyMessage]
        : []
  )
    .map((m) => m.trim())
    .filter(Boolean);
  const normalizedPublicReplyList =
    publicReplyEnabled && publicReplyList.length === 0
      ? [DEFAULT_PUBLIC_REPLY_MESSAGE]
      : publicReplyList;

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
      autoAddNewReels,
      autoAddReelsSince: autoAddNewReels ? new Date() : null,
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
      publicReplyMessages: publicReplyEnabled
        ? normalizedPublicReplyList
        : [],
      publicReplyMessage: publicReplyEnabled
        ? normalizedPublicReplyList[0]
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
    automationData.autoAddNewReels = false;
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
  if (
    automationData.matchAnyPost === true ||
    automationData.pendingNextReel === true ||
    automationData.autoAddNewReels === true
  ) {
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
  } else if (
    automationData.publicReplyEnabled === true &&
    (automationData.publicReplyMessages?.length ?? 0) === 0 &&
    !automationData.publicReplyMessage?.trim() &&
    !existing.publicReplyMessage?.trim() &&
    asStringArray(existing.publicReplyMessages).length === 0
  ) {
    automationData.publicReplyMessages = [DEFAULT_PUBLIC_REPLY_MESSAGE];
    automationData.publicReplyMessage = DEFAULT_PUBLIC_REPLY_MESSAGE;
  }

  const updated = await prisma.automation.update({
    where: { id: automationId },
    data: {
      ...automationData,
      ...(automationData.autoAddNewReels === true && !existing.autoAddNewReels
        ? { autoAddReelsSince: new Date() }
        : automationData.autoAddNewReels === false
          ? { autoAddReelsSince: null }
          : {}),
    },
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
