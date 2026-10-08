"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Copy,
  Plus,
  RefreshCw,
  Send,
  X,
  Image as ImageIcon,
} from "lucide-react";
import { localDateTime, toScheduledInstant } from "@/lib/scheduler/time";
import "./scheduler.css";
import { isPublicMediaUrl } from "@/lib/scheduler/media-url";
import {
  defaultPublishingOptions,
  inferMediaType,
  isStory,
  isVideo,
  kindLabels,
  readPublishingOptions,
  supportedKinds,
  type PostKind,
  type PublishingOptions,
} from "@/lib/scheduler/capabilities";
import SchedulerMedia from "./scheduler-media";
import SchedulerPreview from "./scheduler-preview";
import { postInputSchema } from "@/lib/scheduler/validation";

type Account = { id: string; platform: "INSTAGRAM" | "FACEBOOK"; name: string };
type Status =
  | "DRAFT"
  | "SCHEDULED"
  | "PUBLISHING"
  | "PUBLISHED"
  | "FAILED"
  | "CANCELLED"
  | "NEEDS_REVIEW";
type Post = {
  id: string;
  revision: number;
  title: string;
  caption: string;
  platform: Account["platform"];
  instagramAccountId: string | null;
  facebookPageId: string | null;
  accountName: string;
  kind: PostKind;
  publishingOptions: PublishingOptions;
  publishStartedAt?: string | null;
  mediaUrls: string[];
  deletedMediaCount?: number;
  timezone: string;
  scheduledAt: string | null;
  status: Status;
  lastError: string | null;
  externalPostId: string | null;
  publishedAt: string | null;
  attempts: number;
  availableAt: string | null;
};
type Data = {
  posts: Post[];
  accounts: Account[];
  workerHealthy: boolean;
  uploadEnabled: boolean;
  nextCursor: string | null;
  counts: Partial<Record<Status, number>>;
};
const labels: Record<Status, string> = {
  DRAFT: "Draft",
  SCHEDULED: "Scheduled",
  PUBLISHING: "Publishing",
  PUBLISHED: "Published",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
  NEEDS_REVIEW: "Check delivery",
};
const emptyForm = {
  title: "",
  caption: "",
  accountId: "",
  kind: "IMAGE" as Post["kind"],
  media: "",
  publishingOptions: { ...defaultPublishingOptions },
  timezone: "UTC",
  localTime: "",
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const payload = await response.json();
  if (!response.ok || !payload.success)
    throw new Error(payload.error || "Unable to connect. Please try again.");
  return payload.data as T;
}
function dayKey(date: Date) {
  return date.toISOString().slice(0, 10);
}
function calendarDays(month: string) {
  const first = new Date(`${month}-01T12:00:00Z`);
  first.setUTCDate(first.getUTCDate() - ((first.getUTCDay() + 6) % 7));
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(first);
    date.setUTCDate(first.getUTCDate() + index);
    return date;
  });
}

