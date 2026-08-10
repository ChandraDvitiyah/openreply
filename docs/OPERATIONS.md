# Kult production operations and recovery handbook

This is the canonical handoff document for the deployed Kult project. It is
written so that a future maintainer or coding agent can recover from a new
computer, a lost SSH key, or a deleted worker VM with the Git repository and
access to the service accounts. It intentionally contains no secret values.

Last verified: **10 August 2026**.

## 1. Read this first

The live system is already deployed. Do not follow the older VPS-only path in
`DEPLOYMENT.md` unless deliberately replacing the current architecture.

The current production split is:

```text
Browser / Meta webhooks
        |
        v
Vercel: Next.js web app and API routes
        |                     |
        v                     v
Turso: all relational data   Upstash Redis: BullMQ queue + worker heartbeat
                                      ^
                                      |
                         Oracle VM: continuous BullMQ worker
```

Important consequences:

- Vercel is the public application. Meta and Clerk callbacks must point to the
  Vercel URL, never the Oracle IP.
- Oracle runs only `npm run worker`. Ports 80 and 443 are not needed there.
- Turso is SQLite/libSQL and is the only relational database. There is no
  PostgreSQL service in this deployment.
- Upstash is not application storage. It carries pending jobs, retry/rate-limit
  state, and the worker heartbeat.
- The Oracle VM is replaceable. Durable user, campaign, analytics, account, and
  link data lives in Turso. The source of truth for code is GitHub.
- A repository clone alone does not contain credentials. Recovery also requires
  access to Vercel and the service dashboards, or a secure password-manager
  backup of the credentials.

## 2. Current production inventory

| Component | Current resource | Notes |
| --- | --- | --- |
| Live app | `https://kultreply.vercel.app` | Public URL; no purchased domain |
| Health | `https://kultreply.vercel.app/api/health` | Must return HTTP 200 and `status: "ok"` |
| GitHub fork | `ChandraDvitiyah/openreply` | `origin`; production branch is `main` |
| Upstream | `Jurredr/openreply` | `upstream`; do not push Kult changes here |
| Vercel project | `kultreply` | Git-connected to the fork |
| Oracle region | `ap-mumbai-1` | Mumbai home region |
| Oracle instance | `kult-worker` | Ubuntu 24.04 x86, `VM.Standard.E2.1.Micro` |
| Oracle capacity | 1 OCPU, 1 GB RAM | 2 GB swap was added at `/swapfile` |
| Worker runtime at install | Node `22.23.2`, npm `10.9.8`, PM2 `7.0.3` | Re-check after upgrades |
| Oracle VCN/subnet | `kult-vcn` / `kult-public-subnet` | Subnet CIDR `10.0.0.0/24` |
| Current Oracle public IP | `92.4.85.60` | Ephemeral; re-check OCI after stop/start |
| Oracle login | `ubuntu` | App directory `/home/ubuntu/openreply` |
| PM2 process | `kult-worker` | systemd service `pm2-ubuntu` restores it on boot |
| Turso database | `kult-samudra` | URL host is visible in Turso; region is AWS Mumbai |
| Upstash Redis | `quiet-sheepdog-103818` | Kult uses the TLS `rediss://` endpoint, not REST |
| Clerk | Existing Development instance | Personal-use deployment; `/login` and `/signup` |
| Meta Graph version | `v25.0` | Also represented by `META_GRAPH_API_VERSION` |
| Meta/Facebook App ID | `1040409875479157` | Public identifier, not the app secret |
| Instagram App ID | `1353786876894303` | Instagram-login identifier, not the app secret |

The current Mac's SSH key is outside the repository:

```text
Private key: /Users/nishant/.ssh/kult_oracle
Public key:  /Users/nishant/.ssh/kult_oracle.pub
Fingerprint: SHA256:qXWzinoTY2tsHKMoogJSGYDaPRCWeHeG8WhnLkPcfbY
```

