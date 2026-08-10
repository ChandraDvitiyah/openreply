# Kult deployment runbook

This runbook is intentionally operator-driven: it prepares Kult for production,
but no hosting account or application is deployed automatically.

Last checked: 8 August 2026.

## 1. Know what is supported

| Capability | Status |
| --- | --- |
| Instagram comment or reel comment → private reply | Supported |
| Instagram keyword or any-comment rules | Supported |
| Automatically include every future reel | Supported; worker must stay online |
| Instagram inbound-DM auto-responder | Supported |
| Instagram opening-DM button postbacks | Supported; subscribe `messaging_postbacks` |
| Multiple Instagram Business/Creator accounts | Supported |
| Facebook Page Messenger automation | Supported |
| Facebook post comment → private Messenger reply | Supported |

Instagram and Messenger remain separate Meta APIs, but Kult now connects both.
Facebook Pages use encrypted Page access tokens, `object: "page"` webhook
payloads, Page permissions, and Page-specific queue jobs. Instagram accounts
continue to use Instagram Login and `object: "instagram"` events.

## 2. Pick the hosting path

### Recommended: one Hostinger VPS

Use one VPS for both the Next.js web process and the continuous BullMQ worker.
Turso, Upstash, and Clerk remain managed services.

Hostinger India currently advertises KVM 1 at ₹599/month on its introductory
term (1 vCPU, 4 GB RAM, 50 GB NVMe), renewing at ₹999/month on the displayed
two-year renewal term. KVM 2 is ₹779/month on the displayed introductory term
(2 vCPU, 8 GB RAM), renewing at ₹1,199/month. Prices are paid upfront and can
change with term, tax, currency, and promotion. KVM 1 is enough to begin with
6–7 connected accounts; add the swap file in section 11. Choose KVM 2 if you
want faster builds or expect multiple users and heavier analytics refreshes.

Hostinger's managed Node.js hosting documents a web-app process but does not
promise a second permanently running BullMQ process. Kult needs both the Next.js
web process and an always-on worker, so use the VPS unless Hostinger support
explicitly confirms that the managed plan can run both persistent processes.

