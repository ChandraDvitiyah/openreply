// Media is handed to Meta, never fetched by our server. Keep local/private
// addresses and credential-bearing URLs out of stored content and previews.
export function isPublicMediaUrl(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !host.includes(":") &&
      !/^[0-9.]+$/.test(host) &&
      host.includes(".") &&
      !host.endsWith(".") &&
      !/\.(localhost|local|internal|test|invalid)$/.test(host)
    );
  } catch {
    return false;
  }
}