Never copy the private key into this repository. The path above is only an
inventory record and will not exist on a new device.

### Public routes and callbacks

| Purpose | URL |
| --- | --- |
| Landing page | `https://kultreply.vercel.app/` |
| Sign in | `https://kultreply.vercel.app/login` |
| Sign up | `https://kultreply.vercel.app/signup` |
| Privacy policy | `https://kultreply.vercel.app/privacy` |
| Terms | `https://kultreply.vercel.app/terms` |
| Data deletion | `https://kultreply.vercel.app/data-deletion` |
| Meta webhook | `https://kultreply.vercel.app/api/webhook` |
| Instagram OAuth callback | `https://kultreply.vercel.app/api/instagram/callback` |
| Facebook OAuth callback | `https://kultreply.vercel.app/api/facebook/callback` |
| Public bio page | `https://kultreply.vercel.app/u/{slug}` |
| Tracked redirect | `https://kultreply.vercel.app/go/{id}` |

Vercel schedules the checked-in daily crons in `vercel.json`. The continuous
worker separately reconciles comments every five minutes by default, writes a
heartbeat every 30 seconds, and refreshes 30-day performance data every 12
hours.

## 3. Where secrets live

Git contains only `.env.example`. Production values are stored in:

1. **Vercel → `kultreply` → Settings → Environment Variables** for the web app.
2. **Oracle → `/home/ubuntu/openreply/.env.local`** for the worker, mode `600`.
3. The originating service dashboards: Clerk, Turso, Upstash, and Meta.

The Vercel and Oracle copies of shared variables must match. Do not assume a
developer's local `.env.local` is current; on the original Mac it may still
contain an old ngrok URL.

### Required variable checklist

| Variable | Source | Used by | Special rule |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_APP_URL` | Deployment URL | Web + worker | Production is `https://kultreply.vercel.app` |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk API keys | Web | Browser-safe publishable key |
| `CLERK_SECRET_KEY` | Clerk API keys | Web | Never expose client-side |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | App setting | Web | `/login` |
| `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | App setting | Web | `/signup` |
| `NEXT_PUBLIC_SUPPORT_EMAIL` | Owner | Web | Monitored contact address |
| `TURSO_DATABASE_URL` | Turso database | Web + worker | Must start `libsql://` |
| `TURSO_AUTH_TOKEN` | Turso token | Web + worker | Read-write token |
| `LOCAL_DATABASE_URL` | App setting | Build/migrations | `file:./data/kult-prisma.db` |
| `UPSTASH_REDIS_URL` | Upstash Connect panel | Web + worker | Full TLS URL starting `rediss://` |
| `FACEBOOK_APP_ID` | Meta App Settings | Web + worker | Public numeric ID |
| `FACEBOOK_APP_SECRET` | Meta App Settings | Web + worker | Secret |
| `META_CLIENT_TOKEN` | Meta App Settings | Reference | Not a substitute for an app secret |
| `META_GRAPH_API_VERSION` | App setting | Web + worker | Currently `v25.0` |
| `INSTAGRAM_APP_ID` | Instagram API setup | Web + worker | Instagram-specific numeric ID |
| `INSTAGRAM_APP_SECRET` | Instagram API setup | Web + worker | Secret |
| `WEBHOOK_VERIFY_TOKEN` | Owner-generated | Web + Meta | Exact same value in both places |
| `ENCRYPTION_KEY` | Owner-generated | Web + worker | Exactly 64 hex characters; data-critical |
| `CRON_SECRET` | Owner-generated | Vercel cron routes | Long random value |
| `PERFORMANCE_SYNC_INTERVAL_MS` | Optional app setting | Worker | Default `43200000` (12 hours) |
| `COMMENT_POLL_INTERVAL_MS` | Optional app setting | Worker | Default `300000` (5 minutes) |

`UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are not used by this
code. BullMQ uses an ordinary TLS Redis connection.

### The encryption-key invariant

`ENCRYPTION_KEY` encrypts stored Meta access tokens. Never generate a new value
as part of an ordinary device move, VM rebuild, or redeploy. Recover the current
value from Vercel or the old worker and reuse it.

If the value is permanently lost, existing encrypted Instagram and Facebook
tokens cannot be read. Set a new key in both hosts, redeploy/restart, and
reconnect every social account. If rotating a known key, first implement and
test an explicit token re-encryption migration or deliberately reconnect every
account.

### Account continuity checklist

The owner should keep these outside Git in a password manager:

- GitHub, Vercel, Oracle, Turso, Upstash, Clerk, and Meta login identifiers.
- MFA recovery codes for every service.
- A secure export or record of all production environment values.
- The Oracle SSH private key, or a second independently stored administrator
  key.
- The Clerk owner account's MFA backup codes and the Meta account's recovery
  methods.

The repository must never contain that recovery bundle.

## 4. New computer bootstrap

This procedure assumes the old computer is gone but the cloud accounts remain.

### 4.1 Install tools and clone

Install Git and Node.js 22 or newer, then:

```bash
git clone https://github.com/ChandraDvitiyah/openreply.git
cd openreply
git remote add upstream https://github.com/Jurredr/openreply.git
git remote -v
npm ci
npm run db:generate
```

Expected remotes:

```text
origin    https://github.com/ChandraDvitiyah/openreply.git
upstream  https://github.com/Jurredr/openreply.git
```

### 4.2 Recover local development variables

Preferred route when the Vercel account is available:

```bash
npx vercel login
npx vercel link
npx vercel env pull .env.local --environment=development
chmod 600 .env.local
```

Select the existing `kultreply` project during `vercel link`. If the Development
environment is incomplete, create `.env.local` from `.env.example` and retrieve
each value from the service dashboards. Do not copy placeholder values.

For local-only browsing, set:

```dotenv
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

OAuth and webhook testing from a local machine still needs a public HTTPS tunnel
and matching temporary URLs in Meta. Never replace the production Meta callback
just to do ordinary UI development.

### 4.3 Validate before editing

```bash
npm run typecheck
npm test
npm run build
```

Run locally in two terminals:

```bash
npm run dev
```

```bash
npm run worker
```

Only run a local worker against production Turso/Redis when deliberately testing
queue behavior. Multiple BullMQ workers can consume real jobs. For UI work,
leave the local worker stopped.

### 4.4 Recover Oracle access on a new device when the old key is available

Restore the private key from the password manager to a local path, then:

```bash
chmod 600 ~/.ssh/kult_oracle
ssh-keygen -lf ~/.ssh/kult_oracle
ssh -o IdentitiesOnly=yes -i ~/.ssh/kult_oracle ubuntu@92.4.85.60
```

The displayed fingerprint should match the inventory above. If OCI shows a
different public IP, use the current **Instance access → Public access IP
address** value instead.

Optional `~/.ssh/config` entry:

```sshconfig
Host kult-worker
  HostName 92.4.85.60
  User ubuntu
  IdentityFile ~/.ssh/kult_oracle
  IdentitiesOnly yes
```

Then `ssh kult-worker` is sufficient. Update `HostName` whenever the ephemeral
IP changes.

## 5. Normal production operations

### 5.1 Read-only health check

```bash
curl -fsS https://kultreply.vercel.app/api/health
```

A healthy response has:

- top-level `status: "ok"`;
- database `status: "ok"`;
- Redis detail `PONG`;
- queue `status: "ok"`; and
- worker `healthy: true` with a recent heartbeat from hostname `kult-worker`.

Queue counts need not be zero while real work is in progress. A growing
`failed` count needs investigation.

### 5.2 Inspect the worker

```bash
ssh -o IdentitiesOnly=yes -i ~/.ssh/kult_oracle ubuntu@92.4.85.60
cd /home/ubuntu/openreply
pm2 status
pm2 logs kult-worker --lines 200
systemctl status pm2-ubuntu --no-pager
free -h
df -h
```

