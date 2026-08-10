<div align="center">

# Kult

OpenReply-powered Instagram and Facebook Messenger automation plus a Clerk-protected, SQLite-backed link-in-bio studio.

> This repository is a product fork of OpenReply. The original Meta automation engine, queue, rate limiting, and diagnostics remain intact; Kult adds Link Studio, smart App Store routing, click tracking, and Clerk authentication.

Start with [the Kult end-to-end setup guide](docs/KULT_SETUP.md).
For production hosting, use the operator-driven [deployment runbook](docs/DEPLOYMENT.md).
For the **current live deployment, a new computer, SSH-key recovery, backups,
updates, and incident response**, use the canonical
[production operations handbook](docs/OPERATIONS.md).

[![License: MIT](https://img.shields.io/badge/License-MIT-black.svg)](LICENSE)
[![Stars](https://img.shields.io/github/stars/Jurredr/openreply?style=flat&color=black)](https://github.com/Jurredr/openreply/stargazers)
[![Built with Next.js](https://img.shields.io/badge/Next.js-16-black.svg)](https://nextjs.org)

</div>

Someone comments `LINK` on your reel, and they get a DM with your link a second later. That is the whole idea. OpenReply watches the comments on your Instagram posts, and when a comment matches a keyword you set, it sends that person a private reply through the official Meta API. You can also post a public reply under the comment at the same time.

ManyChat does this and charges a monthly fee. OpenReply is the same core feature, free, running on your own infrastructure, with no seat limits and no plan caps.

> If this saves you a subscription or a weekend of building, a star on the repo genuinely helps other people find it.

## Why this exists

Comment-to-DM is one feature, but every tool that offers it wants a recurring subscription for it. The actual work is a webhook, a keyword match, and one API call to Meta. That does not need to cost anything to run for a single account.

OpenReply is built around Meta's official Instagram private replies. It does not scrape, it does not automate a browser, and it never asks for an Instagram password. That keeps your account inside Meta's rules, which matters if you care about not getting flagged.

## Features

- Keyword to DM. Match one or many keywords per post, whole-word or partial.
- Optional public reply. Post a visible comment reply on top of the DM.
- Tracked links. Swap a link for a tracked redirect and see clicks and CTR per campaign.
- Personalization. Use `{username}` in your message to greet the commenter by name.
- Per-account rate limiting. Stays under Meta's documented cap of 750 private replies per hour, and queues the overflow instead of dropping it.
- Multiple Instagram accounts. Connect several professional accounts under one workspace, each with its own limits.
- Facebook Page Messenger. Auto-reply to inbound Page messages and send private replies after matching Facebook post comments.
- Performance center. Compare Instagram/Facebook views, reach, engagement and automated DMs, then measure bio-page views and every tracked redirect.
- Workspaces and roles. Owner, admin, and member roles with invite links, useful if you run this for clients.
- Campaign templates. Start from a preset instead of a blank form.
- Inbox. Read your Instagram DM conversations and reply from the dashboard, inside Meta's 24-hour messaging window. Cached so it loads instantly on repeat visits.
- DM logs. Every send, skip, and failure is logged with a reason.
- Self-comment filtering. Your own comments never trigger a reply, since Meta rejects DMing yourself anyway.

## How it works

1. Someone comments on your Instagram post or reel.
2. Meta sends a webhook to your OpenReply instance.
3. OpenReply checks the comment against your active campaigns.
4. On a keyword match, it queues a job.
5. A background worker sends the private reply, and the public reply if you enabled one.

The web app receives the webhook and serves the dashboard. A separate worker process does the sending, because the send has to survive rate limits and retries. Both talk to the same Turso database and Upstash Redis queue.

## Quick start

You need a Meta developer app, Clerk, Turso, Upstash Redis, and an always-on place for the worker. The Instagram account you connect has to be a Business or Creator account, not a personal one.

The honest version: the code deploys in minutes, but the Meta app setup is the part that takes real time. Read [docs/setup.md](docs/setup.md) before you start. It is the single setup guide, covering hosting, your domain, the environment, and every Meta wrong turn so you do not have to find them yourself.

### Run it locally

```bash
git clone https://github.com/Jurredr/openreply.git
cd openreply
npm install
npm run db:generate
npm run db:migrate:turso  # run explicitly after filling .env.local
npm run dev               # web app on http://localhost:3000
npm run worker            # in a second terminal, this sends the DMs
```

Two processes, always. `npm run dev` serves the app and receives webhooks. `npm run worker` is what actually sends the messages. If comments come in and no DM ever arrives, the worker is the first thing to check.

Full environment variables and the production layout are in [docs/setup.md](docs/setup.md).

## Tech stack

- Next.js 16 and React 19 for the web app and API routes
- Prisma 7 with Turso/libSQL for every relational table
- BullMQ on Upstash Redis over TLS for the send queue and the worker
- Clerk authentication
- Tailwind CSS for the interface
- The official Instagram API with Instagram Login

## Contributing

Issues and pull requests are welcome. If you hit a Meta quirk that is not in the setup guide, a PR that documents it is worth as much as a code fix, because that is where everyone loses time.

See [CONTRIBUTING.md](CONTRIBUTING.md) to get started.

## Credits

Built and maintained by Diwen Huang.

- GitHub: [@diwenne](https://github.com/diwenne)
- Website: [diwenhuang.ca](https://diwenhuang.ca)
- X: [@diwenne](https://x.com/diwenne)
- Instagram: [@devdiwen](https://instagram.com/devdiwen)

OpenReply is a fork of [instagram-comment-to-dm](https://github.com/im-anishraj/instagram-comment-to-dm) by [Anish Raj](https://github.com/im-anishraj), also MIT licensed. The billing layer and plan caps were removed, and the setup was documented from scratch.

## Star the repo

If OpenReply is useful to you, star it. It is the simplest way to help the project reach the next person looking for a free way to do this.

## License

MIT. See [LICENSE](LICENSE).
