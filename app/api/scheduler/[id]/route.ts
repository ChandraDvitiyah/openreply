import { NextResponse } from "next/server";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { mutationSchema } from "@/lib/scheduler/validation";
import { mutatePost } from "@/lib/scheduler/service";
import { schedulerFailure } from "@/lib/scheduler/http";
export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const context = await getCurrentWorkspaceContext();
    if (!context)
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 },
      );
    const { id } = await ctx.params;
    return NextResponse.json({
      success: true,
      data: await mutatePost(
        context,
        id,
        mutationSchema.parse(await request.json()),
      ),
    });
  } catch (error) {
    return schedulerFailure(error);
  }
}
