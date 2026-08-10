# Kult: end-to-end setup

> This guide explains local and Meta setup. The project is now deployed. For
> current production topology, service inventory, safe updates, a new-device
> bootstrap, SSH-key reset, and disaster recovery, use
> [OPERATIONS.md](OPERATIONS.md).

Kult combines the upstream OpenReply Instagram automation engine with a Clerk-protected owner workspace and a SQLite/libSQL Link Studio.

The procedures in this guide do not deploy anything automatically. For a fresh
local environment, work through them locally; do not recreate hosting that is
already listed in `OPERATIONS.md`.

When local Instagram testing is complete, continue with the detailed
[production deployment runbook](DEPLOYMENT.md). It covers Hostinger VPS and
Oracle Always Free page by page, including the separate Instagram Login and
Facebook Page Messenger permission flows.

## Your current credential status

The ignored `.env.local` file already contains the Clerk development keys, Turso URL/token, and Meta Basic Settings credentials you supplied. They are not committed to Git.

| Item | Status | Exact source |
| --- | --- | --- |
| Clerk development publishable key | Added | Clerk Dashboard → your app → **API keys** |
| Clerk development secret key | Added, but rotate it | Same Clerk **API keys** screen |
| Turso database URL and token | Added, but rotate the token | Turso database → **Connect** |
| Meta/Facebook App ID, App Secret, Client Token | Added for reference | Meta App Dashboard → **App settings** → **Basic** |
| Instagram App Secret | Added, but verify and rotate it | Meta App Dashboard → Instagram use case/product → **API setup with Instagram login** |
| Instagram App ID | Added | Same Instagram API setup screen; this is the numeric Instagram-specific ID |
| Upstash TLS Redis URL | Added and the worker connected successfully, but rotate the exposed credential | Upstash Console → your Redis database → **Connect** → Redis/ioredis URL |
| Webhook verify token | Generated and added | This is your private value; Meta does not generate it |
| Encryption key | Generated and added | This encrypts Instagram access tokens stored in Turso |
| Public HTTPS URL | Current ngrok URL added for local testing | Replace it whenever ngrok assigns a new URL, and later with your final domain |
| Support/contact email | Added | Use the same monitored email in the Meta app listing |

The Meta **Client Token is not used** by Kult's server-side Instagram OAuth flow. Do not substitute it for an App Secret or access token.

## What is free, and what is not

- Clerk's Hobby plan is free within its published limits.
- Turso provides the single hosted SQLite-compatible database for both automations and Link Studio.
- Meta's Instagram API does not charge per message, but the account must be a Business or Creator account.
- BullMQ uses Upstash Redis's TLS Redis endpoint for jobs, retries, rate limiting, and worker health.
- BullMQ checks Redis even while idle. Watch the Upstash command meter because continuous workers can consume free-tier requests.
- A permanently hosted $0 setup depends on third-party free tiers. They can change. Treat $0 as a personal-project target, not a lifetime price guarantee.
- Vercel Hobby is for personal, non-commercial use. Use a commercial hosting plan before using Kult for paying customers.

## 1. Install the local prerequisites

Install:

- Node.js 22 or newer
- Git

The actual app is the nested fork. Every command in this guide must be run from it:

```bash
cd /Users/nishant/Documents/Code/Personal/kult/openreply
```

If the terminal prompt only says `.../kult`, you are one folder too high. That is why `npm run worker` reports “Missing script: worker”.

Then run:

```bash
npm install
npm run db:generate
```

Your `.env.local` already exists, so do not overwrite it with `.env.example`.

There is no Docker, local PostgreSQL, or local Redis requirement now. The final storage layout is:

| Component | Storage | Why |
| --- | --- | --- |
| All relational application data | Your Turso/libSQL database | Clerk-linked users, workspaces, Instagram accounts, automations, media targets, logs, reports, Link Studio, and clicks |
| Pending jobs, retries, rate limits, worker health | Upstash Redis through `rediss://` | Queue/cache only; no PostgreSQL is used |

The OpenReply tables were migrated from Prisma's PostgreSQL adapter to the official libSQL adapter. PostgreSQL array columns were converted to JSON string lists because SQLite does not have a native array type.

## 2. Create the Clerk app

