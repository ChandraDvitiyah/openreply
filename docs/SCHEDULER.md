# Content scheduler

The Schedule navigation entry opens `/scheduler`. Workspace members can plan
content for the workspace's connected accounts. Connecting or reconnecting an
account still follows the existing workspace administration permissions.

## Supported content and workflow

| Platform | Content types | Native options |
| --- | --- | --- |
| Instagram professional accounts | Images, Reels, mixed image/video carousels (2–10 items), image/video Stories | Image alt text, Reel cover URL, original audio name, share Reel to feed |
| Facebook Pages | Text/link posts, images, photo albums (2–10 images), videos, Reels, image/video Stories | Link previews and photo alt text |

Instagram Stories require a Business account. Personal Facebook profiles and
consumer Instagram accounts are not supported. Facebook Pages need the
`CREATE_CONTENT` task and publishing permissions. Account eligibility is checked
at delivery; disconnected/expired accounts receive actionable errors.

- Drafts, publish now, future scheduling, editing/rescheduling, cancellation,
  duplication into a draft, search, status filters, paginated history, and a
  monthly calendar with per-day creation and filtering.
- Users can upload files or paste public HTTPS URLs. The composer includes file
  size/type validation, upload progress/cancellation, media ordering/removal,
  per-item preview navigation, and native platform metadata. Stories show a
  vertical preview and disable captions so unsupported text is not silently lost.
- Files are published as supplied. **There is no media editor, image conversion,
  transcoding, audio mixing, or separate soundtrack upload.** Existing audio in
  video is retained. Instagram's `audio_name` names original audio already in a
  Reel; it does not attach music from a catalogue. Standalone audio is rejected.
- Instagram images must be JPEG (8 MB maximum), Reels are capped at 300 MB,
  and video Stories at 100 MB. Uploaded Facebook images are capped at 10 MB,
  Facebook videos at 1 GB. MP4/MOV videos are accepted. The media must satisfy
  Meta's codec, duration and aspect-ratio requirements; Meta performs its own
  processing. Videos for Stories should be 3–60 seconds. Link-based media is
  validated syntactically, not fetched or transcoded by Kult.
- URL-based media must remain accessible until publishing completes. Direct
  uploads use Backblaze B2, scoped by workspace, with private buckets supported.
  The database saves stable file references. Authenticated previews receive
  one-hour signed download links; the publisher generates fresh one-day links
  when a post is due, so a schedule never stores an expiring credential.
  Files travel directly between the browser/B2/Meta; Kult never proxies bytes.
  After confirmed live publication, a durable cleanup job removes all versions
  of workspace-owned files (including uploaded Reel covers) following a
  16-minute safety window. Other unpublished posts and recently published posts
  keep shared files until they no longer need them. Failed deletion retries
  automatically; deletion claims and saves are serialized to prevent reuse of
  partially deleted files. Duplicating a published post whose media was removed
  copies its text/options into a draft and asks for new uploads. External URLs
  are never deleted. Interrupted/unused uploads that were never published remain
  an operator cleanup responsibility.
- The publishing timezone is saved with each post; the delivery timestamp is
  stored in UTC. The planner can display another timezone without changing
  delivery. Nonexistent or ambiguous daylight-saving times are rejected with
  guidance to choose another time or UTC.
- Future posts must be scheduled at least one minute ahead. The worker sweeps
  every 15 seconds, independently of DM jobs. Processing, platform rate limits,
  backlog, and outages can delay publication. Overdue posts resume after an
  outage. This is not a guarantee of delivery at an exact second.
- This release does not include cross-platform batch publication, recurring
  publication, product tagging, ads, interactive Story stickers, or a music
  catalogue. It supports the media types and native options listed above.

## Delivery safety

`ScheduledPost` is both the content record and its durable publishing job. It
lives in Turso alongside application data; no browser tab or Vercel daily cron
is needed for delivery.

Workers atomically claim a due row with a revision guard and a ten-minute lease.
Edits and cancellation use the same revision/status guards. A claimed or
published post cannot be edited. Retried create requests from the composer use
a workspace-scoped unique request ID to avoid duplicate publishing jobs when an
HTTP response is lost.

Instagram containers and Facebook unpublished photos/Reel/Story upload sessions
are created when a post is due. Child IDs and upload acknowledgements are
checkpointed incrementally. Mixed-carousel children must finish processing before
the parent is created. A processing container is checked again after 30 seconds,
up to 120 checks. Pre-publication transient failures receive up to
three attempts with one- and two-minute backoff; permanent errors become
`FAILED` with an actionable message. Manual retries prepare fresh containers.

Facebook feed videos are sent directly to the documented `graph-video` endpoint
with a durable outbound marker. Facebook video/Reel/Story finish acknowledgements
are not treated as completed publication: the worker persists acceptance and
polls publication status. The UI shows “Confirming publication” and prevents
edits/cancellation during this stage. Restarts resume polling without another
publish call. Confirmation timeouts, status errors, or a lost connection after
acceptance require delivery review rather than an automatic resend.

A durable `publishStartedAt` marker is saved before calling Meta. If the
outbound response is lost, or the worker crashes after this point, the row
becomes `NEEDS_REVIEW` instead of publishing again automatically. The user must
check the social account and confirm whether publication succeeded. Confirming
it did not publish allows an explicit retry. Confirming it did publish records
manual confirmation; the real publication time/ID may be unavailable.

