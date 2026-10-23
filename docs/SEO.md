# SEO workspace and Bulk DR Checker

The outer dashboard rail switches between Social Media (the existing routes)
and SEO. `/seo` redirects to `/seo/bulk-dr-checker`. All dashboard pages retain
the existing authenticated layout.

## Ahrefs connection

Set `AHREFS_API_KEY` in the web app's server environment (`.env.local` locally,
Vercel environment variables for deployment). Restart/redeploy the web app after
changing it. Never use a `NEXT_PUBLIC_` key or commit a credential. The worker
does not use this integration. No database migration is needed.

Generate an API v3 key in Ahrefs Account settings → API keys. The checker uses
the [free bulk Domain Rating endpoint](https://docs.ahrefs.com/en/api/reference/public/post-domain-rating-free),
`POST https://api.ahrefs.com/v3/public/domain-rating-free?output=json`, with
Bearer authentication and `{ targets: [...], version: "dr3" }`.
The documented limit is 1,000 targets. The UI includes the required
“Domain Rating by Ahrefs” attribution linked to Ahrefs.

## Behavior

- Paste domains or HTTP(S) URLs separated by lines, spaces, commas or semicolons.
- URLs become lowercase hostnames; paths, queries and fragments are ignored.
  Subdomains (including `www`) remain distinct. Internationalized domains are
  normalized to ASCII. Duplicate hostnames are sent once.
- Invalid entries, credentials in URLs, ports, IP addresses and local-only host
  names are rejected before requesting Ahrefs. Correct invalid entries before
  running a batch; the checker never silently truncates the list.
- The authenticated, same-origin `/api/seo/bulk-dr` route forwards a single batch
  with a 25-second timeout. The API key stays on the server. No target site is
  fetched directly, and provider error bodies/credentials are not exposed.
- Results can be searched, sorted, paginated and exported to CSV. Missing ratings
  display as unavailable; a genuine DR 0 remains 0. Average DR excludes unavailable
  ratings. CSV includes all domains in the last successful check and its timestamp.
- Results live in page memory; navigating away clears them. Failed checks preserve
  the previous report with its original timestamp. No results/history are stored
  in Turso and no jobs are queued.
- The existing MCP product catalogue also exposes `check_domain_ratings` with
  read access, using the same authenticated handler and validation.

With no key, the domain editor remains available and the check action is disabled.
“Ahrefs configured” indicates key presence, not a verified provider connection.
Use an actual authenticated check after configuring a valid key to verify access.

## MCP usage

Ask a connected agent: “Check the Ahrefs DR for ahrefs.com and wikipedia.org.”
The `check_domain_ratings` tool supports both single and bulk checks with the
same input format as the dashboard:

```json
{"body":{"input":"ahrefs.com, https://wikipedia.org/wiki/SEO"}}
```

Read-only credentials can use it; workspace membership is checked on every call.
No Instagram/Facebook connection is required. A successful response includes
`status: 200`, `results` (`domain` and `rating`), `duplicates`, `checkedAt`,
`metric` (`name: "Domain Rating"`, `code: "DR"`, `min: 0`, `max: 100`) and
`source` (Ahrefs name, URL and attribution). Show null ratings as unavailable,
not zero, and attribute results as [Domain Rating by Ahrefs](https://ahrefs.com/).

Ahrefs **DR** and Moz **Domain Authority (DA)** are different metrics. This
integration provides DR only; agents must not relabel it DA or convert between
the two. Moz DA would need a separate integration and provider credentials.

Deploy the updated web app with `AHREFS_API_KEY` configured on the server to
expose SEO on the remote MCP endpoint. Refresh the client's tool catalogue after
deployment if it still shows the older tools. The key never belongs in MCP input.

## Local app

To run the built app locally:

```sh
NEXT_PUBLIC_APP_URL=http://localhost:3000 npm run build
NEXT_PUBLIC_APP_URL=http://localhost:3000 npm run start -- --hostname localhost --port 3000
```

Open `http://localhost:3000/seo/bulk-dr-checker` and sign in with your existing
Kult account. Bind to `localhost` for this setup: binding to `127.0.0.1` while
Clerk rewrites to `localhost` can cause a same-server proxy loop in Next.js.
