"use client";
import { useRef, useState } from "react";
import { uploadSchedulerFile } from "@/lib/scheduler/upload-client";
import { ArrowDown, ArrowUp, Upload, X } from "lucide-react";
import {
  inferMediaType,
  isVideo,
  type PostKind,
  type PublishingOptions,
} from "@/lib/scheduler/capabilities";
import { validateUpload } from "@/lib/scheduler/media-files";
export default function SchedulerMedia({
  urls,
  options,
  platform,
  kind,
  uploadEnabled,
  disabled,
  onChange,
  onSelect,
  onUploading,
  onError,
}: {
  urls: string[];
  options: PublishingOptions;
  platform: string;
  kind: PostKind;
  uploadEnabled: boolean;
  disabled: boolean;
  onChange: (urls: string[], options: PublishingOptions) => void;
  onSelect: (index: number) => void;
  onUploading: (value: boolean) => void;
  onError: (message: string) => void;
}) {
  const [progress, setProgress] = useState<string>("");
  const abort = useRef<AbortController | null>(null);
  const multiple = kind === "CAROUSEL";
  function updateOptions(
    index: number,
    field: "mediaTypes" | "altTexts",
    value: string,
  ) {
    const next = {
      ...options,
      mediaTypes: urls.map(
        (url, i) => options.mediaTypes[i] ?? inferMediaType(url),
      ),
      altTexts: urls.map((_, i) => options.altTexts[i] ?? ""),
    };
    if (field === "mediaTypes")
      next.mediaTypes[index] = value as "IMAGE" | "VIDEO";
    else next.altTexts[index] = value;
    onChange(urls, next);
  }
  function move(index: number, destination?: number) {
    const items = urls.map((url, i) => ({
      url,
      type: options.mediaTypes[i] ?? inferMediaType(url),
      alt: options.altTexts[i] ?? "",
    }));
    const item = items.splice(index, 1)[0];
    if (destination !== undefined) items.splice(destination, 0, item);
    onChange(
      items.map((i) => i.url),
      {
        ...options,
        mediaTypes: items.map((i) => i.type),
        altTexts: items.map((i) => i.alt),
      },
    );
    onSelect(destination ?? 0);
  }
  async function addFiles(files: FileList | null) {
    if (!files?.length || disabled) return;
    if (
      (!multiple && urls.length + files.length > 1) ||
      urls.length + files.length > 10
    ) {
      onError(
        multiple
          ? "Add up to 10 media items."
          : "Remove the current media before adding another file.",
      );
      return;
    }
    const controller = new AbortController();
    abort.current = controller;
    onUploading(true);
    onError("");
    const nextUrls = [...urls];
    const nextOptions = {
      ...options,
      mediaTypes: urls.map(
        (url, i) => options.mediaTypes[i] ?? inferMediaType(url),
      ),
      altTexts: urls.map((_, i) => options.altTexts[i] ?? ""),
    };
    try {
      for (const file of Array.from(files))
        validateUpload(file, platform, kind);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Unsupported file.");
      onUploading(false);
      abort.current = null;
      return;
    }
    try {
      for (const original of Array.from(files)) {
        const file = original;
        validateUpload(file, platform, kind);
        if (controller.signal.aborted) break;
        setProgress(`Uploading ${original.name}…`);
        const mediaUrl = await uploadSchedulerFile(
          file,
          platform,
          kind,
          controller.signal,
          (percentage) =>
            setProgress(`${original.name} · ${Math.round(percentage)}%`),
        );
        nextUrls.push(mediaUrl);
        nextOptions.mediaTypes.push(
          file.type.startsWith("video/") ? "VIDEO" : "IMAGE",
        );
        nextOptions.altTexts.push("");
        onChange([...nextUrls], {
          ...nextOptions,
          mediaTypes: [...nextOptions.mediaTypes],
          altTexts: [...nextOptions.altTexts],
        });
      }
    } catch (error) {
      onError(
        controller.signal.aborted
          ? "Upload cancelled. Completed uploads remain in your composer."
          : error instanceof Error
            ? error.message
            : "Upload failed. Check the file format and storage connection, then try again.",
      );
    } finally {
      setProgress("");
      abort.current = null;
      onUploading(false);
    }
  }
  return (
    <div className="scheduler-media-editor">
      <div className="scheduler-upload-box">
        <Upload size={20} aria-hidden="true" />
        <label className="text-sm font-semibold">
          Upload{" "}
          {multiple ? "images / videos" : isVideo(kind) ? "video" : "image"}
          <input
            className="mt-2 block w-full text-xs"
            type="file"
            multiple={multiple}
            accept={
              isVideo(kind)
                ? "video/mp4,video/quicktime"
                : multiple && platform === "INSTAGRAM"
                  ? "image/jpeg,video/mp4,video/quicktime"
                  : platform === "INSTAGRAM"
                    ? "image/jpeg"
                    : "image/jpeg,image/png,image/gif,image/bmp,image/tiff"
            }
            disabled={disabled || !uploadEnabled}
            onChange={(event) => {
              void addFiles(event.target.files);
              event.target.value = "";
            }}
          />
        </label>
        <p className="text-xs text-muted">
          {uploadEnabled
            ? "Files are stored in Backblaze B2 with temporary access links for private media. After confirmed publication, files are automatically deleted following a 16-minute safety window unless another draft or pending post uses them. Files are published as supplied; no conversion or audio mixing."
            : "File uploads need a connected Backblaze B2 media bucket. You can use public HTTPS URLs below."}
        </p>
        {progress && (
          <div
            role="status"
            className="flex flex-wrap items-center gap-2 text-xs"
          >
            <span>{progress}</span>
            <button
              type="button"
              className="scheduler-text-button"
              onClick={() => abort.current?.abort()}
            >
              Cancel upload
            </button>
          </div>
        )}
      </div>
      {urls.map((url, index) => (
        <div className="scheduler-media-item" key={`${index}-${url}`}>
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              className="scheduler-text-button"
              onClick={() => onSelect(index)}
            >
              Preview item {index + 1}
            </button>
            <div className="flex">
              {multiple && (
                <>
                  <button
                    type="button"
                    className="scheduler-text-button"
                    aria-label={`Move item ${index + 1} up`}
                    disabled={disabled || index === 0}
                    onClick={() => move(index, index - 1)}
                  >
                    <ArrowUp size={15} />
                  </button>
                  <button
                    type="button"
                    className="scheduler-text-button"
                    aria-label={`Move item ${index + 1} down`}
                    disabled={disabled || index === urls.length - 1}
                    onClick={() => move(index, index + 1)}
                  >
                    <ArrowDown size={15} />
                  </button>
                </>
              )}
              <button
                type="button"
                className="scheduler-text-button"
                aria-label={`Remove item ${index + 1}`}
                disabled={disabled}
                onClick={() => move(index)}
              >
                <X size={15} />
              </button>
            </div>
          </div>
          <p className="break-all text-xs text-muted">{url}</p>
          <label className="field-label mt-2 block">
            Media type
            <select
              className="field mt-1"
              value={
                options.mediaTypes[index] ??
                (multiple
                  ? inferMediaType(url)
                  : isVideo(kind)
                    ? "VIDEO"
                    : "IMAGE")
              }
              disabled={disabled}
              onChange={(e) =>
                updateOptions(index, "mediaTypes", e.target.value)
              }
            >
              <option value="IMAGE">Image</option>
              {(platform === "INSTAGRAM" || kind !== "CAROUSEL") && (
                <option value="VIDEO">Video · includes embedded audio</option>
              )}
            </select>
          </label>
          {(options.mediaTypes[index] ??
            (multiple
              ? inferMediaType(url)
              : isVideo(kind)
                ? "VIDEO"
                : "IMAGE")) === "IMAGE" &&
            !kind.startsWith("STORY") && (
              <label className="field-label mt-2 block">
                Alt text · item {index + 1}
                <input
                  className="field mt-1"
                  maxLength={1000}
                  disabled={disabled}
                  value={options.altTexts[index] ?? ""}
                  placeholder="Describe the image for screen readers"
                  onChange={(e) =>
                    updateOptions(index, "altTexts", e.target.value)
                  }
                />
              </label>
            )}
        </div>
      ))}
    </div>
  );
}
