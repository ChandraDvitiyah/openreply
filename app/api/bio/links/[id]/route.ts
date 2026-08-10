import { getCurrentUserId } from "@/lib/auth";
import { deleteBioLink, updateBioLink } from "@/lib/bio-db";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getCurrentUserId();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = (await request.json()) as Record<string, unknown>;
  const ok = await updateBioLink(userId, id, {
    ...(typeof body.title === "string" ? { title: body.title.trim().slice(0, 80) } : {}),
    ...(typeof body.url === "string" ? { url: body.url.trim() } : {}),
    ...(typeof body.icon === "string" ? { icon: body.icon.slice(0, 24) } : {}),
    ...(typeof body.enabled === "boolean" ? { enabled: body.enabled } : {}),
    ...(typeof body.smartAppLink === "boolean" ? { smartAppLink: body.smartAppLink } : {}),
    ...(typeof body.iosUrl === "string" || body.iosUrl === null ? { iosUrl: body.iosUrl } : {}),
    ...(typeof body.androidUrl === "string" || body.androidUrl === null ? { androidUrl: body.androidUrl } : {}),
    ...(typeof body.position === "number" ? { position: body.position } : {}),
  });
  return ok
    ? Response.json({ ok: true })
    : Response.json({ error: "Link not found" }, { status: 404 });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getCurrentUserId();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const ok = await deleteBioLink(userId, id);
  return ok
    ? Response.json({ ok: true })
    : Response.json({ error: "Link not found" }, { status: 404 });
}
