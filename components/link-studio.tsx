"use client";

import { useMemo, useState, useTransition } from "react";
import type { BioLink, BioProfile } from "@/lib/bio-db";

type StudioLink = BioLink & { clickCount: number };

export default function LinkStudio({
  initialProfile,
  initialLinks,
}: {
  initialProfile: BioProfile;
  initialLinks: StudioLink[];
}) {
  const [profile, setProfile] = useState(initialProfile);
  const [links, setLinks] = useState(initialLinks);
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const [newLink, setNewLink] = useState({
    title: "",
    url: "",
    smartAppLink: false,
    iosUrl: "",
    androidUrl: "",
  });

  const publicUrl = useMemo(() => `/u/${profile.slug}`, [profile.slug]);

  async function refresh() {
    const response = await fetch("/api/bio");
    const data = await response.json();
    if (response.ok) {
      setProfile(data.profile);
      setLinks(data.links);
    }
  }

  function saveProfile() {
    startTransition(async () => {
      setMessage("");
      const response = await fetch("/api/bio", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(profile),
      });
      const data = await response.json();
      if (!response.ok) return setMessage(data.error ?? "Could not save.");
      setProfile(data.profile);
      setMessage("Profile saved.");
    });
  }

  function addLink() {
    startTransition(async () => {
      setMessage("");
      const response = await fetch("/api/bio", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...newLink, icon: "arrow" }),
      });
      const data = await response.json();
      if (!response.ok) return setMessage(data.error ?? "Could not add link.");
      setNewLink({ title: "", url: "", smartAppLink: false, iosUrl: "", androidUrl: "" });
      await refresh();
      setMessage("Link added.");
    });
  }

  function toggleLink(link: StudioLink) {
    startTransition(async () => {
      await fetch(`/api/bio/links/${link.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: !link.enabled }),
      });
      await refresh();
    });
  }

  function removeLink(id: string) {
    startTransition(async () => {
      await fetch(`/api/bio/links/${id}`, { method: "DELETE" });
      await refresh();
      setMessage("Link removed.");
    });
  }

  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_390px]">
      <div className="space-y-6">
        <section className="rounded-[1.5rem] border border-border bg-surface p-6 sm:p-8">
          <div className="mb-6 flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[.22em] text-accent">Identity</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight">Your public page</h2>
            </div>
            <a className="rounded-full border border-border px-4 py-2 text-sm hover:border-border-hover" href={publicUrl} target="_blank">
              Open page ↗
            </a>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <label className="space-y-2 text-sm">
              <span className="text-muted">Display name</span>
              <input className="w-full rounded-xl border border-border bg-background px-4 py-3" value={profile.displayName} onChange={(e) => setProfile({ ...profile, displayName: e.target.value })} />
            </label>
            <label className="space-y-2 text-sm">
              <span className="text-muted">Public URL</span>
              <div className="flex overflow-hidden rounded-xl border border-border bg-background">
                <span className="border-r border-border px-3 py-3 text-muted">/u/</span>
                <input className="min-w-0 flex-1 bg-transparent px-3 py-3 outline-none" value={profile.slug} onChange={(e) => setProfile({ ...profile, slug: e.target.value })} />
              </div>
            </label>
            <label className="space-y-2 text-sm sm:col-span-2">
              <span className="text-muted">Bio</span>
              <textarea className="min-h-24 w-full resize-none rounded-xl border border-border bg-background px-4 py-3" maxLength={240} value={profile.bio} onChange={(e) => setProfile({ ...profile, bio: e.target.value })} />
            </label>
            <label className="space-y-2 text-sm">
              <span className="text-muted">Avatar URL</span>
              <input className="w-full rounded-xl border border-border bg-background px-4 py-3" placeholder="https://…" value={profile.avatarUrl ?? ""} onChange={(e) => setProfile({ ...profile, avatarUrl: e.target.value })} />
            </label>
            <label className="space-y-2 text-sm">
              <span className="text-muted">Theme</span>
              <select className="w-full rounded-xl border border-border bg-background px-4 py-3" value={profile.theme} onChange={(e) => setProfile({ ...profile, theme: e.target.value })}>
                <option value="ember">Ember</option>
                <option value="ink">Ink</option>
                <option value="mint">Mint</option>
              </select>
            </label>
          </div>
          <button disabled={isPending} onClick={saveProfile} className="button-primary mt-6 disabled:opacity-60">
            Save profile
          </button>
        </section>

        <section className="rounded-[1.5rem] border border-border bg-surface p-6 sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-[.22em] text-accent">Destination</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight">Add a link</h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <input aria-label="Link title" className="rounded-xl border border-border bg-background px-4 py-3" placeholder="My new app" value={newLink.title} onChange={(e) => setNewLink({ ...newLink, title: e.target.value })} />
            <input aria-label="Default link" className="rounded-xl border border-border bg-background px-4 py-3" placeholder="https://yourapp.com" value={newLink.url} onChange={(e) => setNewLink({ ...newLink, url: e.target.value })} />
          </div>
          <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-background p-4">
            <input className="mt-1" type="checkbox" checked={newLink.smartAppLink} onChange={(e) => setNewLink({ ...newLink, smartAppLink: e.target.checked })} />
            <span>
              <span className="block text-sm font-medium">Smart App Store link</span>
              <span className="mt-1 block text-xs leading-5 text-muted">Routes iOS and Android separately and handles Instagram’s iOS in-app browser.</span>
            </span>
          </label>
          {newLink.smartAppLink && (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <input aria-label="iOS App Store URL" className="rounded-xl border border-border bg-background px-4 py-3" placeholder="https://apps.apple.com/…" value={newLink.iosUrl} onChange={(e) => setNewLink({ ...newLink, iosUrl: e.target.value })} />
              <input aria-label="Google Play URL" className="rounded-xl border border-border bg-background px-4 py-3" placeholder="https://play.google.com/…" value={newLink.androidUrl} onChange={(e) => setNewLink({ ...newLink, androidUrl: e.target.value })} />
            </div>
          )}
          <button disabled={isPending} onClick={addLink} className="mt-5 rounded-full bg-foreground px-5 py-2.5 text-sm font-semibold text-background disabled:opacity-60">Add link</button>
        </section>

        <section className="space-y-3">
          {links.map((link) => (
            <article key={link.id} className="flex items-center gap-4 rounded-2xl border border-border bg-surface p-4 sm:p-5">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-background text-lg">↗</span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{link.title}</p>
                <p className="truncate text-sm text-muted">{link.url}</p>
              </div>
              <p className="hidden text-sm text-muted sm:block">{link.clickCount} clicks</p>
              <button onClick={() => toggleLink(link)} className={`rounded-full px-3 py-1.5 text-xs font-medium ${link.enabled ? "bg-success/10 text-success" : "bg-border text-muted"}`}>{link.enabled ? "Live" : "Hidden"}</button>
              <button aria-label={`Delete ${link.title}`} onClick={() => removeLink(link.id)} className="px-2 text-muted hover:text-error">×</button>
            </article>
          ))}
          {links.length === 0 && <div className="rounded-2xl border border-dashed border-border p-10 text-center text-muted">Your first link will appear here.</div>}
        </section>
        {message && <p aria-live="polite" className="text-sm text-muted">{message}</p>}
      </div>

      <aside className="xl:sticky xl:top-24 xl:self-start">
        <div className="mx-auto w-full max-w-[360px] rounded-[2.75rem] border-[8px] border-[#242426] bg-[#f4efe6] p-3 shadow-2xl shadow-black/50">
          <div className="min-h-[690px] rounded-[2.1rem] bg-[#f4efe6] px-6 py-10 text-[#17120f]">
            <div className="mx-auto h-20 w-20 overflow-hidden rounded-full bg-[#ff5c35]">
              {profile.avatarUrl ? <img className="h-full w-full object-cover" src={profile.avatarUrl} alt="" /> : <div className="grid h-full place-items-center text-2xl font-bold text-white">{profile.displayName.slice(0, 1).toUpperCase()}</div>}
            </div>
            <h3 className="mt-5 text-center text-2xl font-bold tracking-tight">{profile.displayName}</h3>
            <p className="mx-auto mt-2 max-w-[260px] text-center text-sm leading-6 text-[#6d625b]">{profile.bio}</p>
            <div className="mt-8 space-y-3">
              {links.filter((link) => link.enabled).map((link) => (
                <div key={link.id} className="flex items-center justify-between rounded-2xl bg-white px-4 py-4 text-sm font-semibold shadow-sm"><span>{link.title}</span><span>↗</span></div>
              ))}
            </div>
            <p className="mt-10 text-center text-xs font-medium text-[#8e8179]">Made with Kult</p>
          </div>
        </div>
      </aside>
    </div>
  );
}
