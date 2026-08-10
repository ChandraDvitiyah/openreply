"use client";

import { useEffect, useState } from "react";
import type { AccountOption } from "@/components/account-select";
import { FormLoadingSkeleton } from "@/components/dashboard-loading-skeleton";
import { useDashboardDataCache } from "@/components/dashboard-data-cache";

interface SettingsData {
  workspace: {
    name: string;
    dmsSentThisPeriod: number;
  };
  instagramAccount: {
    id: string;
    username: string;
    instagramId: string;
    tokenExpiresAt: string | null;
    webhookSubscribed: boolean;
  } | null;
  instagramAccounts: Array<
    AccountOption & {
      tokenExpiresAt: string | null;
      webhookSubscribed: boolean;
    }
  >;
}

interface WorkspaceMembersData {
  currentUserRole: "OWNER" | "ADMIN" | "MEMBER";
  members: Array<{
    id: string;
    role: "OWNER" | "ADMIN" | "MEMBER";
    createdAt: string;
    user: {
      id: string;
      email: string | null;
      name: string | null;
    };
  }>;
  invitations: Array<{
    id: string;
    email: string;
    role: "OWNER" | "ADMIN" | "MEMBER";
    inviteUrl: string;
    expiresAt: string;
  }>;
}

interface FacebookPageData {
  id: string;
  pageId: string;
  name: string;
  webhookSubscribed: boolean;
  connectedAt: string;
}

interface UserProfileData {
  name: string;
  email: string | null;
}

type SettingsPageCache = {
  data: SettingsData | null;
  membersData: WorkspaceMembersData | null;
  facebookPages: FacebookPageData[];
  profile: UserProfileData | null;
};