Expected PM2 state is `online`. Normal startup logs include:

```text
[DM Worker] Started
```

### 5.3 Deploy code safely

1. Work on a branch and run `npm run typecheck`, `npm test`, and
   `npm run build` locally.
2. Merge or push the intended commit to `main`. Vercel automatically deploys
   the public web application from GitHub.
3. Wait for Vercel to report a successful production deployment.
4. Update the Oracle worker, because shared code under `lib/` can affect it even
   when the UI was the visible change.

On Oracle:

```bash
cd /home/ubuntu/openreply
git status --short
git pull --ff-only
npm ci
npm run db:generate
npm run db:migrate:turso
pm2 restart kult-worker --update-env
pm2 save
pm2 status
pm2 logs kult-worker --lines 100 --nostream
```

Do not pull over uncommitted server edits. Investigate them first. Production
should be reproducible from Git plus `.env.local`.

After deployment:

```bash
curl -fsS https://kultreply.vercel.app/api/health
```

Also test `/login`, `/dashboard`, and one harmless link redirect. For changes to
Meta processing, use a tester account to exercise a real comment/message.

### 5.4 Database migrations

Turso migrations are ordered SQL directories under `prisma/turso-migrations/`.
The runner records applied names in `_kult_migrations` and safely prints `skip`
for migrations already applied.

Before any schema change, create a dump:

```bash
mkdir -p ~/kult-backups
turso db shell kult-samudra .dump > ~/kult-backups/kult-samudra-YYYY-MM-DD.sql
chmod 600 ~/kult-backups/kult-samudra-YYYY-MM-DD.sql
```

Store the dump encrypted outside the repository. It contains user and social
account data. Then run:

```bash
npm run db:migrate:turso
```

Do not run `prisma migrate deploy` against Turso. This fork uses the checked-in
libSQL migration runner.

Turso point-in-time recovery creates a new database. After a restore, create a
new token and update both Vercel and Oracle with the new URL/token before
redeploying/restarting.

### 5.5 Change an environment variable

Every shared runtime value must be changed in both locations:

1. Vercel project → **Settings → Environment Variables**.
2. Oracle `/home/ubuntu/openreply/.env.local`.

Vercel environment changes affect only new deployments, so redeploy after the
edit. On Oracle:

```bash
chmod 600 /home/ubuntu/openreply/.env.local
cd /home/ubuntu/openreply
pm2 restart kult-worker --update-env
pm2 save
```

Never paste secret values into shell history, GitHub issues, commit messages,
logs, screenshots, or agent chat. Use dashboard secret fields, a protected
editor, or a mode-600 temporary file.

### 5.6 Routine maintenance

Weekly:

- Open `/api/health` and confirm a fresh worker heartbeat.
- Review Vercel Function logs and `pm2 logs kult-worker` for repeated errors.
- Review Upstash command usage and failed BullMQ jobs.
- Confirm Oracle boot-volume, memory, and swap usage.
- Check Meta webhook delivery errors and expired/revoked account connections.

Before a release or monthly:

- Create and securely store a Turso dump.
- Confirm service-account MFA and recovery methods still work.
- Run `npm audit` and review findings; do not use a breaking automatic fix
  without testing.
- Apply Ubuntu security updates during a maintenance window and reboot if
  required, then confirm PM2 and `/api/health` recover.

## 6. SSH key management

### 6.1 Add a new key while current SSH access works

Generate a dedicated key on the new computer:

```bash
ssh-keygen -t ed25519 -a 100 -f ~/.ssh/kult_oracle -C "kult-oracle-YYYY-MM-DD"
chmod 600 ~/.ssh/kult_oracle
chmod 644 ~/.ssh/kult_oracle.pub
ssh-keygen -lf ~/.ssh/kult_oracle.pub
```

