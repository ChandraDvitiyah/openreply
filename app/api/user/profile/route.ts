import { NextRequest, NextResponse } from "next/server";
import { clerkClient, currentUser } from "@clerk/nextjs/server";
import { z } from "zod";
import { getCurrentUserId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";

const profileSchema = z.object({
  name: z.string().trim().min(1, "Enter your name").max(80, "Keep your name under 80 characters"),
});

export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  const [clerkUser, localUser] = await Promise.all([
    currentUser(),
    prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } }),
  ]);
  return NextResponse.json({
    success: true,
    data: {
      name: clerkUser?.fullName ?? localUser?.name ?? "",
      email: clerkUser?.primaryEmailAddress?.emailAddress ?? localUser?.email ?? null,
    },
  });
}

export async function PATCH(request: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  const parsed = profileSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.issues[0]?.message ?? "Invalid name" },
      { status: 400 }
    );
  }

  const name = parsed.data.name.replace(/\s+/g, " ");
  const [firstName, ...rest] = name.split(" ");
  const lastName = rest.join(" ");
  const client = await clerkClient();
  const clerkUser = await client.users.updateUser(userId, { firstName, lastName });
  const email = clerkUser.primaryEmailAddress?.emailAddress ?? null;
  await prisma.user.upsert({
    where: { id: userId },
    create: { id: userId, name, email, image: clerkUser.imageUrl },
    update: { name, email, image: clerkUser.imageUrl },
  });

  return NextResponse.json({ success: true, data: { name, email } });
}
