# Shared analytics refresh and multiple Link Studio pages

Overview and Views use the same `syncWorkspacePerformance` pipeline. Each
account/window snapshot now stores video details alongside its account totals.
`GET /api/views` projects those stored records, applies platform/account filters,
and never fetches Meta directly. Old snapshots have null video details and
request an initial refresh. A failed account fetch retains its last saved data.
Facebook account totals still measure Page-wide activity; Views measures videos.

The dashboard cache deduplicates concurrent refreshes per reporting window.
Successful refreshes invalidate Overview and every Views filter for that window
and notify mounted consumers. Automatic refreshes share a six-hour freshness
window; manual refreshes always request current data. The scheduled worker and
cron already call the same pipeline and therefore update video details too.

Link Studio supports creating and selecting independent public pages. The
original page keeps its owner key, URL, link IDs and analytics. Additional pages
have their own profile key, linked to the authenticated user by `bio_page_owners`.
Link reads and writes validate ownership; each public page shows only its own
links. Overview includes analytics from all of a member's pages. Existing MCP
bio tools also support page selection and creation without changing tool count.

## Release requirements

Apply `20261011000000_shared_performance_link_pages` to Turso before releasing
web or worker code that reads the new snapshot column. Take a fresh backup and
follow `OPERATIONS.md`. Update Vercel and the existing Oracle worker together;
no new worker, credential, provider setting, or dependency is required. The
first refresh of each reporting window fills video details for legacy snapshots.

The release adds Schedule filters for status, platform, account and content
type. Schedule opens with Scheduled selected; filters apply before pagination
and work in both list and calendar views. Reset restores that default.

Production health was checked and a fresh encrypted backup was restored
with SQLite integrity OK before release preparation. Deployment verification
is recorded in `OPERATIONS.md`.

Validation: 379 tests pass, TypeScript and ESLint pass, and the production build
succeeds. The additive migration was applied to a restored production backup:
SQLite integrity is OK and all 31 existing tables retain their row counts.
Live Meta refresh and authenticated API reads passed after deployment.
Overview and Views share the same capture timestamp and social totals.
The live editor browser flow was not exercised because no authenticated
browser session was available; page ownership and links passed isolated
SQLite integration tests.
