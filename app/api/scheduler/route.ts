import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { postInputSchema } from "@/lib/scheduler/validation";
import { createPost } from "@/lib/scheduler/service";
import { schedulerFailure } from "@/lib/scheduler/http";
import { schedulerStorageConfigured } from "@/lib/scheduler/storage";
import { asStringArray } from "@/lib/utils/string-list";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const context = await getCurrentWorkspaceContext();
    if (!context)
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 },
      );
    const cursor = request.nextUrl.searchParams.get("cursor");
    const status = request.nextUrl.searchParams.get("status");
    const search = request.nextUrl.searchParams.get("search")?.slice(0, 120);
    const start = request.nextUrl.searchParams.get("start");
    const end = request.nextUrl.searchParams.get("end");
    const validStatuses = [
      "DRAFT",
      "SCHEDULED",
      "PUBLISHING",
      "PUBLISHED",
      "FAILED",
      "CANCELLED",
      "NEEDS_REVIEW",
    ] as const;
    const statusFilter = validStatuses.find((s) => s === status);
    const where = {
      workspaceId: context.workspaceId,
      ...(statusFilter ? { status: statusFilter } : {}),
      ...(search
        ? {
            OR: [
              { title: { contains: search } },
              { caption: { contains: search } },
              { accountName: { contains: search } },
            ],
          }
        : {}),
      ...(start &&
      end &&
      Number.isFinite(Date.parse(start)) &&
      Number.isFinite(Date.parse(end))
        ? { scheduledAt: { gte: new Date(start), lt: new Date(end) } }
        : {}),
    };
    const [posts, instagram, facebook, worker, counts] = await Promise.all([
      prisma.scheduledPost.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 101,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
      prisma.instagramAccount.findMany({
        where: { workspaceId: context.workspaceId },
        select: { id: true, username: true },
      }),
      prisma.facebookPage.findMany({
        where: { workspaceId: context.workspaceId },
        select: { id: true, name: true },
      }),
      prisma.workerState.findUnique({
        where: { key: "scheduler" },
        select: { checkedAt: true, status: true },
      }),
      prisma.scheduledPost.groupBy({
        by: ["status"],
        where: { workspaceId: context.workspaceId },
        _count: true,
      }),
    ]);
    const removed = await prisma.scheduledMediaCleanup.findMany({
      where: {
        workspaceId: context.workspaceId,
        state: { in: ["DELETING", "DELETED"] },
        url: { in: posts.flatMap((post) => asStringArray(post.mediaUrls)) },
      },
      select: { url: true },
    });
    const removedUrls = new Set(removed.map((row) => row.url));
    return NextResponse.json(
      {
        success: true,
        data: {
          counts: Object.fromEntries(
            counts.map((row) => [row.status, row._count]),
          ),
          posts: posts
            .slice(0, 100)
            .map((post) => ({
              ...post,
              deletedMediaCount: asStringArray(post.mediaUrls).filter((url) =>
                removedUrls.has(url),
              ).length,
            })),
          uploadEnabled: schedulerStorageConfigured(),
          nextCursor: posts.length > 100 ? posts[99].id : null,
          accounts: [
            ...instagram.map((a) => ({
              id: a.id,
              platform: "INSTAGRAM",
              name: `@${a.username}`,
            })),
            ...facebook.map((a) => ({ ...a, platform: "FACEBOOK" })),
          ],
          workerHealthy: Boolean(
            worker?.status === "running" &&
            Date.now() - worker.checkedAt.getTime() < 180_000,
          ),
        },
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return schedulerFailure(error);
  }
}
export async function POST(request: Request) {
  try {
    const context = await getCurrentWorkspaceContext();
    if (!context)
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 },
      );
    return NextResponse.json(
      {
        success: true,
        data: await createPost(
          context,
          postInputSchema.parse(await request.json()),
        ),
      },
      { status: 201 },
    );
  } catch (error) {
    return schedulerFailure(error);
  }
}