export default function SettingsPage() {
  const dataCache = useDashboardDataCache();
  const [data, setData] = useState<SettingsData | null>(() => dataCache.get<SettingsPageCache>("settings")?.data ?? null);
  const [membersData, setMembersData] = useState<WorkspaceMembersData | null>(
    () => dataCache.get<SettingsPageCache>("settings")?.membersData ?? null
  );
  const [loading, setLoading] = useState(() => dataCache.get("settings") === null);
  const [busy, setBusy] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"ADMIN" | "MEMBER">("MEMBER");
  const [memberError, setMemberError] = useState<string | null>(null);
  const [facebookPages, setFacebookPages] = useState<FacebookPageData[]>(() => dataCache.get<SettingsPageCache>("settings")?.facebookPages ?? []);
  const [profile, setProfile] = useState<UserProfileData | null>(() => dataCache.get<SettingsPageCache>("settings")?.profile ?? null);
  const [displayName, setDisplayName] = useState(() => dataCache.get<SettingsPageCache>("settings")?.profile?.name ?? "");
  const [profileMessage, setProfileMessage] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/dashboard/stats", { cache: "no-store" }).then((res) => res.json()),
      fetch("/api/workspace/members", { cache: "no-store" }).then((res) => res.json()),
      fetch("/api/user/profile", { cache: "no-store" }).then((res) => res.json()),
      fetch("/api/facebook/pages", { cache: "no-store" }).then((res) => res.json()),
    ])
      .then(([statsPayload, membersPayload, profilePayload, facebookPayload]) => {
        if (statsPayload.success) setData(statsPayload.data);
        if (membersPayload.success) setMembersData(membersPayload.data);
        if (profilePayload.success) {
          setProfile(profilePayload.data);
          setDisplayName(profilePayload.data.name);
        }
        if (facebookPayload.success) setFacebookPages(facebookPayload.data.pages);
        dataCache.set("settings", {
          data: statsPayload.success ? statsPayload.data : null,
          membersData: membersPayload.success ? membersPayload.data : null,
          facebookPages: facebookPayload.success ? facebookPayload.data.pages : [],
          profile: profilePayload.success ? profilePayload.data : null,
        });
      })
      .finally(() => setLoading(false));
  }, [dataCache]);

  async function refreshMembers() {
    const res = await fetch("/api/workspace/members");
    const payload = await res.json();
    if (payload.success) setMembersData(payload.data);
  }

  async function disconnectInstagram(instagramAccountId: string) {
    if (!confirm("Disconnect Instagram? Campaigns for this account will stop sending DMs.")) {
      return;
    }

    setBusy(`disconnect:${instagramAccountId}`);
    await fetch("/api/instagram/disconnect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instagramAccountId }),
    });
    window.location.reload();
  }

  async function disconnectFacebook(facebookPageId: string) {
    if (!confirm("Disconnect this Facebook Page? Its Messenger automations will be deleted.")) {
      return;
    }
    setBusy(`facebook:${facebookPageId}`);
    await fetch("/api/facebook/disconnect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ facebookPageId }),
    });
    setFacebookPages((current) => current.filter((page) => page.id !== facebookPageId));
    setBusy(null);
  }

  async function inviteMember(event: React.FormEvent) {
    event.preventDefault();
    setMemberError(null);
    setBusy("invite");
    const res = await fetch("/api/workspace/members", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
    });
    const payload = await res.json();
    if (payload.success) {
      setMembersData(payload.data);
      setInviteEmail("");
    } else {
      setMemberError(payload.error ?? "Could not invite member");
    }
    setBusy(null);
  }

  async function removeInvitation(invitationId: string) {
    setBusy(`invite:${invitationId}`);
    await fetch("/api/workspace/members", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ invitationId }),
    });
    await refreshMembers();
    setBusy(null);
  }

  async function saveProfile(event: React.FormEvent) {
    event.preventDefault();
    setBusy("profile");
    setProfileMessage(null);
    const response = await fetch("/api/user/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: displayName }),
    });
    const payload = await response.json();
    if (payload.success) {
      setProfile(payload.data);
      setDisplayName(payload.data.name);
      setProfileMessage("Name updated");
      await refreshMembers();
    } else {
      setProfileMessage(payload.error ?? "Could not update your name");
    }
    setBusy(null);
  }

  if (loading) {
    return <FormLoadingSkeleton />;
  }

  const accounts = data?.instagramAccounts ?? [];
  const canManageMembers =
    membersData?.currentUserRole === "OWNER" ||
    membersData?.currentUserRole === "ADMIN";

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <section className="panel rounded p-6">
        <h2 className="mb-1 text-base font-semibold">Your profile</h2>
        <p className="mb-6 text-xs text-muted">
          This name appears in your dashboard and team member list.
        </p>
        <form onSubmit={saveProfile} className="space-y-4">
          <label className="block">
            <span className="field-label">Name</span>
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              className="field mt-2"
              maxLength={80}
              autoComplete="name"
              required
            />
          </label>
          <div>
            <p className="text-xs text-muted">Email</p>
            <p className="mt-1 text-sm text-foreground">{profile?.email ?? "—"}</p>
          </div>
          <div className="flex items-center gap-3 border-t border-border pt-4">
            <button
              type="submit"
              disabled={busy === "profile" || !displayName.trim()}
              className="button-primary disabled:opacity-50"
            >
              {busy === "profile" ? "Saving…" : "Save name"}
            </button>
            {profileMessage && (
              <p className={`text-xs ${profileMessage === "Name updated" ? "text-success" : "text-error"}`}>
                {profileMessage}
              </p>
            )}
          </div>
        </form>
      </section>

      <section className="panel rounded p-6">
        <h2 className="text-base font-semibold mb-6">Instagram Connection</h2>

        <div className="space-y-4">
          <div className="flex items-center justify-between py-3 border-b border-border">
            <div>
              <p className="text-sm font-medium text-foreground">Status</p>
              <p className="text-xs text-muted mt-0.5">
                Comment webhooks and private replies depend on this connection.
              </p>
            </div>
            <span
              className={`px-3 py-1.5 rounded-full text-xs font-medium ${
                accounts.length > 0
                  ? "bg-success/10 text-success"
                  : "bg-warning/10 text-warning"
              }`}
            >
              {accounts.length > 0 ? "Connected" : "Not connected"}
            </span>
          </div>

          <div className="flex items-center justify-between py-3 border-b border-border">
            <div>
              <p className="text-sm font-medium text-foreground">Accounts</p>
              <p className="text-xs text-muted mt-0.5">
                {accounts.length} connected Instagram profile
                {accounts.length === 1 ? "" : "s"}
              </p>
            </div>
            <span className="text-sm text-muted">
              {accounts.length > 0 ? `${accounts.length} connected` : "None"}
            </span>
          </div>

          <div className="space-y-3 py-3">
            {accounts.length === 0 && (
              <p className="text-sm text-muted">
                Connect an Instagram professional account to launch campaigns.
              </p>
            )}
            {accounts.map((account) => (
              <div
                key={account.id}
                className="flex flex-col gap-3 rounded border border-border bg-surface/70 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    @{account.username}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    Token expires{" "}
                    {account.tokenExpiresAt
                      ? new Date(account.tokenExpiresAt).toLocaleDateString()
                      : "not available"}{" "}
                    · {account.webhookSubscribed ? "Webhook ready" : "Webhook pending"}
                  </p>
                </div>
                <button
                  onClick={() => disconnectInstagram(account.id)}
                  disabled={busy === `disconnect:${account.id}`}
                  className="inline-flex items-center justify-center rounded border border-error/20 px-4 py-2 text-sm font-medium text-error transition-all hover:border-error/40 hover:bg-error/10 disabled:opacity-50"
                >
                  {busy === `disconnect:${account.id}`
                    ? "Disconnecting..."
                    : "Disconnect"}
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-6 pt-4 border-t border-border flex gap-3">
          <a
            href="/api/instagram/connect"
            className="button-primary"
          >
            {accounts.length > 0 ? "Connect another account" : "Connect Instagram"}
          </a>
        </div>
      </section>

      <section className="panel rounded-[30px] p-6 lg:p-8">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">
              Facebook channel
            </p>
            <h2 className="display-title mt-2 text-5xl">Messenger Connection</h2>
            <p className="mt-3 max-w-xl text-sm text-muted">
              Connect every Facebook Page you manage. Kult subscribes messages,
              button postbacks, and Page-feed comments through Meta&apos;s official API.
            </p>
          </div>
          <a href="/api/facebook/connect" className="button-primary shrink-0">
            {facebookPages.length ? "Sync Facebook Pages" : "Connect Facebook"}
          </a>
        </div>

        <div className="mt-6 space-y-3">
          {facebookPages.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border p-5 text-sm text-muted">
              No Facebook Pages connected yet. Facebook access is separate from
              Instagram Login even when both products live in the same Meta app.
            </div>
          ) : (
            facebookPages.map((page) => (
              <div
                key={page.id}
                className="flex flex-col gap-4 rounded-2xl border border-border bg-background p-5 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="font-semibold text-foreground">{page.name}</p>
                  <p className="mt-1 text-xs text-muted">
                    Page ID {page.pageId} · {page.webhookSubscribed ? "Webhook ready" : "Webhook pending"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => disconnectFacebook(page.id)}
                  disabled={busy === `facebook:${page.id}`}
                  className="rounded-xl border border-error/20 px-4 py-2 text-sm font-semibold text-error hover:bg-error/10 disabled:opacity-50"
                >
                  {busy === `facebook:${page.id}` ? "Disconnecting…" : "Disconnect"}
                </button>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="panel rounded p-6">
        <h2 className="text-base font-semibold mb-6">Team</h2>
        <div className="space-y-3">
          {membersData?.members.map((member) => (
            <div
              key={member.id}
              className="flex items-center justify-between gap-4 border-b border-border py-3 last:border-0"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">
                  {member.user.name ?? member.user.email ?? "Unknown member"}
                </p>
                <p className="text-xs text-muted">{member.user.email}</p>
              </div>
              <span className="rounded-full border border-border px-3 py-1 text-xs font-semibold text-muted">
                {member.role}
              </span>
            </div>
          ))}
        </div>

        {membersData?.invitations.length ? (
          <div className="mt-6 border-t border-border pt-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Pending invites
            </p>
            <div className="space-y-3">
              {membersData.invitations.map((invitation) => (
                <div
                  key={invitation.id}
                  className="flex flex-col gap-3 rounded border border-border bg-surface/70 p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {invitation.email}
                    </p>
                    <p className="truncate text-xs text-muted">
                      {invitation.role} · {invitation.inviteUrl}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        void navigator.clipboard?.writeText(invitation.inviteUrl)
                      }
                      className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-border-hover hover:text-foreground"
                    >
                      Copy
                    </button>
                    <button
                      type="button"
                      onClick={() => removeInvitation(invitation.id)}
                      disabled={busy === `invite:${invitation.id}`}
                      className="rounded-lg border border-error/20 px-3 py-1.5 text-xs font-medium text-error transition-colors hover:bg-error/10 disabled:opacity-50"
                    >
                      Revoke
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {canManageMembers && (
          <form
            onSubmit={inviteMember}
            className="mt-6 grid gap-3 border-t border-border pt-4 sm:grid-cols-[1fr_140px_auto]"
          >
            <input
              type="email"
              value={inviteEmail}
              onChange={(event) => setInviteEmail(event.target.value)}
              placeholder="teammate@agency.com"
              className="rounded border border-border bg-surface px-4 py-2 text-sm text-foreground outline-none transition-colors focus:border-accent/40"
              required
            />
            <select
              value={inviteRole}
              onChange={(event) =>
                setInviteRole(event.target.value as "ADMIN" | "MEMBER")
              }
              className="rounded border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-accent/40"
            >
              <option value="MEMBER">Member</option>
              <option value="ADMIN">Admin</option>
            </select>
            <button
              type="submit"
              disabled={busy === "invite"}
              className="button-primary disabled:opacity-50"
            >
              {busy === "invite" ? "Inviting..." : "Invite"}
            </button>
            {memberError && (
              <p className="sm:col-span-3 text-sm text-error">{memberError}</p>
            )}
          </form>
        )}
      </section>

      <section className="panel rounded p-6">
        <h2 className="text-base font-semibold mb-6">Usage</h2>
        <div className="flex items-center justify-between py-3">
          <div>
            <p className="text-sm font-medium text-foreground">
              DMs sent this month
            </p>
            <p className="text-xs text-muted mt-0.5">
              Self-hosted — no plan limits.
            </p>
          </div>
          <span className="text-sm font-semibold text-foreground">
            {data?.workspace?.dmsSentThisPeriod ?? 0}
          </span>
        </div>
      </section>
    </div>
  );
}