export default function Scheduler() {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [view, setView] = useState<"list" | "calendar">("list");
  const [filter, setFilter] = useState("");
  const [search, setSearch] = useState("");
  const [timezone, setTimezone] = useState("UTC");
  const [zones, setZones] = useState(["UTC"]);
  const [month, setMonth] = useState("");
  const [selectedDay, setSelectedDay] = useState("");
  const [editing, setEditing] = useState<Post | "new" | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [dirty, setDirty] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(0);
  const composer = useRef<HTMLHeadingElement>(null);
  const requestId = useRef(0);
  const createRequestId = useRef("");
  const days = month ? calendarDays(month) : [];
  const nextCursor = data?.nextCursor;
  const refresh = useCallback(
    async (append = false, quiet = false) => {
      if (!month) return;
      const currentRequest = ++requestId.current;
      if (!quiet) setLoading(true);
      try {
        const params = new URLSearchParams();
        if (filter) params.set("status", filter);
        if (search) params.set("search", search);
        if (view === "calendar") {
          const range = calendarDays(month);
          params.set(
            "start",
            new Date(range[0].getTime() - 2 * 86400_000).toISOString(),
          );
          params.set(
            "end",
            new Date(range[41].getTime() + 2 * 86400_000).toISOString(),
          );
        }
        if (append && nextCursor) params.set("cursor", nextCursor);
        const result = await request<Data>(`/api/scheduler?${params}`);
        if (currentRequest !== requestId.current) return;
        setData((previous) => ({
          ...result,
          posts: append
            ? [...(previous?.posts ?? []), ...result.posts]
            : result.posts,
        }));
        setError("");
      } catch (err) {
        if (currentRequest === requestId.current)
          setError(
            err instanceof Error ? err.message : "Unable to load posts.",
          );
      } finally {
        if (currentRequest === requestId.current) setLoading(false);
      }
    },
    [month, filter, search, view, nextCursor],
  );

  useEffect(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    // Browser timezone is read after hydration so the server/client match.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTimezone(zone);
    setMonth(localDateTime(new Date(), zone).slice(0, 7));
    setZones([
      ...new Set(["UTC", zone, ...Intl.supportedValuesOf("timeZone")]),
    ]);
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => void refresh(), 250);
    return () => clearTimeout(timer);
    // Pagination changes must not reset the loaded list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, filter, search, view]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (
        !busy &&
        !editing &&
        !data?.nextCursor &&
        document.visibilityState === "visible"
      )
        void refresh(false, true);
    }, 30_000);
    return () => clearInterval(timer);
  }, [refresh, busy, editing, data?.nextCursor]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  useEffect(() => {
    if (editing) composer.current?.focus();
  }, [editing]);

  const accounts = data?.accounts ?? [];
  const account = accounts.find((a) => a.id === form.accountId);
  const urls = form.media
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const limit = account?.platform === "FACEBOOK" ? 63206 : 2200;
  const visiblePosts = (data?.posts ?? []).filter(
    (post) =>
      view !== "calendar" ||
      !selectedDay ||
      (post.scheduledAt &&
        localDateTime(new Date(post.scheduledAt), timezone).startsWith(
          selectedDay,
        )),
  );
  function change(values: Partial<typeof form>) {
    setForm((current) => ({ ...current, ...values }));
    if (values.media !== undefined) setPreviewIndex(0);
    setDirty(true);
  }
  function open(post?: Post, date?: string) {
    if (dirty && !window.confirm("Discard your unsaved changes?")) return;
    if (uploading) return;
    setPreviewIndex(0);
    createRequestId.current = crypto.randomUUID();
    setEditing(post ?? "new");
    if (post) setZones((current) => [...new Set([...current, post.timezone])]);
    setDirty(false);
    setError("");
    setNotice("");
    setForm(
      post
        ? {
            title: post.title,
            caption: post.caption,
            kind: post.kind,
            publishingOptions: readPublishingOptions(post.publishingOptions),
            media: post.mediaUrls.join("\n"),
            accountId: post.instagramAccountId ?? post.facebookPageId ?? "",
            timezone: post.timezone,
            localTime: post.scheduledAt
              ? localDateTime(new Date(post.scheduledAt), post.timezone)
              : localDateTime(
                  new Date(new Date().getTime() + 3600_000),
                  post.timezone,
                ),
          }
        : {
            ...emptyForm,
            accountId: accounts[0]?.id ?? "",
            kind: accounts[0]?.platform === "FACEBOOK" ? "TEXT" : "IMAGE",
            timezone,
            localTime: date
              ? `${date}T09:00`
              : localDateTime(
                  new Date(new Date().getTime() + 3600_000),
                  timezone,
                ),
          },
    );
  }
  function close() {
    if (uploading) return;
    if (!dirty || window.confirm("Discard your unsaved changes?")) {
      setEditing(null);
      setDirty(false);
    }
  }
  async function save(intent: "draft" | "schedule" | "now") {
    if (busy || uploading) return;
    setError("");
    try {
      if (!account) throw new Error("Choose a connected account.");
      const post = {
        clientRequestId: createRequestId.current,
        title: form.title,
        caption: form.caption,
        platform: account.platform,
        accountId: form.accountId,
        kind: form.kind,
        mediaUrls: urls,
        publishingOptions: {
          ...form.publishingOptions,
          mediaTypes: urls.map(
            (url, i) =>
              form.publishingOptions.mediaTypes[i] ??
              (form.kind === "CAROUSEL"
                ? inferMediaType(url)
                : isVideo(form.kind)
                  ? "VIDEO"
                  : "IMAGE"),
          ),
        },
        timezone: form.timezone,
        scheduledAt:
          intent === "schedule"
            ? toScheduledInstant(form.localTime, form.timezone)
            : null,
        intent,
      };
      const valid = postInputSchema.safeParse(post);
      if (!valid.success)
        throw new Error(
          valid.error.issues[0]?.message ?? "Check your post content.",
        );
      if (
        intent === "now" &&
        !window.confirm(`Publish this post to ${account.name} now?`)
      )
        return;
      setBusy(true);
      const existing = editing && editing !== "new" ? editing : null;
      await request(
        existing ? `/api/scheduler/${existing.id}` : "/api/scheduler",
        {
          method: existing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            existing
              ? { revision: existing.revision, action: "save", post }
              : post,
          ),
        },
      );
      setEditing(null);
      setDirty(false);
      setNotice(
        intent === "draft"
          ? "Draft saved."
          : intent === "now"
            ? "Post queued for publishing. Delivery status will update here."
            : "Post scheduled. You can close Kult; the worker will publish it.",
      );
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save post.");
    } finally {
      setBusy(false);
    }
  }
  async function act(post: Post, action: string) {
    if (busy || uploading) return;
    if (
      action === "cancel" &&
      !window.confirm("Cancel this post? You can edit it to schedule it again.")
    )
      return;
    if (
      action === "retry" &&
      !window.confirm(`Retry publishing to ${post.accountName} now?`)
    )
      return;
    if (
      action.startsWith("confirm-") &&
      !window.confirm(
        action === "confirm-published"
          ? "Have you checked the social account and found this post? Mark it as published?"
          : "Have you checked the social account and confirmed this post was NOT published? This will allow another publishing attempt.",
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      const result = await request<Post>(`/api/scheduler/${post.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision: post.revision, action }),
      });
      setNotice(
        action === "duplicate"
          ? post.deletedMediaCount
            ? "A copy was saved as a draft. Upload media again; the published post's files were removed from storage."
            : "A copy was saved as a draft."
          : "Post updated.",
      );
      if (action === "duplicate") open(result);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update post.");
    } finally {
      setBusy(false);
    }
  }
  function moveMonth(amount: number) {
    const date = new Date(`${month}-01T12:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + amount);
    setMonth(dayKey(date).slice(0, 7));
    setSelectedDay("");
  }
  function postCard(post: Post) {
    const editable =
      ["DRAFT", "SCHEDULED", "FAILED", "CANCELLED"].includes(post.status) &&
      !post.publishStartedAt;
    return (
      <article className="scheduler-post" key={post.id}>
        <div className="scheduler-post-body">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`scheduler-badge status-${post.status.toLowerCase()}`}
            >
              {post.status === "SCHEDULED" && post.publishStartedAt
                ? "Confirming publication"
                : labels[post.status]}
            </span>
            <span className="text-xs text-muted">
              {post.platform === "INSTAGRAM" ? "Instagram" : "Facebook"} ·{" "}
              {post.accountName} · {kindLabels[post.kind]}
            </span>
          </div>
          <h3 className="mt-3 font-semibold">{post.title}</h3>
          <p className="mt-1 whitespace-pre-wrap text-sm text-muted line-clamp-3">
            {isStory(post.kind)
              ? "Story · media only · visible for 24 hours"
              : post.caption || "No caption yet"}
          </p>
          <p className="mt-3 flex items-center gap-2 text-xs text-muted">
            <Clock3 size={14} aria-hidden="true" />
            {post.scheduledAt
              ? new Intl.DateTimeFormat(undefined, {
                  dateStyle: "medium",
                  timeStyle: "short",
                  timeZone: timezone,
                }).format(new Date(post.scheduledAt))
              : "Unscheduled draft"}{" "}
            · {timezone}
          </p>
          {post.publishedAt && (
            <p className="mt-1 text-xs text-success">
              Published{" "}
              {new Intl.DateTimeFormat(undefined, {
                dateStyle: "medium",
                timeStyle: "short",
                timeZone: timezone,
              }).format(new Date(post.publishedAt))}
            </p>
          )}
          {post.lastError && (
            <p className="scheduler-delivery-note">{post.lastError}</p>
          )}
          {Boolean(post.deletedMediaCount) && (
            <p className="mt-2 text-xs text-muted">
              Media removed from storage after publication. The live post is
              preserved.
            </p>
          )}
          {post.status === "SCHEDULED" && post.attempts > 0 && (
            <p className="mt-2 text-xs text-warning">
              Retry {post.attempts}/3
              {post.availableAt
                ? ` · next attempt ${new Intl.DateTimeFormat(undefined, { timeStyle: "short", timeZone: timezone }).format(new Date(post.availableAt))}`
                : ""}
            </p>
          )}
          {post.externalPostId && (
            <p className="mt-2 break-all text-xs text-muted">
              Meta post ID: {post.externalPostId}
            </p>
          )}
        </div>
        <div className="scheduler-post-actions">
          {editable && (
            <button
              disabled={busy || uploading}
              className="button-secondary"
              onClick={() => open(post)}
            >
              {post.status === "SCHEDULED" ? "Edit / reschedule" : "Edit post"}
            </button>
          )}
          {post.status === "FAILED" && (
            <button
              disabled={busy || uploading}
              className="button-secondary"
              onClick={() => void act(post, "retry")}
            >
              <RefreshCw size={14} /> Retry now
            </button>
          )}
          {post.status === "SCHEDULED" && !post.publishStartedAt && (
            <button
              disabled={busy || uploading}
              className="scheduler-text-button"
              onClick={() => void act(post, "cancel")}
            >
              Cancel schedule
            </button>
          )}
          {post.status === "NEEDS_REVIEW" && (
            <>
              <button
                disabled={busy || uploading}
                className="button-secondary"
                onClick={() => void act(post, "confirm-published")}
              >
                I found the published post
              </button>
              <button
                disabled={busy || uploading}
                className="button-secondary"
                onClick={() => void act(post, "confirm-not-published")}
              >
                Confirmed not published
              </button>
            </>
          )}
          <button
            disabled={busy || uploading}
            className="scheduler-text-button"
            onClick={() => void act(post, "duplicate")}
          >
            <Copy size={14} /> Duplicate as draft
          </button>
        </div>
      </article>
    );
  }

  return (
    <div className="scheduler space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-success">
            Plan ahead. Stay present.
          </p>
          <h1 className="mt-2 text-3xl font-semibold">Content scheduler</h1>
          <p className="mt-2 text-sm text-muted">
            A home for your drafts, upcoming posts, and publishing history.
          </p>
        </div>
        <button
          className="button-primary gap-2"
          disabled={!accounts.length || busy}
          onClick={() => open()}
        >
          <Plus size={17} /> Create post
        </button>
      </header>
      <div className="scheduler-stats">
        {(
          [
            ["SCHEDULED", "Scheduled"],
            ["DRAFT", "Drafts"],
            ["PUBLISHED", "Published"],
            ["FAILED", "Failed"],
          ] as const
        ).map(([status, label]) => (
          <button
            key={status}
            onClick={() => {
              setFilter(status);
              setView("list");
            }}
            className="scheduler-stat"
          >
            <span>{label}</span>
            <strong>{data?.counts[status] ?? 0}</strong>
          </button>
        ))}
      </div>
      {error && (
        <div role="alert" className="scheduler-error">
          {error}{" "}
          <button
            className="underline"
            disabled={busy || uploading}
            onClick={() => void refresh()}
          >
            Refresh posts
          </button>
        </div>
      )}
      {notice && (
        <div role="status" className="scheduler-notice">
          {notice}
        </div>
      )}
      {(data?.counts.NEEDS_REVIEW ?? 0) > 0 && (
        <div className="scheduler-warning">
          <button
            className="underline"
            onClick={() => {
              setFilter("NEEDS_REVIEW");
              setView("list");
            }}
          >
            {data?.counts.NEEDS_REVIEW}{" "}
            {data?.counts.NEEDS_REVIEW === 1
              ? "delivery needs"
              : "deliveries need"}{" "}
            checking
          </button>
          . Confirm whether they appeared on your social account before trying
          again.
        </div>
      )}
      {data && !data.workerHealthy && (
        <div role="status" className="scheduler-warning">
          The publishing worker is offline or delayed. Your scheduled posts are
          saved and will resume when it recovers.{" "}
          <Link href="/diagnostics" className="underline">
            Check diagnostics
          </Link>
        </div>
      )}
      {data && !accounts.length && (
        <div className="scheduler-empty">
          <CalendarDays size={32} />
          <h2>Connect an account to start planning</h2>
          <p>
            Schedule content for an Instagram professional account or Facebook
            Page.
          </p>
          <Link href="/settings" className="button-primary">
            Connect accounts
          </Link>
        </div>
      )}
      {editing && (
        <section
          className="scheduler-composer"
          aria-labelledby="composer-title"
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2
                id="composer-title"
                tabIndex={-1}
                ref={composer}
                className="text-xl font-semibold"
              >
                {editing === "new" ? "Create a post" : "Edit post"}
              </h2>
              <p className="mt-1 text-xs text-muted">
                Your internal title stays in Kult. Only the caption and media
                are published.
              </p>
            </div>
            <button
              disabled={busy || uploading}
              className="scheduler-text-button"
              aria-label="Close composer"
              onClick={close}
            >
              <X size={20} />
            </button>
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void save("schedule");
            }}
            className="scheduler-composer-grid"
          >
            <fieldset disabled={busy} className="min-w-0 space-y-4">
              <label className="field-label">
                Internal title
                <input
                  className="field mt-2"
                  disabled={busy || uploading}
                  value={form.title}
                  maxLength={120}
                  onChange={(e) => change({ title: e.target.value })}
                  placeholder="e.g. Friday product reveal"
                  required
                />
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="field-label">
                  Publish to
                  <select
                    className="field mt-2"
                    disabled={busy || uploading}
                    value={form.accountId}
                    onChange={(e) => {
                      const next = accounts.find(
                        (a) => a.id === e.target.value,
                      );
                      change({
                        accountId: e.target.value,
                        kind: supportedKinds(
                          next?.platform ?? "INSTAGRAM",
                        ).includes(form.kind)
                          ? form.kind
                          : next?.platform === "FACEBOOK"
                            ? "TEXT"
                            : "IMAGE",
                        caption: form.caption,
                        publishingOptions: {
                          ...defaultPublishingOptions,
                          mediaTypes: form.publishingOptions.mediaTypes,
                          altTexts: form.publishingOptions.altTexts,
                        },
                      });
                    }}
                    required
                  >
                    <option value="" disabled>
                      Choose account
                    </option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.platform === "INSTAGRAM" ? "Instagram" : "Facebook"}{" "}
                        · {a.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field-label">
                  Post type
                  <select
                    className="field mt-2"
                    disabled={busy || uploading}
                    value={form.kind}
                    onChange={(e) => {
                      const next = e.target.value as PostKind;
                      if (
                        (urls.length || (isStory(next) && form.caption)) &&
                        !window.confirm(
                          "Changing post type clears attached media and incompatible settings. Continue?",
                        )
                      )
                        return;
                      change({
                        kind: next,
                        media: "",
                        publishingOptions: { ...defaultPublishingOptions },
                        ...(isStory(next) ? { caption: "" } : {}),
                      });
                    }}
                  >
                    {supportedKinds(account?.platform ?? "INSTAGRAM").map(
                      (kind) => (
                        <option key={kind} value={kind}>
                          {kind === "CAROUSEL"
                            ? account?.platform === "FACEBOOK"
                              ? "Photo album"
                              : "Carousel · images / videos"
                            : kindLabels[kind]}
                        </option>
                      ),
                    )}
                  </select>
                </label>
              </div>
              <label className="field-label">
                {isStory(form.kind) ? "Stories publish media only" : "Caption"}
                <textarea
                  className="field mt-2"
                  rows={5}
                  value={form.caption}
                  maxLength={limit}
                  disabled={busy || uploading || isStory(form.kind)}
                  onChange={(e) => change({ caption: e.target.value })}
                  placeholder={
                    isStory(form.kind)
                      ? "Stories publish only the media. Add text and overlays to your image/video before uploading."
                      : "What would you like to share?"
                  }
                />
                <span
                  className={`mt-1 block text-right text-xs ${form.caption.length > limit ? "text-error" : "text-muted"}`}
                >
                  {form.caption.length.toLocaleString()} /{" "}
                  {limit.toLocaleString()}
                </span>
              </label>
              {form.kind !== "TEXT" && (
                <>
                  <SchedulerMedia
                    urls={urls}
                    options={form.publishingOptions}
                    platform={account?.platform ?? "INSTAGRAM"}
                    kind={form.kind}
                    uploadEnabled={data?.uploadEnabled ?? false}
                    disabled={busy || uploading}
                    onChange={(next, options) =>
                      change({
                        media: next.join("\n"),
                        publishingOptions: options,
                      })
                    }
                    onSelect={setPreviewIndex}
                    onUploading={(value) => {
                      setUploading(value);
                      if (value) setDirty(true);
                    }}
                    onError={setError}
                  />
                  <label className="field-label block">
                    {form.kind === "CAROUSEL"
                      ? "Or paste media URLs · one per line"
                      : "Or paste a public media URL"}
                    <textarea
                      disabled={busy || uploading}
                      className="field mt-2"
                      rows={form.kind === "CAROUSEL" ? 4 : 2}
                      value={form.media}
                      onChange={(e) => {
                        const next = e.target.value
                          .split("\n")
                          .map((v) => v.trim())
                          .filter(Boolean);
                        const previous = urls.map((url, i) => ({
                          url,
                          type: form.publishingOptions.mediaTypes[i],
                          alt: form.publishingOptions.altTexts[i],
                        }));
                        change({
                          media: e.target.value,
                          publishingOptions: {
                            ...form.publishingOptions,
                            mediaTypes: next.map(
                              (url) =>
                                previous.find((p) => p.url === url)?.type ??
                                (form.kind === "CAROUSEL"
                                  ? inferMediaType(url)
                                  : isVideo(form.kind)
                                    ? "VIDEO"
                                    : "IMAGE"),
                            ),
                            altTexts: next.map(
                              (url) =>
                                previous.find((p) => p.url === url)?.alt ?? "",
                            ),
                          },
                        });
                      }}
                      placeholder={
                        isVideo(form.kind)
                          ? "https://your-media-host.com/video.mp4"
                          : "https://your-media-host.com/image.jpg"
                      }
                    />
                    <span className="mt-2 block text-xs font-normal text-muted">
                      Keep URLs accessible until delivery.{" "}
                      {isStory(form.kind)
                        ? "Use vertical 9:16 media. Video Stories should be 3–60 seconds; Instagram video Stories are limited to 100 MB. Stories expire after 24 hours. Instagram Stories require a Business account."
                        : form.kind === "CAROUSEL"
                          ? "Add 2–10 items in publishing order. Instagram supports images and videos; Facebook albums support images."
                          : isVideo(form.kind)
                            ? "MP4/MOV with H.264 video and AAC audio is recommended. Existing video audio is preserved."
                            : "Instagram images must be JPEG, up to 8 MB. Feed images should be between 4:5 and 1.91:1."}
                    </span>
                  </label>
                </>
              )}
              {account?.platform === "FACEBOOK" && form.kind === "TEXT" && (
                <label className="field-label block">
                  Link preview · optional
                  <input
                    disabled={busy || uploading}
                    className="field mt-2"
                    type="url"
                    value={form.publishingOptions.linkUrl}
                    onChange={(e) =>
                      change({
                        publishingOptions: {
                          ...form.publishingOptions,
                          linkUrl: e.target.value,
                        },
                      })
                    }
                    placeholder="https://your-website.com/article"
                  />
                </label>
              )}
              {account?.platform === "INSTAGRAM" && form.kind === "REEL" && (
                <div className="scheduler-reel-options space-y-3">
                  <label className="field-label block">
                    Reel cover URL · optional
                    <input
                      disabled={busy || uploading}
                      className="field mt-2"
                      type="url"
                      value={form.publishingOptions.coverUrl}
                      onChange={(e) =>
                        change({
                          publishingOptions: {
                            ...form.publishingOptions,
                            coverUrl: e.target.value,
                          },
                        })
                      }
                      placeholder="https://your-media-host.com/cover.jpg"
                    />
                  </label>
                  <label className="field-label block">
                    Original audio name · optional
                    <input
                      disabled={busy || uploading}
                      className="field mt-2"
                      maxLength={200}
                      value={form.publishingOptions.audioName}
                      onChange={(e) =>
                        change({
                          publishingOptions: {
                            ...form.publishingOptions,
                            audioName: e.target.value,
                          },
                        })
                      }
                      placeholder="e.g. Studio session"
                    />
                  </label>
                  <p className="text-xs text-muted">
                    This names the audio already in your video. Music must be
                    included in the uploaded file; this does not attach a song
                    from Instagram’s music library.
                  </p>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      disabled={busy || uploading}
                      type="checkbox"
                      checked={form.publishingOptions.shareToFeed}
                      onChange={(e) =>
                        change({
                          publishingOptions: {
                            ...form.publishingOptions,
                            shareToFeed: e.target.checked,
                          },
                        })
                      }
                    />{" "}
                    Also share this Reel to the feed
                  </label>
                </div>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="field-label">
                  Date and time
                  <input
                    className="field mt-2"
                    disabled={busy || uploading}
                    type="datetime-local"
                    value={form.localTime}
                    onChange={(e) => change({ localTime: e.target.value })}
                  />
                </label>
                <label className="field-label">
                  Publishing timezone
                  <select
                    className="field mt-2"
                    disabled={busy || uploading}
                    value={form.timezone}
                    onChange={(e) => change({ timezone: e.target.value })}
                  >
                    {zones.map((zone) => (
                      <option key={zone}>{zone}</option>
                    ))}
                  </select>
                </label>
              </div>
              <p className="text-xs text-muted">
                The time above is in {form.timezone}. Schedule at least one
                minute ahead. Posts publish automatically, usually within a
                minute of the chosen time when the worker is healthy.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="submit"
                  className="button-primary gap-2"
                  disabled={busy || uploading}
                >
                  <CalendarDays size={16} />
                  {uploading
                    ? "Uploading…"
                    : busy
                      ? "Saving…"
                      : "Schedule post"}
                </button>
                <button
                  type="button"
                  className="button-secondary"
                  disabled={busy || uploading}
                  onClick={() => void save("draft")}
                >
                  Save draft
                </button>
                <button
                  type="button"
                  className="button-secondary gap-2"
                  disabled={busy || uploading}
                  onClick={() => void save("now")}
                >
                  <Send size={15} /> Publish now
                </button>
              </div>
              {error && (
                <p role="alert" className="text-sm text-error">
                  {error}
                </p>
              )}
            </fieldset>
            <aside className="scheduler-preview">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted">
                Post preview
              </p>
              <div className="scheduler-preview-card">
                <div className="flex items-center gap-3 p-4">
                  <span className="scheduler-avatar">
                    {(account?.name ?? "K")
                      .replace("@", "")
                      .slice(0, 1)
                      .toUpperCase()}
                  </span>
                  <div>
                    <strong className="text-sm">
                      {account?.name || "Your account"}
                    </strong>
                    <p className="text-xs text-muted">
                      {account?.platform === "FACEBOOK"
                        ? "Facebook Page"
                        : "Instagram"}
                    </p>
                  </div>
                </div>
                {form.kind !== "TEXT" && (
                  <div
                    className={`scheduler-preview-media ${isStory(form.kind) || form.kind === "REEL" ? "scheduler-preview-vertical" : ""}`}
                  >
                    {isPublicMediaUrl(
                      urls[Math.min(previewIndex, urls.length - 1)] ?? "",
                    ) ? (
                      <SchedulerPreview
                        url={urls[Math.min(previewIndex, urls.length - 1)]}
                        video={
                          isVideo(form.kind) ||
                          (form.kind === "CAROUSEL" &&
                            (form.publishingOptions.mediaTypes[previewIndex] ??
                              inferMediaType(urls[previewIndex])) === "VIDEO")
                        }
                        alt={
                          form.publishingOptions.altTexts[previewIndex] ||
                          "Post media preview"
                        }
                        onError={setError}
                      />
                    ) : (
                      <div className="flex flex-col items-center gap-3 p-8">
                        <ImageIcon size={32} />
                        <p className="text-sm">Add media to see your preview</p>
                      </div>
                    )}
                    {form.kind === "CAROUSEL" && urls.length > 0 && (
                      <span className="scheduler-carousel-count">
                        {Math.min(previewIndex + 1, urls.length)} /{" "}
                        {urls.length}
                      </span>
                    )}
                  </div>
                )}
                {form.kind === "CAROUSEL" && urls.length > 1 && (
                  <div className="flex justify-between p-2">
                    <button
                      type="button"
                      className="scheduler-text-button"
                      disabled={previewIndex === 0}
                      onClick={() => setPreviewIndex((i) => i - 1)}
                    >
                      Previous item
                    </button>
                    <button
                      type="button"
                      className="scheduler-text-button"
                      disabled={previewIndex >= urls.length - 1}
                      onClick={() => setPreviewIndex((i) => i + 1)}
                    >
                      Next item
                    </button>
                  </div>
                )}
                <p className="whitespace-pre-wrap break-words p-4 text-sm">
                  {isStory(form.kind)
                    ? "Story · media only · visible for 24 hours"
                    : form.caption || "Your caption appears here."}
                </p>
              </div>
              <p className="mt-3 text-xs text-muted">
                Preview is approximate. Final cropping and presentation are
                controlled by the platform.
              </p>
            </aside>
          </form>
        </section>
      )}
      <section className="scheduler-planner" aria-label="Content planner">
        <div className="scheduler-toolbar">
          <div className="scheduler-view-switch">
            <button
              aria-pressed={view === "list"}
              onClick={() => setView("list")}
            >
              List
            </button>
            <button
              aria-pressed={view === "calendar"}
              onClick={() => setView("calendar")}
            >
              Calendar
            </button>
          </div>
          <label className="sr-only" htmlFor="scheduler-search">
            Search posts
          </label>
          <input
            id="scheduler-search"
            className="field scheduler-search"
            placeholder="Search title, caption, account…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <label className="sr-only" htmlFor="scheduler-filter">
            Filter status
          </label>
          <select
            id="scheduler-filter"
            className="field scheduler-filter"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="">All statuses</option>
            {Object.entries(labels).map(([status, label]) => (
              <option key={status} value={status}>
                {label}
              </option>
            ))}
          </select>
          <button
            className="scheduler-text-button"
            aria-label="Refresh posts"
            disabled={loading}
            onClick={() => void refresh()}
          >
            <RefreshCw size={17} />
          </button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
          <p className="text-xs text-muted">Showing times in</p>
          <label>
            <span className="sr-only">Planner timezone</span>
            <select
              className="field !w-auto !py-2 !text-xs"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
            >
              {zones.map((zone) => (
                <option key={zone}>{zone}</option>
              ))}
            </select>
          </label>
        </div>
        {view === "calendar" && month && (
          <>
            <div className="flex items-center justify-between gap-2 p-5">
              <div className="flex items-center gap-3">
                <button
                  className="scheduler-text-button"
                  onClick={() => moveMonth(-1)}
                  aria-label="Previous month"
                >
                  <ChevronLeft size={20} />
                </button>
                <h2 className="text-lg font-semibold">
                  {new Intl.DateTimeFormat(undefined, {
                    month: "long",
                    year: "numeric",
                    timeZone: "UTC",
                  }).format(new Date(`${month}-01T12:00:00Z`))}
                </h2>
                <button
                  className="scheduler-text-button"
                  onClick={() => moveMonth(1)}
                  aria-label="Next month"
                >
                  <ChevronRight size={20} />
                </button>
              </div>
              <button
                className="scheduler-text-button"
                onClick={() => {
                  setMonth(localDateTime(new Date(), timezone).slice(0, 7));
                  setSelectedDay("");
                }}
              >
                Today
              </button>
            </div>
            <div className="scheduler-calendar-scroll">
              <div
                className="scheduler-calendar"
                aria-label="Publishing calendar"
              >
                {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(
                  (day) => (
                    <div className="scheduler-weekday" key={day}>
                      {day}
                    </div>
                  ),
                )}
                {days.map((date) => {
                  const key = dayKey(date);
                  const posts = (data?.posts ?? []).filter(
                    (p) =>
                      p.scheduledAt &&
                      localDateTime(
                        new Date(p.scheduledAt),
                        timezone,
                      ).startsWith(key),
                  );
                  return (
                    <div
                      key={key}
                      className={`scheduler-day ${key.slice(0, 7) !== month ? "other-month" : ""} ${selectedDay === key ? "selected-day" : ""}`}
                    >
                      <div className="flex items-center justify-between">
                        <button
                          className="scheduler-date"
                          aria-label={`Show posts for ${key}`}
                          aria-pressed={selectedDay === key}
                          onClick={() =>
                            setSelectedDay((current) =>
                              current === key ? "" : key,
                            )
                          }
                        >
                          {date.getUTCDate()}
                        </button>
                        <button
                          className="scheduler-add-day"
                          disabled={!accounts.length || busy}
                          aria-label={`Create post for ${key}`}
                          onClick={() => open(undefined, key)}
                        >
                          <Plus size={13} />
                        </button>
                      </div>
                      {posts.slice(0, 3).map((post) => (
                        <button
                          key={post.id}
                          className={`scheduler-calendar-post status-${post.status.toLowerCase()}`}
                          onClick={() => setSelectedDay(key)}
                          title={`${post.title} · ${post.status === "SCHEDULED" && post.publishStartedAt ? "Confirming publication" : labels[post.status]}`}
                        >
                          <span>
                            {localDateTime(
                              new Date(post.scheduledAt!),
                              timezone,
                            ).slice(11)}
                          </span>{" "}
                          {post.title}
                        </button>
                      ))}
                      {posts.length > 3 && (
                        <button
                          className="text-xs"
                          onClick={() => setSelectedDay(key)}
                        >
                          +{posts.length - 3} more
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="flex items-center justify-between p-5">
              <h3 className="text-sm font-semibold">
                {selectedDay
                  ? `Posts for ${selectedDay}`
                  : "Posts on this calendar"}
              </h3>
              {selectedDay && (
                <button
                  className="scheduler-text-button"
                  onClick={() => setSelectedDay("")}
                >
                  Show all days
                </button>
              )}
            </div>
          </>
        )}
        {loading && !data ? (
          <div role="status" className="scheduler-empty">
            Loading your content planner…
          </div>
        ) : visiblePosts.length ? (
          <div aria-busy={loading}>{visiblePosts.map(postCard)}</div>
        ) : (
          <div className="scheduler-empty">
            <CalendarDays size={30} />
            <h2>
              {filter || search || selectedDay
                ? "No posts match this view"
                : view === "calendar"
                  ? "Your calendar is clear"
                  : "Make room for your next idea"}
            </h2>
            <p>
              {view === "calendar"
                ? "Choose a day’s + button to schedule a post. Unscheduled drafts appear in List view."
                : "Save an idea as a draft, or plan your next post ahead of time."}
            </p>
            {accounts.length > 0 && (
              <button className="button-primary" onClick={() => open()}>
                Create a post
              </button>
            )}
          </div>
        )}
        {data?.nextCursor && (
          <div className="p-5 text-center">
            <p className="mb-3 text-xs text-muted">
              More posts are available in this view.
            </p>
            <button
              className="button-secondary"
              disabled={loading}
              onClick={() => void refresh(true)}
            >
              Load more posts
            </button>
          </div>
        )}
      </section>
      <p className="text-xs text-muted">
        Publishing requires an Instagram professional account or Facebook Page
        with publishing access. If you connected before the scheduler was added,{" "}
        <Link href="/settings" className="underline">
          reconnect in Settings
        </Link>{" "}
        to grant the new permissions.
      </p>
    </div>
  );
}
