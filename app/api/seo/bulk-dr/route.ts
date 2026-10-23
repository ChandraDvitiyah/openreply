import { z } from "zod";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { AhrefsError, fetchDomainRatings } from "@/lib/seo/ahrefs";
import { MAX_DR_DOMAINS, MAX_DR_INPUT_LENGTH, parseDomains } from "@/lib/seo/domains";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const inputSchema = z.object({ input: z.string().min(1).max(MAX_DR_INPUT_LENGTH) }).strict();
const reply = (body: unknown, status = 200) => Response.json(body, {
  status, headers: { "Cache-Control": "private, no-store" },
});

// Bound streamed/chunked requests as well as requests with Content-Length.
async function readBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 1_000_000) {
      await reader.cancel();
      throw new AhrefsError("This domain list is too large. Use up to 1,000 domains.", 413);
    }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if ((origin && origin !== new URL(request.url).origin) || request.headers.get("sec-fetch-site") === "cross-site")
    return reply({ error: "Origin is not allowed" }, 403);
  try {
    const context = await getCurrentWorkspaceContext();
    if (!context) return reply({ error: "Sign in to check domain ratings." }, 401);
    const body = inputSchema.safeParse(await readBody(request));
    if (!body.success) return reply({ error: "Enter a domain list of up to 1,000 domains." }, 400);
    const { domains, invalid, duplicates } = parseDomains(body.data.input);
    if (invalid.length) return reply({ error: "Some entries are not valid public domains. Correct them and try again.", invalid: invalid.slice(0, 10) }, 400);
    if (!domains.length || domains.length > MAX_DR_DOMAINS)
      return reply({ error: "Enter between 1 and 1,000 unique domains." }, 400);
    const results = await fetchDomainRatings(domains);
    return reply({ results, duplicates, checkedAt: new Date().toISOString(),
      metric: { name: "Domain Rating", code: "DR", min: 0, max: 100 },
      source: { name: "Ahrefs", url: "https://ahrefs.com/", attribution: "Domain Rating by Ahrefs" },
    });
  } catch (error) {
    if (error instanceof AhrefsError) return reply({ error: error.message }, error.status);
    if (error instanceof SyntaxError) return reply({ error: "Invalid request. Please send a domain list." }, 400);
    return reply({ error: "Unable to check domain ratings right now. Please try again." }, 500);
  }
}