- [Hostinger Node.js options](https://www.hostinger.com/support/node-js-hosting-options-at-hostinger/)
- [Hostinger's current Node.js/VPS offers](https://www.hostinger.com/nodejs-hosting)

### $0 compute target: Oracle Cloud Always Free

Use one Ubuntu Ampere A1 VM for both processes. Oracle currently documents up to
2 OCPUs and 12 GB RAM of A1 capacity across Always Free VMs. Capacity can be
unavailable in a region, and account creation normally requires phone and card
verification. Only select resources marked **Always Free eligible**.

- [Oracle Always Free resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)

This can make compute $0, but a true production Clerk setup still needs a domain
you control and DNS access. Therefore “completely $0 forever” is not guaranteed.

### Why not Vercel-only

Vercel can serve the Next.js application, but a Vercel Function has a finite
execution duration. It cannot host Kult's continuously polling BullMQ worker.
Vercel Hobby is also limited to personal, non-commercial use. A Vercel web app
would still need an Oracle/Hostinger/other always-on worker, creating a more
complicated two-host setup.

- [Vercel Hobby limits](https://vercel.com/docs/plans/hobby)
- [Vercel Function duration limits](https://vercel.com/docs/functions/limitations)

## 3. Production prerequisites

Before buying or creating a VM, obtain:

1. A domain you control, such as `example.com`.
2. A chosen app hostname, such as `app.example.com`.
3. A GitHub fork containing the Kult changes.
4. New production secrets. Every secret pasted into a chat must be rotated.
5. A Clerk Production instance with `pk_live_` and `sk_live_` keys.
6. The existing Turso database and a newly rotated Turso token.
7. The existing Upstash database and newly rotated Redis credentials.
8. A Meta app with the Instagram product/use case configured.

Do not use Clerk's `pk_test_` and `sk_test_` keys for the final internet-facing
site. Clerk documents that production requires a Production instance, a domain,
DNS records, and production keys.

- [Clerk production deployment](https://clerk.com/docs/guides/development/deployment/production)

## 4. Create the real GitHub fork

The local checkout currently points `origin` at the upstream OpenReply
repository. Fix this before attempting hosting.

### GitHub website

1. Open <https://github.com/Jurredr/openreply>.
2. Click **Fork** in the top-right.
3. Under **Owner**, choose your GitHub account.
4. Set **Repository name** to `kult` or `openreply`.
5. Optionally make it private.
6. Click **Create fork**.

### Local terminal

Replace `YOUR_GITHUB_USERNAME` below:

```bash
cd /Users/nishant/Documents/Code/Personal/kult/openreply
git remote rename origin upstream
git remote add origin https://github.com/YOUR_GITHUB_USERNAME/kult.git
git remote -v
```

Review the changed files, then create the first Kult commit yourself:

```bash
git status
npm run typecheck
npm test
npm run build
git add -A
git commit -m "Build Kult Instagram automation and link studio"
git push -u origin main
```

`.env.local` is ignored and must never appear in `git status` or the commit.

## 5. Configure the production domain

Use `app.example.com` throughout this guide. Replace it with your real hostname.

At the DNS provider, create:

| Type | Name | Value |
| --- | --- | --- |
| A | `app` | Public IPv4 address of the VPS/Oracle VM |

Use a 300-second TTL during setup. DNS can be changed to a longer TTL after the
site is stable.

Do not point Meta or Clerk at the final hostname until DNS resolves to the
server and HTTPS works.

## 6. Promote Clerk page by page

1. Open <https://dashboard.clerk.com/> and select the existing Kult app.
2. Click the **Development** selector at the top.
3. Select **Create production instance**.
4. Choose **Clone development settings**.
5. Open **Configure → Domains**.
6. Enter the production domain requested by Clerk.
7. Copy every DNS record Clerk displays into your DNS provider exactly.
8. Wait until Clerk shows the domain and certificates as verified.
9. Open **Configure → API keys**.
10. Copy the `pk_live_...` publishable key and `sk_live_...` secret key into the
    server's `.env.local`; do not overwrite the local development keys on your
    Mac unless you intend to use production locally.
11. Open **User & authentication → Email, phone, username** and confirm email
    sign-in is enabled.
12. If Google/Apple sign-in is enabled, configure your own production OAuth
    credentials. Clerk's shared development OAuth credentials do not carry over.
13. Configure any redirect allowlist to include:
    `https://app.example.com/login` and `https://app.example.com/dashboard`.

Production values:

```dotenv
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_REPLACE_ME
CLERK_SECRET_KEY=sk_live_REPLACE_ME
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/login
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/signup
```

## 7. Rotate service credentials before production

### Turso

1. Open the Turso dashboard/CLI for the Kult database.
2. revoke the token pasted into chat;
3. create a new read-write application token;
4. keep the same `libsql://` URL;
5. place the new token only in the server environment.

### Upstash

1. Open **Upstash Console → Redis → quiet-sheepdog-103818**.
2. Reset/revoke the exposed database credentials and REST token.
3. Open **Connect → Node/ioredis**.
4. Reveal the new complete TLS URL.
5. Store the `rediss://` value as `UPSTASH_REDIS_URL`.

Kult does not use `UPSTASH_REDIS_REST_URL` or
`UPSTASH_REDIS_REST_TOKEN`.

### Application and Meta secrets

Rotate before connecting production Instagram accounts:

- `CLERK_SECRET_KEY`
- `TURSO_AUTH_TOKEN`
- Upstash Redis password and REST token
- `FACEBOOK_APP_SECRET`
- `INSTAGRAM_APP_SECRET`
- `WEBHOOK_VERIFY_TOKEN`
- `CRON_SECRET`
- `ENCRYPTION_KEY`

Rotate `ENCRYPTION_KEY` before connecting accounts. Once tokens are encrypted in
Turso, changing this key requires a token re-encryption migration or reconnecting
every Instagram account.

## 8. Configure Meta for the final domain

### App settings → Basic

Open <https://developers.facebook.com/apps/>, choose the app, then open **App
settings → Basic**.

Set:

```text
App domain:                 app.example.com
Privacy Policy URL:         https://app.example.com/privacy
Terms of Service URL:       https://app.example.com/terms
User data deletion URL:     https://app.example.com/data-deletion
Contact email:              your monitored support email
Category:                   Business and Pages (or closest available category)
```

Save changes.

### Instagram → API setup with Instagram login

Depending on Meta's current navigation, open **Use cases → Manage messaging and
content on Instagram → Customize**, or **Instagram → API setup with Instagram
login**.

1. Confirm the numeric Instagram App ID matches `INSTAGRAM_APP_ID`.
2. Reveal the Instagram App Secret and put the rotated value in
   `INSTAGRAM_APP_SECRET`.
3. Under **Business login settings**, add this exact OAuth redirect:

```text
https://app.example.com/api/instagram/callback
```

4. Under **Configure webhooks**, enter:

```text
Callback URL: https://app.example.com/api/webhook
Verify token: the exact WEBHOOK_VERIFY_TOKEN value from the server
```

5. Click **Verify and save**.
6. Subscribe to `comments`, `messages`, and `messaging_postbacks`.
7. `live_comments` is optional unless live-video comments should be handled.

The app also subscribes each connected Instagram professional account to those
fields during OAuth. Meta's official API examples show Instagram comment
webhooks as `object: "instagram"`, while `messaging_postbacks` is the field used
when a user presses a messaging template button.

- [Official Meta Instagram API workspace](https://www.postman.com/meta/instagram/overview)
- [Official Meta Messenger webhook fields](https://www.postman.com/meta/messenger-platform-api/folder/22794852-b5d97624-14d8-4e67-a2e4-529add49ca58)

### Messenger product

Open **Messenger → Messenger API settings** and configure the same webhook:

```text
Callback URL: https://app.example.com/api/webhook
Verify token: the exact WEBHOOK_VERIFY_TOKEN value from the server
```

Select the **Page** object and subscribe `messages`, `messaging_postbacks`, and
`feed`. Under **Facebook Login → Settings**, add this OAuth redirect URI:

```text
https://app.example.com/api/facebook/callback
```

Kult requests `pages_show_list`, `pages_manage_metadata`,
`pages_read_engagement`, `pages_manage_engagement`, and `pages_messaging`.
After signing in from **Settings → Connect Facebook**, every Page returned by
Meta is encrypted in Turso and subscribed to the required Page fields. Create
inbox and comment-private-reply flows from the **Messenger** dashboard page.

### Development roles and production review

While the app is in Development mode, add each of your 6–7 Instagram accounts as
an app role/tester and accept the invitation in Instagram. Different account
emails are fine.

Before unrelated users can connect accounts, switch the app to Live and request
the relevant Advanced Access permissions. Prepare a screencast showing login,
account connection, campaign creation, a real comment, the resulting DM, privacy
policy, and data-deletion instructions.

## 9. Create the Hostinger VPS

Skip to section 10 if using Oracle Always Free.

1. Open Hostinger and choose **VPS Hosting**.
2. Select **KVM 1** to start (1 vCPU, 4 GB RAM), or **KVM 2** for more build and
   analytics headroom.
3. Check the total term price and renewal price, not only the promotional monthly
   number.
4. Choose a data-center region close to India/Mumbai if available, because the
   Turso database is in `ap-south-1`.
5. In hPanel, open **VPS → Manage → OS & Panel → Operating System**.
6. Select **Ubuntu 24.04 LTS, plain OS**. A control panel is unnecessary.
7. Add your SSH public key. Do not rely only on a reusable root password.
8. Open **VPS → Firewall** and allow inbound TCP ports 22, 80, and 443.
9. Copy the VPS public IPv4 address into the domain's DNS A record.

## 10. Create the Oracle Always Free VM

1. Open Oracle Cloud Console.
2. Confirm the home region you choose has acceptable latency and available A1
   capacity. Always Free compute must be created in the home region.
3. Open **Compute → Instances → Create instance**.
4. Name it `kult-production`.
5. Select **Ubuntu 24.04**.
6. Click **Change shape → Ampere → VM.Standard.A1.Flex**.
7. Select at most the resources marked Always Free eligible; the currently
   documented allowance is 2 OCPUs and 12 GB RAM total.
8. Use a 50 GB boot volume and confirm it remains Always Free eligible.
9. Create a new VCN or use an existing public subnet.
10. Assign a public IPv4 address.
11. Upload/paste your SSH public key.
12. Create the instance.
13. In the subnet's **Security List → Add ingress rules**, allow TCP 22, 80, and
    443 from the appropriate sources. Restrict port 22 to your IP when practical.
14. Point the domain A record at the VM's public IPv4 address.

If Oracle reports **Out of host capacity**, use another availability domain or
try later; Oracle documents this as a possible Always Free limitation.

## 11. Install Kult on either server

SSH to the server. Hostinger usually begins with `root`; Oracle Ubuntu uses the
`ubuntu` user.

### Create an unprivileged application user

```bash
sudo adduser --disabled-password --gecos "" kult
sudo mkdir -p /opt/kult
sudo chown kult:kult /opt/kult
```

### Install Node.js 22, Nginx, Certbot, and Git

```bash
sudo apt update
sudo apt upgrade -y
curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/nodesource_setup.sh
sudo -E bash /tmp/nodesource_setup.sh
sudo apt install -y nodejs git nginx certbot python3-certbot-nginx
sudo npm install -g pm2
node --version
npm --version
```

The Node version must be 22 or newer.

### Add a 2 GB swap file on KVM 1

This prevents a production build from being killed if the 4 GB VM is briefly
short of memory:

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
free -h
```

### Clone your fork

For a public fork:

```bash
sudo -u kult git clone https://github.com/YOUR_GITHUB_USERNAME/kult.git /opt/kult
cd /opt/kult
sudo -u kult npm ci
```

For a private fork, create a read-only GitHub deploy key and clone with SSH.

### Create the production environment

```bash
sudo -u kult nano /opt/kult/.env.local
sudo chmod 600 /opt/kult/.env.local
sudo chown kult:kult /opt/kult/.env.local
```

Fill every value below. Never paste placeholder text:

```dotenv
NEXT_PUBLIC_APP_URL=https://app.example.com
NEXT_PUBLIC_SUPPORT_EMAIL=you@example.com

NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_REPLACE_ME
CLERK_SECRET_KEY=sk_live_REPLACE_ME
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/login
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/signup

TURSO_DATABASE_URL=libsql://YOUR_DATABASE.turso.io
TURSO_AUTH_TOKEN=REPLACE_ME
LOCAL_DATABASE_URL=file:./data/kult-prisma.db

UPSTASH_REDIS_URL=rediss://default:REPLACE_ME@YOUR_DATABASE.upstash.io:6379

META_GRAPH_API_VERSION=v25.0
FACEBOOK_APP_ID=REPLACE_ME
FACEBOOK_APP_SECRET=REPLACE_ME
META_CLIENT_TOKEN=REPLACE_ME
INSTAGRAM_APP_ID=REPLACE_ME
INSTAGRAM_APP_SECRET=REPLACE_ME
WEBHOOK_VERIFY_TOKEN=REPLACE_ME

ENCRYPTION_KEY=REPLACE_WITH_64_HEX_CHARACTERS
CRON_SECRET=REPLACE_WITH_A_LONG_RANDOM_VALUE
```

Generate fresh application secrets with:

```bash
openssl rand -hex 32
```

Use separate outputs for `ENCRYPTION_KEY`, `WEBHOOK_VERIFY_TOKEN`, and
`CRON_SECRET`.

### Build and migrate

```bash
cd /opt/kult
sudo -u kult npm run db:generate
sudo -u kult npm run db:migrate:turso
sudo -u kult npm run build
```

The migration should either apply the baseline or print `skip` when it is
already present. This does not create PostgreSQL; all runtime relational data is
stored in Turso.

### Start both processes with PM2

```bash
cd /opt/kult
sudo -u kult pm2 start ecosystem.config.cjs
sudo -u kult pm2 status
sudo -u kult pm2 logs --lines 100
```

Both `kult-web` and `kult-worker` must show `online`. Worker logs should contain:

```text
[DM Worker] Started
```

Configure boot startup:

```bash
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u kult --hp /home/kult
sudo -u kult pm2 save
```

Run the exact command PM2 prints if it differs from the example.

## 12. Configure Nginx and HTTPS

Create `/etc/nginx/sites-available/kult`:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name app.example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

Enable it:

```bash
sudo ln -s /etc/nginx/sites-available/kult /etc/nginx/sites-enabled/kult
sudo rm /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

Issue the free Let's Encrypt certificate only after DNS resolves:

```bash
sudo certbot --nginx -d app.example.com
sudo certbot renew --dry-run
```

If Ubuntu's firewall is enabled:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo ufw status
```

## 13. Schedule maintenance

The worker already polls comments and persistent future-reel campaigns. Two HTTP
maintenance endpoints still handle token refresh and the older one-time “next
reel” mode. The checked-in scripts call them over localhost without putting
`CRON_SECRET` in the crontab.

Test manually:

```bash
cd /opt/kult
sudo -u kult npm run maintenance:reels
sudo -u kult npm run maintenance:tokens
```

Edit the `kult` user's crontab:

```bash
sudo -u kult crontab -e
```

Add:

```cron
*/5 * * * * cd /opt/kult && /usr/bin/npm run maintenance:reels >> /home/kult/maintenance.log 2>&1
17 5 * * * cd /opt/kult && /usr/bin/npm run maintenance:tokens >> /home/kult/maintenance.log 2>&1
```

## 14. Production verification, in order

1. `https://app.example.com/` shows the Kult landing page.
2. `/privacy`, `/terms`, and `/data-deletion` load without authentication.
3. `/login` uses the Clerk production instance, not an `accounts.dev` instance.
4. `/signup` creates a user through the Clerk production instance.
5. `sudo -u kult pm2 status` shows both processes online.
6. `sudo -u kult pm2 logs kult-worker --lines 100` shows no Redis/Turso errors.
7. `https://app.example.com/api/health` returns `status: "ok"` after the worker
   has written its first heartbeat.
8. Meta accepts `https://app.example.com/api/webhook` and the production verify
   token.
9. Meta's OAuth redirect is exactly
   `https://app.example.com/api/instagram/callback`.
10. Sign in and connect one tester Instagram professional account.
11. Open `/dashboard`, `/views`, `/overview`, and `/links`; verify that account,
    video, and link metrics load without server errors.
12. Create a keyword campaign for one test reel.
13. Comment from a different account.
14. Confirm the opening/private DM arrives and the DM log reports success.
15. If using an opening-DM button, press it and confirm the reveal message
    arrives; this validates `messaging_postbacks`.
16. Create an **Every new reel from now on** campaign, publish a test reel, wait
    one polling interval, comment, and confirm it is handled.
17. Connect one Facebook Page and test both an inbound Messenger reply and a
    Page-comment private reply.
18. Only after both platforms pass should you connect the remaining 6–7
    accounts.

## 15. Updating the production server

First back up Turso before schema changes. Then:

```bash
cd /opt/kult
sudo -u kult git pull --ff-only
sudo -u kult npm ci
sudo -u kult npm run db:generate
sudo -u kult npm run db:migrate:turso
sudo -u kult npm run build
sudo -u kult pm2 restart ecosystem.config.cjs --update-env
sudo -u kult pm2 status
```

## 16. Fast troubleshooting

### Web works but DMs never send

```bash
sudo -u kult pm2 status
sudo -u kult pm2 logs kult-worker --lines 200
```

The worker must be online and connected to Upstash.

### Meta cannot verify the webhook

- Confirm HTTPS works publicly.
- Confirm the callback has `/api/webhook` and no trailing slash.
- Confirm Meta's token exactly matches the server's `WEBHOOK_VERIFY_TOKEN`.
- Restart the web process after environment changes:

```bash
sudo -u kult pm2 restart kult-web --update-env
```

### Instagram OAuth fails

- Confirm the numeric Instagram-specific App ID, not the Facebook App ID.
- Confirm the Instagram App Secret, not Client Token.
- Confirm the redirect string matches Meta exactly.
- Confirm the account is Business/Creator and has accepted its tester invite.

### Redis authentication fails

- Copy the complete unmasked Node/ioredis URL.
- Require `rediss://`, not `redis://` or `https://`.
- Do not substitute the REST token after resetting credentials unless Upstash's
  Node/ioredis panel explicitly shows that same value as the Redis password.

### Facebook Messenger event does nothing

- Re-run **Settings → Sync Facebook Pages** after adding permissions.
- Confirm the Page shows **Webhook ready** in Settings.
- Confirm the Meta Page object subscribes `messages`, `messaging_postbacks`, and `feed`.
- Confirm the automation is Live and belongs to the Page receiving the event.
- For post-specific comment flows, use Meta's complete post ID in the form
  `PAGE_ID_POST_ID`; choose **every Page post** when unsure.
- Check the worker logs and the Messenger delivery log.