1. Open [dashboard.clerk.com](https://dashboard.clerk.com/) and select the application associated with the supplied keys.
2. At the top of the dashboard, make sure **Development** is selected. Your current keys begin with `pk_test_` and `sk_test_`; they are development keys.
3. Open **Configure** → **API keys**. This is where the publishable and secret keys come from.
4. Open **User & authentication** → **Email, phone, username** and enable email-address sign-in. Enable Google under **Social connections** only if you want it.
5. The local file uses these Next.js names:

```dotenv
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/login
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/login
```

Do not use `VITE_CLERK_PUBLISHABLE_KEY`; this is a Next.js application, so the browser-safe variable must be `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`. Never put `CLERK_SECRET_KEY` in a `NEXT_PUBLIC_` variable.

The public routes are `/`, `/privacy`, `/terms`, `/data-deletion`, `/u/:slug`, `/go/:id`, the Meta webhook, OAuth callback, legal pages, and Clerk's authentication endpoints. Dashboard and data-changing API routes require Clerk on the server.

## 3. Run Kult locally

Before starting the processes, complete sections 4 and 6 so `.env.local` has the real Instagram App ID, private encryption values, and Upstash TLS URL. Apply the Turso schema once with:

```bash
npm run db:migrate:turso
```

The current Turso baseline has already been applied successfully. Running the
command again is safe and should print `skip 20260804193000_turso_baseline`.
The migration script now loads `.env.local` itself; you do not need to export
`TURSO_DATABASE_URL` manually.

This creates only the missing automation tables and `_kult_migrations` history table. It does not deploy the web app. Link Studio's existing `bio_*` tables can remain in the same database.

Open two terminals and run the exact `cd` command in each one first.

Terminal one:

```bash
npm run dev
```

Terminal two:

```bash
npm run worker
```

Visit `http://localhost:3000/login`, sign in, then open Link Studio. Add one ordinary link and one smart app link. Your public page is `http://localhost:3000/u/YOUR-SLUG`.

Public pages to verify before configuring Meta:

```text
http://localhost:3000/
http://localhost:3000/privacy
http://localhost:3000/terms
http://localhost:3000/data-deletion
```

If `/` says “Building your site”, another starter server is occupying port 3000. Stop that terminal/process and start `npm run dev` from the nested `openreply` folder.

Test click routing:

1. Ordinary browser: `/go/:id` returns a normal redirect.
2. Android: a smart link uses the Google Play URL when supplied.
3. iPhone Safari: a smart link uses the App Store URL when supplied.
4. Instagram/Threads on iOS: App Store links receive a small escape page with an automatic attempt, a real tap target, and manual fallback instructions.

The Instagram and Facebook escape URL schemes are undocumented. The manual fallback is deliberate—retest after major app updates.

## 4. Create the Meta app

You need a Facebook account and an Instagram Business or Creator account. A personal Instagram account cannot connect.

### 4A. Confirm the Basic Settings values you already supplied

1. Open [developers.facebook.com/apps](https://developers.facebook.com/apps/) and select the app.
2. Open **App settings** → **Basic**.
3. This screen contains the Meta/Facebook **App ID**, **App secret**, and **Client token** you supplied. These are now recorded in `.env.local` as `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`, and `META_CLIENT_TOKEN`.
4. On the same screen, fill in your app display name, contact email, privacy-policy URL, terms URL, data-deletion instructions URL, category, and app icon when you have a public HTTPS domain.

Use these public URLs, replacing `https://YOUR-DOMAIN`:

```text
Privacy Policy:            https://YOUR-DOMAIN/privacy
Terms and Conditions:      https://YOUR-DOMAIN/terms
Data Deletion Instructions:https://YOUR-DOMAIN/data-deletion
```

### 4B. Find the Instagram-specific OAuth credentials still missing

1. In the app dashboard, open **Use cases**.
2. Add or customize **Manage messaging and content on Instagram**.
3. Open the Instagram API setup screen. Depending on Meta's current sidebar, it is labelled **Instagram** → **API setup with Instagram login**, **Set up Instagram business login**, or appears inside that use case's **Customize** screen.
4. Copy the **Instagram App ID** shown on that Instagram screen into `INSTAGRAM_APP_ID`.
5. Click **Show** beside the Instagram App Secret, re-enter your Meta password if requested, and copy it into `INSTAGRAM_APP_SECRET`.
6. Do not copy the Basic Settings Client Token into either field.

The Instagram App ID can differ from the Meta/Facebook App ID on **App settings → Basic**. Kult's authorization URL uses the Instagram-specific value. It should be an ID—not the same hexadecimal string as the secret. Leave `INSTAGRAM_APP_ID` blank until you copy the actual value.

### 4C. Create the two private values Meta does not provide

From the nested `openreply` folder, generate:

```bash
openssl rand -hex 32
```

Put that 64-character output in `ENCRYPTION_KEY`. It encrypts stored Instagram access tokens. Generate a second random value for `WEBHOOK_VERIFY_TOKEN`:

```bash
openssl rand -hex 32
```

You choose this verify token. Later, paste the exact same value into Meta's webhook form.

Your final Meta section should contain:

```dotenv
META_GRAPH_API_VERSION=v25.0
INSTAGRAM_APP_ID=...
INSTAGRAM_APP_SECRET=...
FACEBOOK_APP_SECRET=...
FACEBOOK_APP_ID=...
META_CLIENT_TOKEN=...
WEBHOOK_VERIFY_TOKEN=use-a-long-random-value
ENCRYPTION_KEY=64-hex-characters
```

### 4D. Add all 6–7 Instagram accounts for development testing

For every account:

1. Confirm it is an Instagram **Business** or **Creator** account, not Personal.
2. In the Meta app dashboard, open **App roles** → **Roles**, or the Instagram setup screen's tester/token section.
3. Add the exact Instagram username as an Instagram tester.
4. Log into that Instagram account on the phone.
5. Open Instagram **Settings and activity** → **Apps and websites** → **Tester invites** and accept the invitation. Meta sometimes moves this menu; search Settings for “tester” or “apps and websites” if needed.
6. Repeat for all accounts. Their login emails can all be different; Meta links them by Instagram authorization, not by your Clerk email.

### 4E. Register OAuth and webhook URLs

For local webhook testing, create an HTTPS tunnel to port 3000, put that public URL in `NEXT_PUBLIC_APP_URL`, and restart both processes.

Register these exact Meta URLs, replacing `YOUR_PUBLIC_URL` with the HTTPS tunnel or final domain:

```text
OAuth redirect:  YOUR_PUBLIC_URL/api/instagram/callback
Webhook:         YOUR_PUBLIC_URL/api/webhook
```

For OAuth, open the Instagram setup's **Business login settings** and add the callback exactly, with no trailing slash.

For the webhook, open the Instagram setup's **Configure webhooks** section:

1. Paste the callback URL.
2. Paste your `WEBHOOK_VERIFY_TOKEN` value.
3. Click **Verify and save**.
4. Subscribe to `comments`, `messages`, and `messaging_postbacks`.
5. If Meta offers a test action, send a test event and inspect the Kult worker/web logs.

### Webhook verification troubleshooting

Run the web app from the nested fork and keep that terminal open:

```bash
cd /Users/nishant/Documents/Code/Personal/kult/openreply
npm run dev
```

Then confirm all of the following:

1. `NEXT_PUBLIC_APP_URL` in `.env.local` is the currently running ngrok HTTPS URL, with no trailing slash.
2. The callback in Meta is exactly `YOUR_NGROK_URL/api/webhook`, with no trailing slash.
3. The verify-token field in Meta contains the exact `WEBHOOK_VERIFY_TOKEN` value from `.env.local`. Do not paste the variable name, surrounding quotes, or spaces.
4. Restart `npm run dev` after changing `.env.local`; Next.js must reload the token.
5. Do not use the App ID, App Secret, Client Token, encryption key, or cron secret as the webhook verify token.

Kult also has a tunnel diagnostic:

```bash
npm run check:webhook
```

It sends the same challenge Meta sends and prints only success or a safe HTTP
error. Because webhook verification puts the verify token in a query string,
ngrok can display it in its request inspector. Do not share screenshots of that
request. Rotate the verify token after local tunnel testing if the inspector was
shared or exposed.

The webhook App ID/App Secret are not checked during Meta's initial verification
GET. They matter later for OAuth and for validating signed POST events. If the
diagnostic succeeds but Meta still fails, confirm that Meta is editing the same
Instagram app/product whose callback screen you configured, and that ngrok has
not assigned a new hostname.

Real comment events for ordinary accounts require the app to be Live and the needed permissions approved. Development mode is for app-role/tester accounts.

### 4F. Connect Facebook Pages and Messenger

Facebook Page access is a separate OAuth grant even when Instagram and
Messenger are products in the same Meta app.

1. In Meta App Dashboard, add/configure **Facebook Login** and **Messenger**.
2. Under **Facebook Login → Settings**, add this exact redirect URI:

```text
YOUR_PUBLIC_URL/api/facebook/callback
```

3. Under **Messenger → Messenger API settings → Webhooks**, use:

```text
Callback URL: YOUR_PUBLIC_URL/api/webhook
Verify token: your exact WEBHOOK_VERIFY_TOKEN
```

4. Select the **Page** object and subscribe `messages`,
   `messaging_postbacks`, and `feed`.
5. In Kult, open **Settings → Connect Facebook** and approve the Pages you
   manage. Kult requests `pages_show_list`, `pages_manage_metadata`,
   `pages_read_engagement`, `pages_manage_engagement`, and `pages_messaging`.
6. Confirm each Page says **Webhook ready**.
7. Open **Messenger** in Kult. Create either an **Inbound Messenger
   auto-reply** or **Post comment → private reply** flow.

For a post-specific comment automation, enter the full Meta post ID, commonly
shaped like `PAGE_ID_POST_ID`. Choose **every Page post** to avoid manual post
IDs. Page comment events come through the `feed` field, while inbox messages
come through `messages`.

Development mode works only for people and Pages associated with app roles.
Serving unrelated Page owners requires Meta App Review and Advanced Access for
the Page permissions above.

## 5. Test comment-to-DM end to end

1. Sign in to Kult.
2. Open Settings and connect the Instagram professional account.
3. Create a campaign for a reel or post with keyword `TEST`.
4. From a different Instagram account, comment `TEST`.
5. Confirm a DM arrives.
6. If it does not, check `/api/health`, DM Logs, and the worker terminal.

The sender must initiate the interaction by commenting or messaging. Do not use this project for cold DMs, bulk outreach, scraping, or browser automation.

### Automatically include future reels

When creating a comment automation, set the trigger scope to **Every new reel from now on**. Then choose either:

- **Any comment** to reply to every eligible comment on each future reel, or
- **Keyword** and enter the words that must appear in the comment.

This is persistent: it is not limited to the next reel. The worker checks the connected account's recent media, records every reel published after the campaign was enabled, and includes those reels in normal webhook and reconciliation processing. Keep `npm run worker` running; the default reconciliation interval is five minutes, so a comment received immediately after publishing can be recovered on the next sweep.

### Connect your 6–7 Instagram accounts

The Instagram account email does not need to match your Clerk login. Use one Clerk owner account for Kult, then connect each Instagram Business or Creator account separately from **Settings**. Create campaigns for the selected Instagram account; campaigns, media, logs, and tokens remain associated with that account.

While the Meta app is in Development mode, add every Instagram account as a tester/app-role account and accept each invitation. Each account must be professional and must authorize the Meta app. Different Instagram emails are fine. Use separate Kult/Clerk users only if different people need isolated dashboards; that requires a deliberate multi-user/organization access model before launch.

### Performance dashboard and Meta insights

Open `/dashboard` after connecting the accounts. Kult combines two kinds of
measurement:

- Meta insights: Instagram/Facebook views or impressions, reach, reactions,
  comments, saves where available, shares, and interactions.
- Kult events: Instagram/Facebook automated DMs, DM tracked-link redirects,
  public bio-page views, unique visitors, and bio-link redirects.

Choose 7, 30, or 90 days. The first visit to a new reporting window refreshes
all connected accounts; **Refresh Meta data** performs the same sync manually.
The worker refreshes the 30-day snapshot every 12 hours so the dashboard stays
current even when nobody opens it. Set `PERFORMANCE_SYNC_INTERVAL_MS` only if
you need to change that interval.

Instagram accounts must grant `instagram_business_manage_insights`. If an
account was connected before that permission was added, reconnect it from
Settings. Facebook Page views/reach require `pages_read_engagement`. Facebook
organic Page-post saves are shown as unavailable because Meta does not expose a
stable saves metric for them.

## 6. Finish Turso and Upstash

### 6A. Turso—the single application database

You already created the Turso database and the baseline has been applied. After rotating the token that was pasted into chat, open the Turso database's **Connect** screen and put the new values in `.env.local`:

```dotenv
TURSO_DATABASE_URL=libsql://YOUR-DATABASE.turso.io
TURSO_AUTH_TOKEN=YOUR_NEW_TOKEN
LOCAL_DATABASE_URL=file:./data/kult-prisma.db
```

From the nested `openreply` directory, apply the checked-in SQLite baseline:

```bash
npm run db:migrate:turso
```

Expected first-run output:

```text
applied 20260804193000_turso_baseline
```

Running it again is safe and prints `skip ...`. Do not run `prisma migrate deploy` against Turso; Prisma's remote libSQL transport does not support that workflow. Future schema work is generated locally with `npm run db:migrate:local -- --name YOUR_CHANGE`, reviewed, then applied remotely with `npm run db:migrate:turso`.

### 6B. Upstash Redis—BullMQ queue only

1. Open [console.upstash.com](https://console.upstash.com/) and sign in.
2. Open **Redis** and click **Create database**.
3. Name it `kult-queue` and select a primary region close to your Turso database and worker. Your Turso database is in AWS `ap-south-1`, so choose Mumbai/India when Upstash offers it.
4. Choose the free plan if it is available for your account, then create the database.
5. Open the database and click **Connect**.
6. Select the normal Redis/ioredis connection option and reveal/copy the complete password. The REST URL/token are a different API and cannot run BullMQ.
7. If Upstash shows `redis://...` plus a separate `--tls` flag, change only the prefix to `rediss://`. Copy the complete value shaped like:

```text
rediss://default:PASSWORD@HOST.upstash.io:6379
```

8. Put the entire unmasked value, including `rediss://`, in `.env.local`:

```dotenv
UPSTASH_REDIS_URL=rediss://default:PASSWORD@HOST.upstash.io:6379
```

Do not use `UPSTASH_REDIS_REST_URL`, an `https://` URL, or the REST token. BullMQ needs Redis protocol commands and blocking connections. Kult rejects a non-TLS/non-`rediss://` value at startup.

The required value for the current database therefore has this shape (replace
the placeholder with the actual Redis password shown by Upstash):

```dotenv
UPSTASH_REDIS_URL=rediss://default:ACTUAL_REDIS_PASSWORD@quiet-sheepdog-103818.upstash.io:6379
```

After saving `.env.local`, start the worker from the nested fork:

```bash
cd /Users/nishant/Documents/Code/Personal/kult/openreply
npm run worker
```

Expected startup output begins with `[DM Worker] Started`. If the prompt path
ends in `/kult` instead of `/kult/openreply`, npm will report `Missing script:
"worker"` because the parent folder is not the application.

Upstash documents BullMQ compatibility but warns that BullMQ polls Redis regularly even with no jobs. Check **Redis → your database → Usage** during the first few days so the worker stays inside your free allowance.

## 7. Optional hosting paths you execute yourself

### Personal, low-traffic split

- Web app: Vercel Hobby (personal/non-commercial only)
- All application data: Turso Free
- Authentication: Clerk Hobby
- Queue and rate limiting: Upstash Redis
- Always-on worker: an Oracle Cloud Always Free compute instance, or another always-on host you control

The web app and worker must share `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `UPSTASH_REDIS_URL`, and the exact same `ENCRYPTION_KEY`. The worker cannot run as a normal serverless function because it continuously consumes BullMQ jobs.

### Single-worker $0 target

Run the Next.js app and worker on an always-on compute instance while Turso and Upstash remain managed services. Put an HTTPS reverse proxy in front. No PostgreSQL or self-hosted Redis service is needed.

Whichever path you choose:

1. Fork this repository into your GitHub account.
2. Create the hosted resources yourself.
3. Add environment variables in each provider—never commit `.env`.
4. Run `npm run db:migrate:turso` yourself once before starting the app.
5. Start both `npm run start` and `npm run worker`.
6. Update Clerk allowed origins/redirects.
7. Update Meta OAuth and webhook URLs to the final HTTPS domain.
8. Test with a second Instagram account before sharing the URL.

## 8. Before inviting other Instagram accounts

Your own tester accounts can be used while the Meta app is in development. Letting unrelated people connect their Instagram accounts usually requires Meta App Review, Advanced Access for the needed permissions, a complete screencast, written permission justifications, a privacy policy, data deletion flow, and often business verification.

Do not market this as a public ManyChat replacement until Meta has approved your app for that use.

## Security checklist

- Keep `.env` out of Git.
- Rotate any secret pasted into chat, logs, screenshots, or issue trackers.
- Use a unique 64-character hex encryption key and back it up securely.
- Use only Upstash's TLS `rediss://` Redis URL.
- Keep Clerk checks next to every protected database operation.
- Validate Meta webhook signatures; the upstream route already does this.
- Retest the iOS in-app-browser escape after major Instagram updates.
- Back up the Turso database before schema changes.
