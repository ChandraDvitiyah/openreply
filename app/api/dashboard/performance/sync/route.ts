import { NextRequest, NextResponse } from "next/server";
import { getCurrentWorkspaceId } from "@/lib/auth";
import {
  normalizePerformancePeriod,
  syncWorkspacePerformance,
} from "@/lib/performance/social-sync";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  const periodDays = normalizePerformancePeriod(
    request.nextUrl.searchParams.get("days")
  );
  const result = await syncWorkspacePerformance(workspaceId, periodDays);
  return NextResponse.json(
    { success: true, data: result },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
