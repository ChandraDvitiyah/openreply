# Backblaze scheduler storage setup

Bucket `Kult-Storage` is private in `us-east-005`. On 8 October 2026, its
connection was verified and the browser CORS rule below was installed. Its
private visibility, retention, encryption, and existing objects were preserved.
The previous CORS configuration is saved outside Git in a protected file.

A standard application key named `kult-scheduler-20261008` was created using the
owner-authorized account credentials. It is restricted to this bucket and the
`scheduler/` prefix, with `listBuckets`, `listFiles`, `readFiles`, `writeFiles`,
and `deleteFiles` capabilities. Deletion permission implements the owner's
explicit request to remove media after live publication. This key cannot change
buckets or manage other keys. The app uses this key rather than master account
credentials. Secret values live in ignored local `.env.local` and the Oracle worker environment
(mode 600), plus Vercel production sensitive environment variables.

## Browser CORS rule

```json
{
  "corsRuleName": "kult-scheduler",
  "allowedOrigins": [
    "https://kultreply.vercel.app",
    "http://localhost:3000",
    "http://127.0.0.1:3000"
  ],
  "allowedOperations": ["s3_put", "s3_get", "s3_head"],
  "allowedHeaders": ["content-type", "range"],
  "exposeHeaders": ["etag", "content-length", "content-range"],
  "maxAgeSeconds": 3600
}
```

CORS permits these origins to make authorized requests; it does not make the
private bucket public. Additional preview domains need their own origin entry.

## App configuration and release

Set `B2_APPLICATION_KEY_ID`, `B2_APPLICATION_KEY`, `B2_BUCKET_ID`, and
`B2_BUCKET_NAME=Kult-Storage` on both Vercel and the Oracle worker. These are
server-only values. Bucket region and download endpoint are discovered through
the Native API. The name is also discoverable but configuring it explicitly
allows ownership validation even before the first storage connection.

The bucket, Vercel production and Oracle credentials are configured. Scheduler
code release `5439a45`, its three migrations and the continuous worker were
deployed on 9 October 2026 (Asia/Kolkata). See the verified release record in
[OPERATIONS.md](OPERATIONS.md).

## Verification

A copy of the repository's existing public preview image was uploaded twice to
a unique object under `scheduler/storage-check/`. Signed PUT, exact bytes on
signed GET, private access denial, and browser CORS preflight were verified.
Permanent deletion removed both versions; signed GET returned 404 afterwards.
The test object is gone. The actual browser upload helper and private preview
component were also verified against B2 from localhost:3000; the preview image
loaded successfully. No live social post was created for these checks.

The same round-trip and permanent version-deletion checks passed with the
production configuration and from the Oracle worker on 9 October 2026, including
CORS for `https://kultreply.vercel.app`. All verification objects were deleted.
