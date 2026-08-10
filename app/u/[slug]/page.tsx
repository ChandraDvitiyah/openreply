import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPublicBio, recordBioProfileView } from "@/lib/bio-db";
import { hashClickIp } from "@/lib/tracking/server";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const data = await getPublicBio(slug);
  if (!data) return { title: "Page not found — Kult" };
  return {
    title: `${data.profile.displayName} — Links`,
    description: data.profile.bio,
  };
}

const themes = {
  ember: { page: "bg-[#f4efe6] text-[#17120f]", avatar: "bg-[#ff5c35]", muted: "text-[#6d625b]", card: "bg-white" },
  ink: { page: "bg-[#101114] text-white", avatar: "bg-[#7371fc]", muted: "text-white/60", card: "bg-white/10 border border-white/10" },
  mint: { page: "bg-[#dff7ea] text-[#123528]", avatar: "bg-[#176b4d]", muted: "text-[#3e6858]", card: "bg-white/70" },
} as const;

export default async function PublicBioPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const data = await getPublicBio(slug);
  if (!data) notFound();
  const requestHeaders = await headers();
  const forwardedFor = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim();
  await recordBioProfileView(data.profile.ownerId, {
    visitorHash: forwardedFor ? hashClickIp(forwardedFor) : null,
    userAgent: requestHeaders.get("user-agent"),
    referrer: requestHeaders.get("referer"),
  });
  const theme = themes[data.profile.theme as keyof typeof themes] ?? themes.ember;

  return (
    <main className={`min-h-screen px-5 py-12 sm:py-16 ${theme.page}`}>
      <div className="mx-auto max-w-xl">
        <div className={`mx-auto h-24 w-24 overflow-hidden rounded-full ${theme.avatar}`}>
          {data.profile.avatarUrl ? (
            <img className="h-full w-full object-cover" src={data.profile.avatarUrl} alt={data.profile.displayName} />
          ) : (
            <div className="grid h-full place-items-center text-3xl font-bold text-white">{data.profile.displayName.slice(0, 1).toUpperCase()}</div>
          )}
        </div>
        <h1 className="mt-6 text-center text-3xl font-bold tracking-[-.035em]">{data.profile.displayName}</h1>
        <p className={`mx-auto mt-3 max-w-md text-center leading-7 ${theme.muted}`}>{data.profile.bio}</p>
        <div className="mt-10 space-y-3">
          {data.links.map((link) => (
            <a key={link.id} href={`/go/${link.id}`} className={`group flex min-h-16 items-center justify-between rounded-2xl px-5 py-4 font-semibold shadow-sm transition-transform hover:-translate-y-0.5 ${theme.card}`}>
              <span>{link.title}</span>
              <span className="transition-transform group-hover:translate-x-0.5">↗</span>
            </a>
          ))}
        </div>
        <Link href="/" className={`mx-auto mt-12 flex w-fit items-center gap-2 text-xs font-semibold ${theme.muted}`}>
          <span className="brand-mark !h-5 !w-5 !rounded-md text-[10px]">K</span> Made with Kult
        </Link>
      </div>
    </main>
  );
}
