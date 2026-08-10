import { Suspense } from "react";
import { redirect } from "next/navigation";
import DashboardShell from "@/components/dashboard-shell";
import { DashboardShellLoadingSkeleton } from "@/components/dashboard-loading-skeleton";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { ensureWorkspaceForUser } from "@/lib/workspace";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Suspense fallback={<DashboardShellLoadingSkeleton />}>
      <AuthenticatedDashboardLayout>{children}</AuthenticatedDashboardLayout>
    </Suspense>
  );
}

async function AuthenticatedDashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const workspace = await ensureWorkspaceForUser(
    session.user.id,
    session.user.email
  );
  const accounts = await prisma.instagramAccount.findMany({
    where: { workspaceId: workspace.id },
    orderBy: { connectedAt: "desc" },
    select: { username: true },
  });

  return (
    <DashboardShell
      workspaceName={workspace.name}
      instagramUsername={accounts[0]?.username ?? null}
      instagramAccountCount={accounts.length}
    >
      {children}
    </DashboardShell>
  );
}