From a computer that still has working access, copy the new `.pub` file to the
VM and append it. A public key is safe to transfer; the private key is not.

```bash
scp -i ~/.ssh/OLD_WORKING_KEY ~/.ssh/kult_oracle.pub ubuntu@CURRENT_ORACLE_IP:/tmp/kult_oracle_new.pub
ssh -i ~/.ssh/OLD_WORKING_KEY ubuntu@CURRENT_ORACLE_IP
sudo install -d -m 700 -o ubuntu -g ubuntu /home/ubuntu/.ssh
sudo touch /home/ubuntu/.ssh/authorized_keys
sudo sh -c 'grep -qxF "$(cat /tmp/kult_oracle_new.pub)" /home/ubuntu/.ssh/authorized_keys || cat /tmp/kult_oracle_new.pub >> /home/ubuntu/.ssh/authorized_keys'
sudo chown ubuntu:ubuntu /home/ubuntu/.ssh/authorized_keys
sudo chmod 600 /home/ubuntu/.ssh/authorized_keys
rm /tmp/kult_oracle_new.pub
```

Open a second terminal and verify the new key before closing the old session:

```bash
ssh -o IdentitiesOnly=yes -i ~/.ssh/kult_oracle ubuntu@CURRENT_ORACLE_IP
```

### 6.2 Revoke an old or compromised key

Keep the verified new-key session open. On the VM:

```bash
cp /home/ubuntu/.ssh/authorized_keys /home/ubuntu/.ssh/authorized_keys.backup
nano /home/ubuntu/.ssh/authorized_keys
chmod 600 /home/ubuntu/.ssh/authorized_keys
```

Delete only the line belonging to the old key. Test another new-key login before
removing the backup. If anything fails, restore from the still-open session:

```bash
cp /home/ubuntu/.ssh/authorized_keys.backup /home/ubuntu/.ssh/authorized_keys
chmod 600 /home/ubuntu/.ssh/authorized_keys
```

Do not delete the old private key until the new login and PM2 checks succeed.

### 6.3 Lost private key: break-glass recovery

First confirm this is actually a key problem:

1. In OCI, open **Compute → Instances → `kult-worker`**.
2. Confirm the instance is `Running` and copy its current public IP.
3. Confirm TCP 22 is allowed by the subnet security list/network security group.
4. Retry with `-o IdentitiesOnly=yes` and the exact private-key path.

If no valid private key remains, a private key cannot be downloaded again from
OCI. Choose one of these recovery paths.

#### Path A: OCI Run Command was prepared

OCI's Run Command can run without SSH, but it depends on the Oracle Cloud Agent,
the Compute Instance Run Command plugin, IAM permission, and sufficient local
permission for its `ocarun` user. **This capability is not currently verified
for `kult-worker`; do not assume it will work during an incident.**

If an administrator previously enabled and tested it:

1. Generate a new key locally as in section 6.1.
2. OCI → instance → **Management → Run command → Create command**.
3. Paste a script that installs the new public key. Replace the placeholder with
   the single complete line from `~/.ssh/kult_oracle.pub`:

```bash
#!/bin/bash
set -euo pipefail
NEW_KEY='ssh-ed25519 REPLACE_WITH_COMPLETE_PUBLIC_KEY kult-oracle-recovery'
sudo install -d -m 700 -o ubuntu -g ubuntu /home/ubuntu/.ssh
sudo touch /home/ubuntu/.ssh/authorized_keys
sudo grep -qxF "$NEW_KEY" /home/ubuntu/.ssh/authorized_keys || printf '%s\n' "$NEW_KEY" | sudo tee -a /home/ubuntu/.ssh/authorized_keys >/dev/null
sudo chown ubuntu:ubuntu /home/ubuntu/.ssh/authorized_keys
sudo chmod 600 /home/ubuntu/.ssh/authorized_keys
```

4. Wait for exit code `0`, then test SSH with the new key.
5. Once logged in, inspect `authorized_keys`, revoke compromised keys, and check
   `pm2 status`.

