import { getCurrentUserId, getCurrentProfile } from "@/lib/auth";
import {
  createBioLink,
  createBioPage,
  getOwnedBioProfile,
  listBioProfiles,
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

export async function GET(request: Request) {
  const userId = await getCurrentUserId();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const user = await getCurrentProfile();
  await ensureBioProfile(userId, {
    displayName: user.name,
    email: user.email,
    avatarUrl: user.image,
  });
  const profileId = new URL(request.url).searchParams.get("profileId") ?? userId;
  const profile = await getOwnedBioProfile(userId, profileId);
  if (!profile) return Response.json({ error: "Page not found" }, { status: 404 });
  return Response.json({ profile, profiles: await listBioProfiles(userId), links: await listBioLinks(userId, profileId) }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  const userId = await getCurrentUserId();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await request.json()) as Record<string, unknown>;
  try {
    if (body.action === "createPage") {
      const user = await getCurrentProfile();
      await ensureBioProfile(userId, { displayName: user.name, email: user.email, avatarUrl: user.image });
      const profile = await createBioPage(userId, { slug: String(body.slug ?? ""), displayName: String(body.displayName ?? "") });
      return Response.json({ profile, profiles: await listBioProfiles(userId), links: [] }, { status: 201 });
    }
    const profileId = typeof body.profileId === "string" ? body.profileId : userId;
    if (!await getOwnedBioProfile(userId, profileId)) return Response.json({ error: "Page not found" }, { status: 404 });
    const profile = await updateBioProfile(userId, {
      slug: String(body.slug ?? ""),
      displayName: String(body.displayName ?? "").slice(0, 80),
      bio: String(body.bio ?? "").slice(0, 240),
      avatarUrl: body.avatarUrl ? String(body.avatarUrl) : null,
      theme: ["ember", "ink", "mint"].includes(String(body.theme)) ? String(body.theme) : "ember",
    }, profileId);
    return Response.json({ profile, profiles: await listBioProfiles(userId) });
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
  if (!title || !url || !isWebUrl(url) || !isWebUrl(iosUrl) || !isWebUrl(androidUrl)) {
    return Response.json({ error: "Add a title and valid http(s) links." }, { status: 400 });
  }
  const profileId = typeof body.profileId === "string" ? body.profileId : userId;
  if (!await getOwnedBioProfile(userId, profileId)) return Response.json({ error: "Page not found" }, { status: 404 });
  const id = await createBioLink(userId, {
    title,
    url,
    icon: String(body.icon ?? "link").slice(0, 24),
    smartAppLink: Boolean(body.smartAppLink),
    iosUrl,
    androidUrl,
  }, profileId);
  return Response.json({ id }, { status: 201 });
}
