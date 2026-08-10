<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Kult production handoff

Before changing or operating this fork, read `docs/OPERATIONS.md` completely.
It is the canonical record of the live Vercel + Oracle deployment, service
inventory, secret-handling rules, update procedure, and recovery runbooks.

- Work from this nested `openreply` repository, not its parent directory.
- Never commit `.env.local`, private keys, access tokens, database dumps, or
  screenshots that contain credentials.
- The production web app runs on Vercel; only the BullMQ worker runs on Oracle.
  Do not start a second web server on Oracle or replace Turso with PostgreSQL.
- Turso is the only relational database. Upstash Redis is queue/heartbeat state.
- Treat `ENCRYPTION_KEY` as data-critical: changing it makes existing encrypted
  Meta access tokens unreadable unless they are migrated or accounts reconnect.
- Inspect `git status`, verify `/api/health`, and take a Turso dump before a
  schema or production change. Do not deploy merely because you inspected the
  repository; deployment requires the user's current authorization.