Do not place passwords, access tokens, `.env.local`, or private keys in a Run
Command script or its output.

#### Path B: rebuild the disposable worker VM

This is the reliable recovery path for Kult because Oracle stores no durable
application database. Stop or terminate the inaccessible old instance first so
that two reconciliation loops do not run simultaneously, then follow section 7.

Oracle's own Linux connection guidance says that a lost-key instance may need
to be terminated and recreated. Serial-console recovery is an advanced option
and Ubuntu key-only images often have no usable password login; do not make it
the primary plan.

## 7. Rebuild the Oracle worker from zero

Use this after instance loss, unrecoverable SSH access, or an operating-system
failure.

### 7.1 Create the replacement

In OCI, region `ap-mumbai-1`:

1. Create an Ubuntu 24.04 instance named `kult-worker`.
2. Prefer Always Free `VM.Standard.E2.1.Micro` if A1 capacity is unavailable.
3. Use the existing `kult-vcn` and `kult-public-subnet` where possible.
4. Assign a public IPv4 address.
5. Paste a newly generated SSH **public** key.
6. Allow inbound TCP 22, preferably only from the maintainer's current IP.
7. No inbound 80/443 rule is required for the worker-only VM.

Record the new public IP in this document after the replacement is stable.

### 7.2 Bootstrap Ubuntu

SSH as `ubuntu`, then:

```bash
sudo apt update
sudo apt install -y curl git ca-certificates build-essential
curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/nodesource_setup.sh
sudo -E bash /tmp/nodesource_setup.sh
sudo apt install -y nodejs
sudo npm install -g pm2
node --version
npm --version
```

Add 2 GB swap on the 1 GB shape:

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
free -h
```

Clone and install:

```bash
git clone https://github.com/ChandraDvitiyah/openreply.git /home/ubuntu/openreply
cd /home/ubuntu/openreply
npm ci
npm run db:generate
```

### 7.3 Restore production environment safely

Reconstruct `.env.local` from Vercel production variables or the service
dashboards. Ensure `NEXT_PUBLIC_APP_URL=https://kultreply.vercel.app` and retain
the existing `ENCRYPTION_KEY`.

If using a temporary local file, make it mode `600`, transfer it with `scp`, and
delete the local temporary copy after verifying the worker. Do not commit it.

One Vercel-backed recovery workflow from the local repository is:

```bash
npx vercel login
npx vercel link
npx vercel env pull .env.worker.production --environment=production
chmod 600 .env.worker.production
scp -i ~/.ssh/kult_oracle .env.worker.production ubuntu@CURRENT_ORACLE_IP:/home/ubuntu/openreply/.env.local
```

Confirm that the downloaded file contains the required checklist from section 3
and that its production app URL is correct before transferring it. Securely
delete the temporary local copy after the replacement worker passes health.

On the VM:

```bash
chmod 600 /home/ubuntu/openreply/.env.local
cd /home/ubuntu/openreply
npm run db:migrate:turso
```

Migration output should show existing migrations as `skip` on an intact Turso
database.

### 7.4 Start and persist the worker

```bash
cd /home/ubuntu/openreply
pm2 start npm --name kult-worker -- run worker
pm2 save
pm2 startup systemd -u ubuntu --hp /home/ubuntu
```

Run the exact elevated command printed by `pm2 startup`, then:

```bash
pm2 save
pm2 status
pm2 logs kult-worker --lines 100 --nostream
```

Wait at least 30 seconds and verify:

```bash
curl -fsS https://kultreply.vercel.app/api/health
```

The returned worker hostname should be `kult-worker` and its heartbeat should be
fresh.

### 7.5 Optional: prepare Run Command before an emergency

While SSH still works, verify Oracle Cloud Agent:

```bash
snap list oracle-cloud-agent
snap services oracle-cloud-agent
```