Disconnecting an account preserves editorial and delivery history. Scheduled
posts for it fail with reconnection guidance. Edit the post to select a newly
connected account. Tokens are loaded/decrypted at delivery time and are never
returned by scheduler APIs. Raw Meta responses are not stored in errors.

A separate `WorkerState` row keyed `scheduler` is refreshed after successful
sweeps, at most once per minute. `/api/scheduler` considers it stale after three
minutes and shows a warning. The existing public health endpoint continues to
report the DM worker; use the scheduler warning and worker logs as well.

## Activation in the existing Vercel + Oracle deployment

Follow [OPERATIONS.md](OPERATIONS.md). These are deployment instructions; adding
source files alone does not activate the feature in production.

1. Take a fresh protected Turso backup and verify the live health endpoint.
2. Run `npm run typecheck`, `npm test`, `npm run lint`, and `npm run build`.
3. Apply `20261006000000_post_scheduler` and
   `20261008000000_scheduler_media`, and
   `20261008010000_scheduler_media_cleanup` with `npm run db:migrate:turso` using
   the intended database environment. The additive migration preserves all
   existing data. Do not point local test workers at production.
4. Deploy the web application using the existing Git/Vercel release procedure.
5. Update the Oracle checkout, install dependencies, regenerate Prisma, and
   restart `kult-worker` as documented in the operations handbook. The same
   worker process now handles both DM jobs and scheduled posts.
6. Configure/approve `instagram_business_content_publish` and
   `pages_manage_posts` in the Meta app as required for its access level.
   OAuth now requests these permissions. Existing accounts must reconnect and
   grant them; old tokens are not upgraded by deploying code.
7. For direct uploads, set `B2_APPLICATION_KEY_ID`, `B2_APPLICATION_KEY`,
   and `B2_BUCKET_ID` on **both web and worker**. Set `B2_BUCKET_NAME` for
   ownership checks. Use a standard bucket-scoped application key with
   `listBuckets`, `listFiles`, `readFiles`, `writeFiles`, `deleteFiles`
   and prefix `scheduler/`; account-wide master keys cannot use S3. Bucket name,
   region and download endpoint are discovered using the B2 Native API.
   Keep the bucket private. Configure browser CORS for the app's exact origins,
   allowing `s3_put`, `s3_get`, `s3_head` and headers `content-type`, `range`.
   See [the Backblaze setup record](BACKBLAZE-SETUP.md) for exact values.
   The authenticated upload route creates a unique workspace object key and a
   15-minute S3 signed PUT bound to its MIME type and exact byte length. The
   browser uploads the original File directly to B2 with progress/cancellation,
   bypassing Vercel's function body limit. No bucket-wide upload token is sent
   to browsers. Completed uploads are attached only after a successful PUT.
   The preview endpoint signs only files belonging to the current workspace.
   Neither upload nor download signatures are persisted in post content.
   Without configured storage, file controls are disabled; public URL scheduling
   remains usable. Changing this environment requires redeploying the web app
   and restarting the worker.
8. Open `/scheduler`, confirm the worker warning clears, and use a designated
   tester account to exercise images, mixed carousels, Reels, and both Story
   types on Instagram/Facebook, plus a Facebook feed video and photo album. Also
   verify draft editing, cancellation, and the published remote post. Real Meta
   delivery requires working account permissions and a suitable public media
   host; automated tests use a simulated Meta publisher.

URL scheduling needs no new application secret. Direct uploads need the optional
Backblaze configuration described above. Keep the existing encryption key.
Do not roll back by dropping `ScheduledPost`: it contains saved content and
history. If disabling publishing, stop/update the scheduler worker and retain
its rows for recovery.

## Local verification

`__tests__/scheduler.test.ts` applies every checked-in migration to a disposable
local libSQL database. It exercises the API, persistence, ownership, competing
claims, revision conflicts, rescheduling/cancellation, HTTP deduplication,
backoff, container readiness, disconnected/expired accounts, crash recovery,
and uncertain delivery. Cleanup tests verify delayed deletion after live
confirmation, shared-file protection, durable retries, concurrent saves/claims,
and duplication after deletion. `__tests__/scheduler-publisher.test.ts` verifies the
Instagram/Facebook HTTP contracts and safe error classification with mocked
Meta responses. `__tests__/scheduler-media.test.ts` verifies file/type and
platform option validation; `__tests__/scheduler-upload.test.ts` checks upload
authorization and token constraints. The worker tests also exercise the actual
HTTP publisher with simulated Meta responses, including asynchronous Facebook
processing. Tests never publish real content or read production tokens.

## API references verified for this implementation

- [Instagram publishing](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/content-publishing/)
- [Instagram media parameters and specifications](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media/)
- [Facebook Page Stories](https://developers.facebook.com/docs/page-stories-api/)
- [Facebook Reels](https://developers.facebook.com/docs/video-api/guides/reels-publishing/)
- [Facebook Page videos](https://developers.facebook.com/docs/graph-api/reference/page/videos/)
- [Backblaze signed URLs and S3 compatibility](https://www.backblaze.com/docs/cloud-storage-s3-compatible-api)
- [Backblaze browser CORS](https://www.backblaze.com/docs/cloud-storage-cross-origin-resource-sharing-rules)
- [Backblaze authorization](https://www.backblaze.com/apidocs/b2-authorize-account)

Meta's actual acceptance still depends on app access level, account permissions,
public media reachability and the supplied file. Automated tests simulate Meta
and storage responses; no real post or upload is sent by the test suite.
