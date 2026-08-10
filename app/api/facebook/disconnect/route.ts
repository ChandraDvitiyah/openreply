import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import {
  canManageWorkspace,
  getCurrentWorkspaceContext,
} from "@/lib/workspace-access";

export async function POST(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!canManageWorkspace(context.role)) {
    return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const facebookPageId =
    typeof body.facebookPageId === "string" ? body.facebookPageId : null;
  if (!facebookPageId) {
    return NextResponse.json({ success: false, error: "Page is required" }, { status: 400 });
  }
  await prisma.facebookPage.deleteMany({
    where: { id: facebookPageId, workspaceId: context.workspaceId },
  });
  return NextResponse.json({ success: true });
}
