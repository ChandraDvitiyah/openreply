import { z } from "zod";
import { NextResponse } from "next/server";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { prisma } from "@/lib/db/client";
import {
  isBackblazeMediaUrl,
  schedulerMediaUrl,
  StorageError,
} from "@/lib/scheduler/storage";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const context = await getCurrentWorkspaceContext();
  if (!context)
    return NextResponse.json(
      { error: "Sign in to preview media." },
      { status: 401 },
    );
  try {
    const { url } = z
      .object({ url: z.string().url().max(2048) })
      .parse(await request.json());
    if (!isBackblazeMediaUrl(url))
      return NextResponse.json(
        { error: "Unsupported storage URL." },
        { status: 400 },
      );
    const removed = await prisma.scheduledMediaCleanup.findFirst({
      where: {
        workspaceId: context.workspaceId,
        url,
        state: { in: ["DELETING", "DELETED"] },
      },
    });
    if (removed)
      throw new StorageError(
        "This media file was removed after successful publication. Upload it again to reuse it.",
      );
    return NextResponse.json(
      { url: await schedulerMediaUrl(context.workspaceId, url, 3600) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof StorageError
            ? error.message
            : "Unable to preview this media file.",
      },
      { status: 400 },
    );
  }
}
