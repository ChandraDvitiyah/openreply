// Browser -> Backblaze directly. Only metadata passes through the app server.
export async function uploadSchedulerFile(
  file: File,
  platform: string,
  kind: string,
  signal: AbortSignal,
  onProgress: (percentage: number) => void,
): Promise<string> {
  const response = await fetch("/api/scheduler/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      platform,
      kind,
      contentType: file.type,
      size: file.size,
    }),
    signal,
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error ?? "Unable to authorize upload.");
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    const cleanup = () => signal.removeEventListener("abort", abort);
    xhr.open("PUT", result.uploadUrl);
    // Browsers generate Content-Length from File; both length and MIME are signed.
    for (const [name, value] of Object.entries(result.headers))
      xhr.setRequestHeader(name, String(value));
    xhr.timeout = 60 * 60_000;
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable)
        onProgress((event.loaded / event.total) * 100);
    };
    xhr.onload = () => {
      cleanup();
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else
        reject(
          new Error(
            "Backblaze rejected the upload. Check storage permissions and try again.",
          ),
        );
    };
    xhr.onerror = () => {
      cleanup();
      reject(
        new Error(
          "Could not reach Backblaze. Check your connection and the bucket's upload CORS configuration.",
        ),
      );
    };
    xhr.ontimeout = () => {
      cleanup();
      reject(new Error("The upload timed out. Please try again."));
    };
    xhr.onabort = () => {
      cleanup();
      reject(new DOMException("Upload cancelled.", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      cleanup();
      reject(new DOMException("Upload cancelled.", "AbortError"));
      return;
    }
    xhr.send(file);
  });
  return result.mediaUrl;
}
