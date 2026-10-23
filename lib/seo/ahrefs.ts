import { z } from "zod";
import { normalizeDomain, type DomainRatingResult } from "@/lib/seo/domains";

export class AhrefsError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "AhrefsError";
  }
}

const responseSchema = z.object({
  domain_rating: z.object({
    targets: z.array(z.object({
      target: z.string(),
      domain_rating: z.number().min(0).max(100).nullable(),
    })),
  }),
});

// Only this server module reads the credential. Targets are sent as data to a
// fixed Ahrefs endpoint; Kult never fetches user-supplied domains directly.
export async function fetchDomainRatings(domains: string[]): Promise<DomainRatingResult[]> {
  const apiKey = process.env.AHREFS_API_KEY?.trim();
  if (!apiKey) throw new AhrefsError("Ahrefs is not configured yet. Ask your workspace administrator to connect it.", 503);
  let response: Response;
  try {
    response = await fetch("https://api.ahrefs.com/v3/public/domain-rating-free?output=json", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ targets: domains, version: "dr3" }),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(25_000),
    });
  } catch {
    throw new AhrefsError("Ahrefs could not be reached in time. Please try again.", 504);
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403)
      throw new AhrefsError("Ahrefs rejected the connection. Ask your workspace administrator to check the API key and access.", 503);
    if (response.status === 429)
      throw new AhrefsError("Ahrefs is receiving too many requests. Wait a minute, then try again.", 429);
    throw new AhrefsError("Ahrefs could not complete this check. Please try again later.", 502);
  }
  const parsed = responseSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new AhrefsError("Ahrefs returned an unexpected response. Please try again later.", 502);
  const ratings = new Map<string, number | null>();
  for (const row of parsed.data.domain_rating.targets) {
    const domain = normalizeDomain(row.target);
    if (domain) ratings.set(domain, row.domain_rating);
  }
  // Missing/null ratings are unavailable, never silently converted to DR 0.
  return domains.map((domain) => ({ domain, rating: ratings.get(domain) ?? null }));
}