In OCI, enable **Management → Oracle Cloud Agent → Compute Instance Run
Command** and follow Oracle's current IAM and administrator-permission guide.
Test only a harmless command such as `id` first. Granting the plugin passwordless
administrator rights is a break-glass tradeoff: anyone with OCI Run Command
permission can become root, so require MFA and least-privilege OCI IAM.

## 8. Disaster-recovery scenarios

### Vercel project is deleted

1. Import `ChandraDvitiyah/openreply` into a new Vercel project.
2. Add every variable in section 3 and use `npm run vercel-build`/the detected
   Next.js settings.
3. Deploy and verify `/api/health` (the worker can still run while the web is
   temporarily unavailable).
4. If the public hostname changes, update `NEXT_PUBLIC_APP_URL` in both hosts,
   all Meta app domains/callbacks/webhooks, and Clerk allowed URLs.
5. Redeploy Vercel and restart the worker with `--update-env`.

### Oracle instance is stopped or its IP changes

Start the instance in OCI, read the new public IP, update local SSH config and
this inventory, then check PM2. No Meta/Clerk URL changes are needed because the
worker has no public callback.

### Oracle instance is deleted

Follow section 7. Turso retains application data and Upstash retains available
queue state. Stop the old instance before enabling the replacement if it still
exists.

### Turso data is damaged

Stop the worker first to halt reconciliation writes. Use Turso point-in-time
recovery or create a new database from the latest encrypted dump. Update the
Turso URL and token in Vercel and Oracle, redeploy/restart, and verify health
before reconnecting traffic. Never delete the damaged database until the
restored one is validated.

### Turso database and all backups are lost

Create a new database, run `npm run db:migrate:turso`, and reconnect Clerk users
and every Meta account. Campaigns, logs, analytics snapshots, bio links, and
stored OAuth tokens cannot be reconstructed from Git.

### Upstash Redis is lost or credentials are reset

Create or recover the Redis database, copy its complete `rediss://` connection
URL into Vercel and Oracle, redeploy/restart, and verify `PONG`. Pending queue
jobs and rate-limit state may be lost; comment reconciliation can recover many
eligible missed comments but should not be treated as a complete queue backup.

### Clerk instance or owner access is lost

Recover the Clerk account through its MFA/recovery flow. If the Clerk instance
must be replaced, update both Clerk keys in Vercel, redeploy, and expect Clerk
user IDs to change. Existing workspace ownership rows keyed to old Clerk IDs may
need a controlled database migration; do not edit them blindly.

### Meta app is replaced

Update Facebook and Instagram IDs/secrets in both hosts, configure all URLs in
section 2, subscribe the required webhook fields, and reconnect every account.
Stored tokens issued to the old Meta app will not become tokens for the new app.

### A secret is exposed

Rotate only the exposed credential, update every consumer, then verify health:

- Clerk secret: Vercel (and keep the worker environment consistent), redeploy.
- Turso token: Vercel + Oracle, redeploy/restart.
- Upstash password: Vercel + Oracle, redeploy/restart; inspect queued jobs.
- Meta app secrets: Vercel + Oracle, redeploy/restart; retest OAuth/webhooks.
- Webhook verify token: Vercel + Meta webhook configuration, then redeploy.
- Cron secret: Vercel, then redeploy.
- Encryption key: follow the special invariant in section 3; never casually
  rotate it.
- SSH private key: add and verify a new key, revoke the old public-key line, and
  inspect authentication logs.

## 9. Troubleshooting map

