import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { getCampaignReportBySlug } from "@/lib/reports/data";

export const dynamic = "force-dynamic";
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  const campaign = await prisma.automation.findFirst({
    where: { id, workspaceId, reportShareEnabled: true }, select: { reportShareSlug: true },
  });
  if (!campaign?.reportShareSlug) return Response.json({ error: "Report not found or sharing is disabled." }, { status: 404 });
  const report = await getCampaignReportBySlug(campaign.reportShareSlug, workspaceId);
  return report ? Response.json({ success: true, data: report }, { headers: { "Cache-Control": "private, no-store" } })
    : Response.json({ error: "Report not found." }, { status: 404 });
}
