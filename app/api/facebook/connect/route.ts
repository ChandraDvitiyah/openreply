import { NextResponse } from "next/server";
import { createOAuthState } from "@/lib/meta/oauth";
import { getFacebookAuthorizationUrl } from "@/lib/meta/facebook";
import {
  canManageWorkspace,
  getCurrentWorkspaceContext,
} from "@/lib/workspace-access";
import { getBaseUrl } from "@/lib/env";

export async function GET() {
  const context = await getCurrentWorkspaceContext();
  if (!context) return NextResponse.redirect(`${getBaseUrl()}/login`);
  if (!canManageWorkspace(context.role)) {
    return NextResponse.redirect(`${getBaseUrl()}/settings?facebook=forbidden`);
  }
  const state = createOAuthState(context.workspaceId);
  return NextResponse.redirect(getFacebookAuthorizationUrl(state));
}
