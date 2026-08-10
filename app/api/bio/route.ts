import { currentUser } from "@clerk/nextjs/server";
import { getCurrentUserId } from "@/lib/auth";
import {
  createBioLink,
  ensureBioProfile,
  listBioLinks,
  updateBioProfile,
} from "@/lib/bio-db";

function isWebUrl(value: string | null | undefined) {
  if (!value) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const user = await currentUser();
  const profile = await ensureBioProfile(userId, {
    displayName: user?.fullName,
    email: user?.primaryEmailAddress?.emailAddress,
    avatarUrl: user?.imageUrl,
  });
  return Response.json({ profile, links: await listBioLinks(userId) });
}

export async function POST(request: Request) {
  const userId = await getCurrentUserId();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await request.json()) as Record<string, unknown>;
  try {
    const profile = await updateBioProfile(userId, {
      slug: String(body.slug ?? ""),
      displayName: String(body.displayName ?? "").slice(0, 80),
      bio: String(body.bio ?? "").slice(0, 240),
      avatarUrl: body.avatarUrl ? String(body.avatarUrl) : null,
      theme: ["ember", "ink", "mint"].includes(String(body.theme)) ? String(body.theme) : "ember",
    });
    return Response.json({ profile });
  } catch (error) {
    const message = error instanceof Error && error.message.includes("UNIQUE")
      ? "That public URL is already taken."
      : error instanceof Error ? error.message : "Could not save profile.";
    return Response.json({ error: message }, { status: 400 });
  }
}

export async function PUT(request: Request) {
  const userId = await getCurrentUserId();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await request.json()) as Record<string, unknown>;
  const title = String(body.title ?? "").trim().slice(0, 80);
  const url = String(body.url ?? "").trim();
  const iosUrl = body.iosUrl ? String(body.iosUrl).trim() : null;
  const androidUrl = body.androidUrl ? String(body.androidUrl).trim() : null;
  if (!title || !isWebUrl(url) || !isWebUrl(iosUrl) || !isWebUrl(androidUrl)) {
    return Response.json({ error: "Add a title and valid http(s) links." }, { status: 400 });
  }
  const id = await createBioLink(userId, {
    title,
    url,
    icon: String(body.icon ?? "link").slice(0, 24),
    smartAppLink: Boolean(body.smartAppLink),
    iosUrl,
    androidUrl,
  });
  return Response.json({ id }, { status: 201 });
}
