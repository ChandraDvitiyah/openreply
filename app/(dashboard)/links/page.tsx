import { redirect } from "next/navigation";
import { currentUser } from "@clerk/nextjs/server";
import LinkStudio from "@/components/link-studio";
import { getCurrentUserId } from "@/lib/auth";
import { ensureBioProfile, listBioLinks } from "@/lib/bio-db";

export const dynamic = "force-dynamic";
export const metadata = { title: "Link Studio — Kult" };

export default async function LinksPage() {
  const userId = await getCurrentUserId();
  if (!userId) redirect("/login");
  const user = await currentUser();
  const profile = await ensureBioProfile(userId, {
    displayName: user?.fullName,
    email: user?.primaryEmailAddress?.emailAddress,
    avatarUrl: user?.imageUrl,
  });
  const links = await listBioLinks(userId);

  return (
    <div className="space-y-6">
      <div className="max-w-2xl">
        <p className="text-[12px] font-medium text-[#9e9e9e]">Link Studio</p>
        <h1 className="mt-2 text-[24px] font-medium text-[#292929]">
          One home for everything you build.
        </h1>
        <p className="mt-3 text-[13px] leading-6 text-[#5d5d5d]">
          Publish your apps, route visitors to the right store, and measure every click.
        </p>
      </div>
      <LinkStudio initialProfile={profile} initialLinks={links} />
    </div>
  );
}
