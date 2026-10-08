"use client";
import { useEffect, useState } from "react";
export default function SchedulerPreview({
  url,
  video,
  alt,
  onError,
}: {
  url: string;
  video: boolean;
  alt: string;
  onError: (message: string) => void;
}) {
  const [resolved, setResolved] = useState<{
    source: string;
    url: string;
  } | null>(null);
  const [failure, setFailure] = useState<{
    source: string;
    message: string;
  } | null>(null);
  const privateMedia = /^https:\/\/f\d+\.backblazeb2\.com\/file\//.test(url);
  useEffect(() => {
    if (!privateMedia) return;
    const controller = new AbortController();
    async function resolve() {
      try {
        const response = await fetch("/api/scheduler/media", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
          signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok)
          throw new Error(data.error ?? "Unable to preview media.");
        if (!controller.signal.aborted) {
          setResolved({ source: url, url: data.url });
          setFailure(null);
        }
      } catch (error) {
        if (!controller.signal.aborted)
          setFailure({
            source: url,
            message:
              error instanceof Error
                ? error.message
                : "Unable to preview media.",
          });
      }
    }
    void resolve();
    const refresh = setInterval(() => void resolve(), 50 * 60_000);
    return () => {
      controller.abort();
      clearInterval(refresh);
    };
  }, [url, privateMedia]);
  const source = privateMedia
    ? resolved?.source === url
      ? resolved.url
      : ""
    : url;
  if (failure?.source === url)
    return (
      <p role="alert" className="p-4 text-sm text-error">
        {failure.message}
      </p>
    );
  if (!source)
    return (
      <p role="status" className="p-4 text-sm text-muted">
        Loading private media preview…
      </p>
    );
  return video ? (
    <video
      src={source}
      controls
      preload="metadata"
      playsInline
      aria-label="Video and audio preview"
      onError={() =>
        onError(
          "Video preview unavailable. Verify the file format and storage connection before scheduling.",
        )
      }
    />
  ) : (
    // Preview comes directly from storage; the app never proxies creator bytes.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={source}
      alt={alt}
      referrerPolicy="no-referrer"
      onError={(event) => {
        event.currentTarget.alt =
          "Preview unavailable. Verify the media URL and storage connection.";
      }}
    />
  );
}
