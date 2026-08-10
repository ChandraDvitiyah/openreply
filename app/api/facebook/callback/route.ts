import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { getBaseUrl } from "@/lib/env";
import {
  exchangeFacebookCode,
  getLongLivedFacebookToken,
  getManagedFacebookPages,
  subscribeFacebookPage,
} from "@/lib/meta/facebook";
import { encryptToken, verifyOAuthState } from "@/lib/meta/oauth";
import { canManageWorkspace } from "@/lib/workspace-access";

export async function GET(request: NextRequest) {
  const baseUrl = getBaseUrl();
  const error = request.nextUrl.searchParams.get("error");
  const code = request.nextUrl.searchParams.get("code");
  const state = verifyOAuthState(request.nextUrl.searchParams.get("state"));
  if (error) return NextResponse.redirect(`${baseUrl}/settings?facebook=denied`);
  if (!code || !state) {
    return NextResponse.redirect(`${baseUrl}/settings?facebook=invalid`);
  }

  const session = await auth();
  if (!session?.user.id) return NextResponse.redirect(`${baseUrl}/login`);
  const membership = await prisma.workspaceMember.findFirst({
    where: { workspaceId: state.workspaceId, userId: session.user.id },
  });
  if (!membership || !canManageWorkspace(membership.role)) {
    return NextResponse.redirect(`${baseUrl}/settings?facebook=forbidden`);
  }

  try {
    const shortToken = await exchangeFacebookCode(code);
    const longToken = await getLongLivedFacebookToken(shortToken.access_token);
    const pages = await getManagedFacebookPages(longToken.access_token);
    if (pages.length === 0) {
      return NextResponse.redirect(`${baseUrl}/settings?facebook=no_pages`);
    }

    for (const page of pages) {
      let webhookSubscribed = false;
      try {
        const result = await subscribeFacebookPage(page.id, page.access_token);
        webhookSubscribed = Boolean(result.success);
      } catch (subscriptionError) {
        console.warn("[Facebook Callback] Page subscription failed", subscriptionError);
      }
      await prisma.facebookPage.upsert({
        where: { pageId: page.id },
        create: {
          workspaceId: state.workspaceId,
          pageId: page.id,
          name: page.name,
          accessToken: encryptToken(page.access_token),
          webhookSubscribed,
        },
        update: {
          workspaceId: state.workspaceId,
          name: page.name,
          accessToken: encryptToken(page.access_token),
          webhookSubscribed,
        },
      });
    }

    return NextResponse.redirect(
      `${baseUrl}/settings?facebook=connected&pages=${pages.length}`
    );
  } catch (callbackError) {
    console.error("[Facebook Callback] Error", callbackError);
    return NextResponse.redirect(`${baseUrl}/settings?facebook=failed`);
  }
}
