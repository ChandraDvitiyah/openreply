"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DetailLoadingSkeleton } from "@/components/dashboard-loading-skeleton";
import { useDashboardDataCache } from "@/components/dashboard-data-cache";

type FacebookPage = {
  id: string;
  pageId: string;
  name: string;
  webhookSubscribed: boolean;
};

type FacebookAutomation = {
  id: string;
  name: string;
  type: "MESSENGER_AUTORESPONDER" | "COMMENT_TO_MESSAGE";
  keywords: string[];
  matchAnyWord: boolean;
  replyMessage: string;
  postId: string | null;
  matchAnyPost: boolean;
  isActive: boolean;
  facebookPage: { name: string };
  _count: { messageLogs: number };
};

type FacebookLog = {
  id: string;
  triggerType: "MESSAGE" | "COMMENT";
  triggerText: string;
  senderName: string | null;
  status: string;
  createdAt: string;
  facebookPage: { name: string };
  automation: { name: string };
};

type FacebookPageData = {
  pages: FacebookPage[];
  automations: FacebookAutomation[];
  logs: FacebookLog[];
};

export default function FacebookPageAutomation() {
  const dataCache = useDashboardDataCache();
  const [pages, setPages] = useState<FacebookPage[]>(() => dataCache.get<FacebookPageData>("facebook")?.pages ?? []);
  const [automations, setAutomations] = useState<FacebookAutomation[]>(() => dataCache.get<FacebookPageData>("facebook")?.automations ?? []);
  const [logs, setLogs] = useState<FacebookLog[]>(() => dataCache.get<FacebookPageData>("facebook")?.logs ?? []);
  const [loading, setLoading] = useState(() => dataCache.get("facebook") === null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pageId, setPageId] = useState("");
  const [type, setType] = useState<FacebookAutomation["type"]>(
    "MESSENGER_AUTORESPONDER"
  );
  const [name, setName] = useState("");
  const [keywords, setKeywords] = useState("");
  const [matchAnyWord, setMatchAnyWord] = useState(false);
  const [matchAnyPost, setMatchAnyPost] = useState(true);
  const [postId, setPostId] = useState("");
  const [replyMessage, setReplyMessage] = useState("");

  const refresh = useCallback(async () => {
    const [pagesResponse, automationsResponse] = await Promise.all([
      fetch("/api/facebook/pages", { cache: "no-store" }),
      fetch("/api/facebook/automations", { cache: "no-store" }),
    ]);
    const pagesPayload = await pagesResponse.json();
    const automationsPayload = await automationsResponse.json();
    if (pagesPayload.success) {
      setPages(pagesPayload.data.pages);
      setPageId((current) => current || pagesPayload.data.pages[0]?.id || "");
    }
    if (automationsPayload.success) {
      setAutomations(automationsPayload.data.automations);
      setLogs(automationsPayload.data.logs);
    }
    if (pagesPayload.success && automationsPayload.success) {
      dataCache.set("facebook", {
        pages: pagesPayload.data.pages,
        automations: automationsPayload.data.automations,
        logs: automationsPayload.data.logs,
      });
    }
    setLoading(false);
  }, [dataCache]);

  useEffect(() => {
    // Initial remote hydration is intentionally performed once on mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const sentCount = useMemo(
    () => logs.filter((log) => log.status === "SENT").length,
    [logs]
  );

  async function createAutomation(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const response = await fetch("/api/facebook/automations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        facebookPageId: pageId,
        type,
        name,
        keywords: keywords.split(",").map((item) => item.trim()).filter(Boolean),
        matchAnyWord,
        replyMessage,
        matchAnyPost,
        postId: matchAnyPost ? null : postId,
        wholeWordMatch: true,
        isActive: true,
      }),
    });
    const payload = await response.json();
    if (!payload.success) setError(payload.error ?? "Could not create automation");
    else {
      setName("");
      setKeywords("");
      setReplyMessage("");
      setPostId("");
      await refresh();
    }
    setSaving(false);
  }

  async function toggleAutomation(automation: FacebookAutomation) {
    await fetch(`/api/facebook/automations?id=${automation.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !automation.isActive }),
    });
    await refresh();
  }

  async function removeAutomation(id: string) {
    if (!confirm("Delete this Facebook automation?")) return;
    await fetch(`/api/facebook/automations?id=${id}`, { method: "DELETE" });
    await refresh();
  }

  if (loading) return <DetailLoadingSkeleton />;

  return (
    <div className="space-y-10">
      <section className="rounded-[30px] bg-[#044340] p-8 text-[#f5f4ee] lg:p-10">
        <p className="text-sm uppercase tracking-[0.18em] text-[#9ce069]">Facebook channel</p>
        <div className="mt-4 grid gap-8 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <h1 className="display-title max-w-3xl text-6xl leading-[0.9] lg:text-8xl">
              Messenger, on autopilot.
            </h1>
            <p className="mt-5 max-w-2xl text-lg text-white/70">
              Reply to Page messages and turn Facebook post comments into private conversations.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {[['Pages', pages.length], ['Flows', automations.length], ['Sent', sentCount]].map(([label, value]) => (
              <div key={label} className="min-w-24 rounded-2xl bg-white/10 p-4 text-center">
                <p className="text-2xl font-semibold text-[#9ce069]">{value}</p>
                <p className="mt-1 text-xs text-white/60">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {pages.length === 0 ? (
        <section className="panel rounded-[30px] p-8 text-center">
          <h2 className="display-title text-5xl">Connect a Facebook Page</h2>
          <p className="mx-auto mt-4 max-w-lg text-muted">
            Grant Kult access to the Pages you manage, then create Messenger and comment automations here.
          </p>
          <a href="/api/facebook/connect" className="button-primary mt-6 inline-flex">
            Connect Facebook Pages
          </a>
        </section>
      ) : (
        <div className="grid gap-8 xl:grid-cols-[0.9fr_1.1fr]">
          <form onSubmit={createAutomation} className="panel rounded-[30px] p-6 lg:p-8">
            <p className="text-sm uppercase tracking-[0.18em] text-muted">New automation</p>
            <h2 className="display-title mt-2 text-5xl">Build the reply</h2>
            <div className="mt-8 space-y-5">
              <label className="field-label">Facebook Page
                <select value={pageId} onChange={(event) => setPageId(event.target.value)} className="field mt-2">
                  {pages.map((page) => <option key={page.id} value={page.id}>{page.name}</option>)}
                </select>
              </label>
              <label className="field-label">Flow type
                <select value={type} onChange={(event) => setType(event.target.value as FacebookAutomation["type"])} className="field mt-2">
                  <option value="MESSENGER_AUTORESPONDER">Inbound Messenger auto-reply</option>
                  <option value="COMMENT_TO_MESSAGE">Post comment → private reply</option>
                </select>
              </label>
              <label className="field-label">Automation name
                <input value={name} onChange={(event) => setName(event.target.value)} className="field mt-2" placeholder="Lead magnet replies" required />
              </label>
              {type === "COMMENT_TO_MESSAGE" && (
                <div className="rounded-2xl border border-border p-4">
                  <label className="flex items-center gap-3 text-sm font-medium">
                    <input type="checkbox" checked={matchAnyPost} onChange={(event) => setMatchAnyPost(event.target.checked)} />
                    Match comments on every Page post
                  </label>
                  {!matchAnyPost && <input value={postId} onChange={(event) => setPostId(event.target.value)} className="field mt-4" placeholder="Facebook post ID" required />}
                </div>
              )}
              <div className="rounded-2xl border border-border p-4">
                <label className="flex items-center gap-3 text-sm font-medium">
                  <input type="checkbox" checked={matchAnyWord} onChange={(event) => setMatchAnyWord(event.target.checked)} />
                  Reply to every {type === "COMMENT_TO_MESSAGE" ? "comment" : "message"}
                </label>
                {!matchAnyWord && <input value={keywords} onChange={(event) => setKeywords(event.target.value)} className="field mt-4" placeholder="price, link, details" required />}
              </div>
              <label className="field-label">Private reply
                <textarea value={replyMessage} onChange={(event) => setReplyMessage(event.target.value)} className="field mt-2 min-h-32" placeholder="Hey {name}, here are the details…" required />
              </label>
              {error && <p className="text-sm text-error">{error}</p>}
              <button disabled={saving} className="button-primary w-full justify-center disabled:opacity-50">
                {saving ? "Creating…" : "Create Facebook automation"}
              </button>
            </div>
          </form>

          <div className="space-y-8">
            <section className="panel rounded-[30px] p-6 lg:p-8">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm uppercase tracking-[0.18em] text-muted">Live flows</p>
                  <h2 className="display-title mt-2 text-5xl">Automations</h2>
                </div>
                <a href="/api/facebook/connect" className="button-secondary">Sync Pages</a>
              </div>
              <div className="mt-6 space-y-3">
                {automations.length === 0 && <p className="rounded-2xl bg-background p-5 text-sm text-muted">No Facebook automations yet.</p>}
                {automations.map((automation) => (
                  <article key={automation.id} className="rounded-2xl border border-border bg-background p-5">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <p className="font-semibold">{automation.name}</p>
                        <p className="mt-1 text-sm text-muted">{automation.facebookPage.name} · {automation.type === "COMMENT_TO_MESSAGE" ? "Comment → private reply" : "Messenger auto-reply"}</p>
                        <p className="mt-3 text-sm">{automation.matchAnyWord ? "Any message/comment" : automation.keywords.join(", ")}</p>
                      </div>
                      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${automation.isActive ? "bg-[#9ce069] text-black" : "bg-border text-muted"}`}>{automation.isActive ? "Live" : "Paused"}</span>
                    </div>
                    <div className="mt-4 flex gap-2 border-t border-border pt-4">
                      <button onClick={() => toggleAutomation(automation)} className="button-secondary">{automation.isActive ? "Pause" : "Resume"}</button>
                      <button onClick={() => removeAutomation(automation.id)} className="rounded-xl px-4 py-2 text-sm font-semibold text-error hover:bg-error/10">Delete</button>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section className="panel rounded-[30px] p-6 lg:p-8">
              <p className="text-sm uppercase tracking-[0.18em] text-muted">Latest activity</p>
              <h2 className="display-title mt-2 text-5xl">Delivery log</h2>
              <div className="mt-6 space-y-3">
                {logs.length === 0 && <p className="text-sm text-muted">Facebook deliveries will appear here.</p>}
                {logs.map((log) => (
                  <div key={log.id} className="flex items-start justify-between gap-4 border-b border-border py-3 last:border-0">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{log.senderName ?? "Facebook user"} · {log.automation.name}</p>
                      <p className="mt-1 truncate text-xs text-muted">{log.triggerText}</p>
                    </div>
                    <span className="text-xs font-semibold text-muted">{log.status}</span>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
