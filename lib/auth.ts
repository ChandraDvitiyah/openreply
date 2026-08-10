import { auth as clerkAuth, currentUser } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db/client";
import { ensureWorkspaceForUser, getPrimaryWorkspace } from "@/lib/workspace";

type KultSession = {
  user: {
    id: string;
    email: string | null;
    name: string | null;
    image: string | null;
  };
};

async function syncClerkUser(userId: string) {
  const existing = await prisma.user.findUnique({ where: { id: userId } });
  if (existing) return existing;

  const user = await currentUser();
  if (!user || user.id !== userId) return null;

  const email = user.primaryEmailAddress?.emailAddress ?? null;
  return prisma.user.upsert({
    where: { id: userId },
    update: {
      name: user.fullName,
      email,
      image: user.imageUrl,
    },
    create: {
      id: userId,
      name: user.fullName,
      email,
      image: user.imageUrl,
    },
  });
}

// Compatibility wrapper so the upstream OpenReply routes keep their existing
// session-shaped contract while Clerk owns authentication.
export async function auth(): Promise<KultSession | null> {
  const { userId } = await clerkAuth();
  if (!userId) return null;

  const user = await syncClerkUser(userId);
  return {
    user: {
      id: userId,
      email: user?.email ?? null,
      name: user?.name ?? null,
      image: user?.image ?? null,
    },
  };
}

export async function getCurrentUserId(): Promise<string | null> {
  const { userId } = await clerkAuth();
  return userId;
}

export async function getCurrentWorkspaceId(): Promise<string | null> {
  const userId = await getCurrentUserId();
  if (!userId) return null;

  const workspace = await getPrimaryWorkspace(userId);
  if (workspace) return workspace.id;

  const user = await syncClerkUser(userId);
  const createdWorkspace = await ensureWorkspaceForUser(userId, user?.email);
  return createdWorkspace.id;
}