| Symptom | First checks | Likely owner |
| --- | --- | --- |
| Site does not load | Vercel deployment and Function logs | Vercel/web app |
| Health database error | Turso status, URL, token, migration state | Turso |
| Health Redis/queue error | Upstash status and complete `rediss://` URL | Upstash |
| Worker unhealthy/stale | OCI state, PM2, swap/memory, worker logs | Oracle/PM2 |
| Webhook verification fails | exact URL/token, current Vercel deployment | Meta + Vercel |
| OAuth redirect error | exact registered callback and correct app ID | Meta |
| Comment logged but no DM | worker logs, failed queue count, Meta token | Worker/Meta |
| No comment event | Meta webhook subscriptions and account role | Meta |
| Dashboard metrics empty | account insight permissions and sync logs | Meta sync |
| Login/signup fails | Clerk instance, keys, allowed URLs | Clerk |
| Public bio works but clicks absent | `/go/{id}`, Turso writes, link status | Web/Turso |
| `npm run worker` missing | terminal is in parent `kult`, not `openreply` | Local path |

Useful commands:

```bash
git status --short
git log -5 --oneline --decorate
npm run typecheck
npm test
npm run build
npm run check:webhook
```

Never run destructive Git, database, Redis, or OCI commands as a diagnostic.
Resolve the exact target and take a backup first.

## 10. Meta and Clerk production settings

Meta must retain:

- App domain `kultreply.vercel.app`.
- Legal URLs from section 2.
- Instagram callback `/api/instagram/callback`.
- Facebook callback `/api/facebook/callback`.
- Webhook `/api/webhook` with the exact current verify token.
- Instagram fields `comments`, `messages`, `messaging_postbacks`.
- Facebook Page fields `messages`, `messaging_postbacks`, `feed`.

While Meta remains in Development mode, every Instagram/Facebook owner involved
in testing must be an accepted app role/tester. Development mode does not make
the app generally available to unrelated accounts.

Clerk currently uses its Development instance by the owner's choice. Keep
sign-up available at `/signup`, restrict who may join if this stays personal,
and require MFA on the owner account. A future public or commercial launch
should create a Clerk Production instance and re-evaluate Meta App Review,
privacy, data deletion, hosting-plan terms, and domain ownership.

## 11. Future-agent start and finish protocol

Before making a change, a future agent must:

1. Read `AGENTS.md` and this file completely.
2. Confirm the requested scope and whether deployment is authorized.
3. Run `git status --short`, inspect the branch/remotes, and preserve unrelated
   user changes.
4. Check the live health endpoint without exposing environment values.
5. Read the relevant current Next.js 16 documentation under
   `node_modules/next/dist/docs/` before framework changes.
6. Identify whether the change affects Vercel, the Oracle worker, migrations,
   Meta configuration, or more than one of them.
7. Back up Turso before schema/data-risking work.

After an authorized production change, the agent must:

1. Record the deployed Git commit.
2. Verify Vercel deployment success.
3. Update/restart the Oracle worker when shared or worker code changed.
4. Verify `/api/health` and the affected user flow.
5. Update this inventory if URLs, IPs, resource names, versions, or recovery
   steps changed.
6. Report exactly what changed, what was verified, and any remaining manual
   Meta/Clerk action.

## 12. Official references

- [Vercel environment-variable CLI](https://vercel.com/docs/cli/env)
- [Vercel environment scopes](https://vercel.com/docs/environment-variables)
- [OCI: connect to a Linux instance](https://docs.oracle.com/en-us/iaas/Content/Compute/Tasks/connect-to-linux-instance.htm)
- [OCI: Run Command](https://docs.oracle.com/en-us/iaas/Content/Compute/Tasks/runningcommands.htm)
- [OCI: manage Cloud Agent plugins](https://docs.oracle.com/en-us/iaas/Content/Compute/Tasks/manage-plugins.htm)
- [Turso database dump and restore](https://docs.turso.tech/cli/db/shell)
- [Turso point-in-time recovery](https://docs.turso.tech/features/point-in-time-recovery)
- [Upstash Redis CLI and backups](https://upstash.com/docs/agent-resources/cli)
- [Clerk MFA strategies](https://clerk.com/docs/guides/configure/auth-strategies/sign-up-sign-in-options)

The official service documentation wins if a dashboard label or procedure has
changed. Update this handbook after confirming the new workflow.
