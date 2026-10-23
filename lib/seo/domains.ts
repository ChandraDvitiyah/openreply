export const MAX_DR_DOMAINS = 1000;
export const MAX_DR_INPUT_LENGTH = 300_000;

export type DomainRatingResult = {
  domain: string;
  rating: number | null;
};

/** Normalize URLs to hostnames; preserve subdomains rather than guessing a public suffix. */
export function normalizeDomain(input: string): string | null {
  const value = input.trim();
  if (!value || /\s|\\/.test(value)) return null;
  try {
    const url = new URL(value.startsWith("//") ? `https:${value}` : /^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `https://${value}`);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.port) return null;
    const domain = url.hostname.toLowerCase().replace(/\.$/, "");
    const labels = domain.split(".");
    if (domain.length > 253 || labels.length < 2) return null;
    if (!labels.every((label) => /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/.test(label))) return null;
    const tld = labels.at(-1)!;
    if (!/^(?:[a-z]{2,63}|xn--[a-z\d-]+)$/.test(tld) || ["localhost", "local", "internal", "test", "invalid"].includes(tld)) return null;
    return domain;
  } catch {
    return null;
  }
}

export function parseDomains(input: string) {
  const entries = input.split(/[\s,;]+/).filter(Boolean);
  const domains = new Set<string>();
  const invalid: string[] = [];
  let duplicates = 0;
  for (const entry of entries) {
    const domain = normalizeDomain(entry);
    if (!domain) invalid.push(entry);
    else if (domains.has(domain)) duplicates++;
    else domains.add(domain);
  }
  return { domains: [...domains], invalid, duplicates };
}

export function domainRatingsCsv(results: DomainRatingResult[], checkedAt: string) {
  const cell = (value: string) => `"${value.replace(/"/g, '""')}"`;
  return [
    "Domain,Domain Rating,Status,Checked at,Source",
    ...results.map(({ domain, rating }) => [domain, rating === null ? "" : String(rating), rating === null ? "Unavailable" : "Checked", checkedAt, "Domain Rating by Ahrefs"].map(cell).join(",")),
  ].join("\r\n");
}
