import { NextResponse } from "next/server";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";

export async function GET() {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  const pages = await prisma.facebookPage.findMany({
    where: { workspaceId },
    orderBy: { connectedAt: "desc" },
    select: {
      id: true,
      pageId: true,
      name: true,
      webhookSubscribed: true,
      connectedAt: true,
    },
  });
  return NextResponse.json({ success: true, data: { pages } });
}
