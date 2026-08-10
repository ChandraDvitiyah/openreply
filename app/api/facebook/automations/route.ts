import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import {
  canManageWorkspace,
  getCurrentWorkspaceContext,
} from "@/lib/workspace-access";

const automationSchema = z.object({
  facebookPageId: z.string().min(1),
  type: z.enum(["MESSENGER_AUTORESPONDER", "COMMENT_TO_MESSAGE"]),
  name: z.string().trim().min(1).max(100),
  postId: z.string().trim().max(200).optional().nullable(),
  matchAnyPost: z.boolean().default(true),
  keywords: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
  matchAnyWord: z.boolean().default(false),
  replyMessage: z.string().trim().min(1).max(2000),
  wholeWordMatch: z.boolean().default(true),
  isActive: z.boolean().default(true),
});

export async function GET() {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  const [automations, logs] = await Promise.all([
    prisma.facebookAutomation.findMany({
      where: { workspaceId: context.workspaceId },
      include: {
        facebookPage: { select: { id: true, pageId: true, name: true } },
        _count: { select: { messageLogs: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.facebookMessageLog.findMany({
      where: { workspaceId: context.workspaceId },
      include: {
        facebookPage: { select: { name: true } },
        automation: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 25,
    }),
  ]);
  return NextResponse.json({ success: true, data: { automations, logs } });
}

export async function POST(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!canManageWorkspace(context.role)) {
    return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
  }
  const parsed = automationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Invalid Facebook automation", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const page = await prisma.facebookPage.findFirst({
    where: { id: parsed.data.facebookPageId, workspaceId: context.workspaceId },
  });
  if (!page) {
    return NextResponse.json({ success: false, error: "Facebook Page not found" }, { status: 404 });
  }
  const data = parsed.data;
  const automation = await prisma.facebookAutomation.create({
    data: {
      ...data,
      workspaceId: context.workspaceId,
      postId:
        data.type === "COMMENT_TO_MESSAGE" && !data.matchAnyPost
          ? data.postId || null
          : null,
      matchAnyPost:
        data.type === "COMMENT_TO_MESSAGE" ? data.matchAnyPost : true,
      keywords: data.matchAnyWord ? [] : data.keywords,
    },
  });
  return NextResponse.json({ success: true, data: automation }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!canManageWorkspace(context.role)) {
    return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
  }
  const id = request.nextUrl.searchParams.get("id");
  const body = await request.json().catch(() => null);
  const isActive = body && typeof body.isActive === "boolean" ? body.isActive : null;
  if (!id || isActive === null) {
    return NextResponse.json({ success: false, error: "Invalid update" }, { status: 400 });
  }
  const updated = await prisma.facebookAutomation.updateMany({
    where: { id, workspaceId: context.workspaceId },
    data: { isActive },
  });
  if (!updated.count) {
    return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!canManageWorkspace(context.role)) {
    return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
  }
  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ success: false, error: "Missing ID" }, { status: 400 });
  }
  await prisma.facebookAutomation.deleteMany({
    where: { id, workspaceId: context.workspaceId },
  });
  return NextResponse.json({ success: true });
}
