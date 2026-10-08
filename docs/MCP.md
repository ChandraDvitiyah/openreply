# Kult for AI agents

Kult exposes its product features through 47 tools on a remote MCP server at `/api/mcp`.
The server uses the official MCP TypeScript SDK with stateless Streamable HTTP
and JSON responses. It works across Vercel instances without an in-memory
session store or another server process.

## ChatGPT setup (primary)

ChatGPT connects using OAuth. The custom `Authorization` header examples below
are for other MCP clients; users do not create or paste agent keys in ChatGPT.
[OpenAI's authentication contract](https://developers.openai.com/plugins/build/auth)
describes discovery, PKCE and account linking.

An administrator completes the following configuration before rollout:

1. In the **same Clerk instance** used by Kult, create a dedicated OAuth
   application for **Kult in ChatGPT**. Keep consent enabled and require **S256
   PKCE**. Use a predefined confidential client; do not reuse it for another API.
2. Assign Clerk's supported `openid`, `profile`, `email` and `offline_access`
   scopes to the client. `offline_access` enables refresh access. The application
   name should clearly state that it manages the user's Kult workspace.
3. Enable JWT access tokens and Clerk's `aud_claim_enabled` resource-audience
   setting. Require S256 PKCE. Kult introspects every token through Clerk to
   check authenticity and revocation, pins the dedicated client ID, and requires
   the exact issuer and audience `https://YOUR_KULT_HOST/api/mcp`. Tokens with a
   client-ID audience or no audience are rejected. See
   [Clerk's OAuth configuration](https://clerk.com/docs/guides/configure/auth-strategies/oauth/how-clerk-implements-oauth).
4. Set the following on the web server:

   ```dotenv
   MCP_OAUTH_CLIENT_ID=YOUR_DEDICATED_CLIENT_ID
   MCP_OAUTH_ISSUER=https://YOUR_CLERK_ISSUER
   MCP_OAUTH_SCOPE_MODE=clerk
   MCP_OAUTH_WRITE_ENABLED=true
   NEXT_PUBLIC_APP_URL=https://YOUR_KULT_HOST
   ```

   Use the exact issuer from Clerk's `/.well-known/oauth-authorization-server`
   document. In `clerk` mode, `profile` and `email` establish account linking;
   product write access comes from the explicit server setting and the user's
   current workspace role. Writes default off when the setting is absent or
   false. This mode requires resource-bound JWTs and rejects opaque tokens.
   For providers configured with custom `kult:read` and `kult:write` scopes,
   `MCP_OAUTH_SCOPE_MODE=custom` instead enforces those granted token scopes.
   The current Clerk instance rejected custom scopes through its public API.
5. In [ChatGPT Plugins](https://chatgpt.com/plugins) on the web, choose **Add
   custom MCP server**. Name it **Kult**, set the server URL to
   `https://YOUR_KULT_HOST/api/mcp` and choose **OAuth**. Enter the predefined
   client ID and client secret in ChatGPT. Copy the **exact redirect URI shown
   by ChatGPT** into the Clerk application's redirect allowlist. Depending on
   the provider's issuer-identification support, ChatGPT uses
   `https://chatgpt.com/connector_platform_oauth_redirect` or a callback-specific
   URI. Do not guess or use a wildcard.
6. Deploy through the authorized release process in [OPERATIONS.md](OPERATIONS.md).
   Install the resulting ChatGPT plugin, sign in to Kult and grant access. Use
   `@Kult` in a conversation. Workspace policy controls whether users can install
   custom MCP plugins. Source changes do not constitute deployment or publication
   in the public plugin directory.

The public resource discovery document is available at
`/.well-known/oauth-protected-resource/api/mcp` and the root fallback
`/.well-known/oauth-protected-resource`. Initialization, tool listing and static
workflow resources are public so ChatGPT can discover tools before account
linking. Every tool declares OAuth and requires a verified credential to run,
including profile, templates and publishing capabilities. Anonymous tool calls
return an error with `_meta["mcp/www_authenticate"]` pointing to that document
and requesting the configured account-linking and offline scopes. Supplied
invalid credentials still return an HTTP `WWW-Authenticate` challenge and
never fall back to anonymous execution. Clerk owns authorization
codes, PKCE, consent and refresh-token exchange. No OAuth client secret is stored in Kult or exposed to
MCP tools. Missing server configuration fails closed with 503.

OAuth selects the user's earliest workspace, matching the current browser app.
The profile tool exposes the stable Clerk user ID and a workspace label to
identify the connected account. Per-workspace API keys remain available for
clients that need an explicitly chosen workspace. Connecting an account with no
Kult membership requires signing in to Kult and joining a workspace first.

ChatGPT decides when to confirm writes. Its default is to request confirmation;
remembering approval applies within the conversation and can reset on refresh
or a new conversation. Kult preserves truthful read/write/destructive tool
annotations. **Full autonomy across all ChatGPT conversations cannot be promised
by this MCP server.** [OpenAI's custom MCP guide](https://developers.openai.com/api/docs/guides/custom-mcp-server)
explains these controls. Initial OAuth linking and Meta account consent also
require the account owner.

Before declaring rollout complete, verify with a real ChatGPT account:

- Resource discovery returns the canonical resource URL and correct Clerk issuer.
  The issuer metadata advertises `S256`, the assigned scopes and refresh grants.
- New connection completes sign-in and consent; `get_connected_profile` identifies
  the correct account, and `get_workspace` identifies its existing workspace.
- A read tool succeeds and an explicitly approved write executes through the
  product handler. Use a draft campaign or draft post for the write smoke check.
- Token refresh maintains identity. Revoking consent prevents subsequent calls;
  workspace demotion/removal immediately restricts access.
- Publication is verified only after the worker reports the terminal status.

These provider/ChatGPT checks need a deployed endpoint and configured Clerk
application; local mocked protocol tests do not establish a live OAuth rollout.

## Current configured deployment

Configured through Clerk CLI on 9 October 2026:

- Clerk application: `Kult` (`app_3HS5PZN7qkPN05ik7BcmCm2oRfL`), existing
  development instance `ins_3HS5PYwss8Z51ls24X9EGRAivrP` in the personal account.
- Issuer: `https://flowing-blowfish-57.clerk.accounts.dev`.
- Dedicated client: `BRsuoXDVT3zRmxC0` (public identifier).
- Resource: `https://kultreply.vercel.app/api/mcp`.
- Consent and PKCE enabled; JWTs and resource-audience claims enabled.
  Dynamic client registration remains disabled.
- Callback: `https://chatgpt.com/connector_platform_oauth_redirect`, matching
  this issuer's advertised issuer-identification support. Confirm the exact
  callback shown when adding the ChatGPT connection.
- The four `MCP_OAUTH_*` values above are saved locally and in Vercel's
  **Production** environment. The OAuth client secret is stored outside Git
  with restricted permissions, for entry only in ChatGPT's client settings.

The production MCP endpoint is live. Code commit
`4ec6d242fa7b948d4b4758ef1774921b016080c8` is deployed by Vercel deployment
`dpl_2fsvRFAWzVHhE3jPoBdp7anWoZRy` and serves `https://kultreply.vercel.app`.
The Oracle checkout is at the same commit; its worker was restarted after
installing the MCP dependency and regenerating Prisma. No migration was needed.

Validation: 278 tests passed, type checking passed, and lint had zero errors
with three existing warnings. The production build passed on Vercel. Both live
resource discovery URLs return 200, metadata preflight returns 204, missing
credentials return 401 with the OAuth challenge, and foreign Origins return
403. A real SDK client connected with a temporary workspace credential, listed
47 tools, and successfully read identity, accounts, scheduler, dashboard,
templates, publishing capabilities and team membership. The test credential was
revoked and subsequent requests rejected with 401 after Clerk propagated the
revocation. Public application, database, queue and worker health are OK.

The remaining user step is installing and linking Kult in ChatGPT. A real
ChatGPT OAuth code exchange and refresh remain unverified until that step.
Sign in with the existing Kult workspace account when granting consent.

### If ChatGPT reports no tools

Open Kult's plugin details in ChatGPT and choose **Refresh** to retrieve the
current tool catalogue. Start a new conversation with Kult selected. If the
connection was created before the discovery fix, remove it and add it again
with the same MCP URL and OAuth client settings if refreshing does not help.

The discovery fix lets an anonymous real SDK client initialize and list all 47
OAuth-protected tools. Anonymous calls return the tool-level account-linking
challenge without querying account data or performing actions. Authenticated
calls retain current membership, workspace and scope checks. Validation passed
303 tests, typecheck and lint with zero errors and three existing warnings.
These checks verify the server contract; the user's ChatGPT connection remains
the final host-specific check.

## Other MCP clients (API keys)

1. In the existing Clerk instance, enable **User API keys**. This is the
   machine-authentication API keys feature, separate from the application's
   publishable/secret keys. See [Clerk's setup guide](https://clerk.com/docs/guides/development/machine-auth/api-keys).
2. Deploy the web changes through the normal release procedure in
   [OPERATIONS.md](OPERATIONS.md). No database migration is required for MCP. OAuth configuration
   above is needed only for ChatGPT connections. Deploying source is a separate authorized
   operation; this document does not assert a live rollout.
3. Sign in to Kult and open **AI agents** (`/agents`). Create a **Read and write**
   key for unattended operation, or **Read only** for inspection. Keys expire
   after 1–365 days (90 by default).
4. Copy the key into your agent client's secret settings. The application shows
   the secret when created and keeps it only in page memory until hidden or left.
   Key lists never contain secrets.
5. Configure the URL `https://YOUR_KULT_HOST/api/mcp` with the header
   `Authorization: Bearer YOUR_AGENT_KEY`. Use the HTTP/Streamable HTTP transport.

Example client configuration (syntax varies by client):

```json
{
  "mcpServers": {
    "kult": {
      "type": "http",
      "url": "https://YOUR_KULT_HOST/api/mcp",
      "headers": { "Authorization": "Bearer YOUR_AGENT_KEY" }
    }
  }
}
```

For clients that support only stdio, use the bundled adapter from a local clone:

```json
{
  "mcpServers": {
    "kult": {
      "command": "node",
      "args": [
        "--import", "/ABSOLUTE/PATH/openreply/node_modules/tsx/dist/loader.mjs",
        "/ABSOLUTE/PATH/openreply/scripts/mcp-stdio.ts"
      ],
      "env": {
        "KULT_MCP_URL": "https://YOUR_KULT_HOST/api/mcp",
        "KULT_MCP_TOKEN": "YOUR_AGENT_KEY"
      }
    }
  }
}
```

Keep credential values in client secret storage, outside Git. The adapter does
not load `.env.local`, write protocol messages to stdout outside MCP, or follow
redirects with the bearer token. HTTPS is required except on local loopback.

## Feature coverage

| Product surface | Agent operations |
| --- | --- |
| Workspace | Inspect identity, connected ChatGPT profile, role, scopes and workspace |
| Social accounts | List accounts/pages, inspect Instagram profile, prepare Meta consent, disconnect individual connections |
| Instagram campaigns | List/filter, create, edit, pause/resume, delete; all three types; keyword rules, variants, opening DMs, public replies, next/future reels, tracked links and report sharing |
| Templates and imports | Built-in campaign templates and playbooks; bulk import structured CSV rows with duplicate feedback |
| Facebook automations | List with logs, create, pause/resume and delete Messenger/comment-to-message automations |
| Scheduler | Supported content types, drafts, future/immediate publication, cursor pagination, edit/cancel/retry/duplicate, revision control and uncertain-delivery resolution |
| Media | Signed file upload preparation and temporary preview/download URLs |
| Analytics | Dashboard/usage, cross-platform views and insights, performance refresh, full campaign reports with seven-day trends and DM delivery logs |
| Inbox | List conversations, read message history and send replies |
| Link Studio | Read/edit profile and public URL, create/edit/delete/reorder links, enable/disable links and smart app destinations |
| Team | List members/invitations, add/invite, change roles, remove/revoke and accept invitations |
| Profile | Read/update the delegating user's display name |
| Operations | Workspace failure diagnostics and shared worker/queue health |

MCP `tools/list` returns the current schemas and descriptions; `kult://guide`
contains the workflow guide and `kult://tools` contains the credential's catalogue.
The server's initialization instructions also contain the workflow guide.

Example instruction for your agent:

> Inspect my connected Instagram account, find the newest reel, create an active
> LINK campaign with two message variants and a tracked product URL, verify the
> campaign, and report its share URL.

For publishing, call `prepare_media_upload`, upload bytes with **PUT** to the
returned `uploadUrl` using the returned `headers`, then use **mediaUrl** in the
post. Do not send the Kult bearer token to Backblaze. Alternatively use an
existing public HTTPS media URL. Instagram images require JPEG.

Use a stable UUID `clientRequestId` when retrying post creation. Publication is
asynchronous: monitor `list_scheduled_posts` to a terminal status before declaring
success, and follow `nextCursor` when necessary. Editing uses the latest
`revision`. `NEEDS_REVIEW` requires evidence from Meta before either confirmation
action. Do not blindly retry an inbox send or a non-idempotent campaign mutation
after a network timeout.

## Authorization and boundaries

- OAuth access tokens must be issued by the existing Clerk instance for the
  dedicated configured client. Introspection verifies every credential. JWTs
  additionally require the canonical MCP resource audience and configured issuer;
  Clerk compatibility mode always requires a JWT.
- Keys are issued to a Clerk user with server-controlled `purpose=kult-mcp` and
  `workspaceId` claims. Generic Clerk keys and browser cookies alone are rejected.
- In custom-scope mode and on API keys, `kult:read` exposes inspection tools; `kult:write` adds product mutations and
  consent-link generation. Read-only clients cannot call hidden write tools by
  guessing their names. In Clerk mode, the explicit server write setting controls
  which tools are exposed; current membership and roles still apply. The provider
  scopes alone never grant product writes. Media preview remains available to
  read-only keys.
- Every HTTP request verifies its bearer credential with Clerk, rejecting revocation and
  expiration, subject to Clerk propagation of revocation. Every operation
  re-reads membership and current role from Turso.
  Removing a member invalidates their workspace access; demoting a user changes
  their permissions without waiting for a key to expire.
- Calls invoke the existing application handlers within an isolated server-only
  async context. They inherit product validation, workspace resource checks,
  limits and publishing guarantees. User/workspace IDs, URLs, headers and HTTP
  methods cannot be supplied as arbitrary dispatch targets.
- Workspace operations use the bound workspace. Profile and Link Studio are
  personal features belonging to the delegating user. Accepting an invitation
  can add that user to another workspace, but this key stays bound to the original
  workspace. A new key is required to operate in the new workspace.
- Agent credential creation/revocation is browser-authenticated at
  `/api/agent-keys` and is absent from the MCP allowlist. Users manage their own
  keys; an agent cannot mint additional keys. Expiration/revocation controls
  delegate lifetime; workspace roles control what a write key can actually do.
- Requests with a supplied Origin must match `NEXT_PUBLIC_APP_URL`'s origin.
  Native agents normally omit Origin. The endpoint accepts no wildcard CORS.
  MCP bodies are limited to 1 MiB, and tool arguments to 20,000 elements.
- GET and DELETE return 405 because this transport has no persistent SSE session.

Once social accounts, storage and the worker are configured and an agent key is
provisioned, Kult supports unattended routine workflows subject to the client’s
confirmation controls. Connecting a new social
account requires account-owner consent through Meta. Signup/login, provider
account security and credential provisioning remain account-owner actions.
Consent tools return `requiresUserAction: true`; they never claim a connection
completed. Meta permissions, messaging windows and account restrictions still
apply. Cron jobs and webhook ingestion are internal service mechanisms and are
not agent-callable tools.

Clerk API key creation and verification have provider usage limits; see the
[current Clerk feature documentation](https://clerk.com/docs/guides/development/machine-auth/api-keys).
Authentication fails closed during a Clerk outage. A 503 response means provider
availability or configuration needs attention; a 401 means a usable credential
is missing; a 403 means Origin or workspace access is denied.

## Implementation and verification

- `lib/mcp/tools.ts` owns the explicit route/tool allowlist and input schemas.
- `lib/mcp/server.ts` registers tools, resources, instructions and annotations.
- `lib/mcp/auth.ts` verifies credentials and resolves live workspace permissions.
- `lib/mcp/context.ts` isolates delegated identity from browser authentication.
- `app/api/mcp/route.ts` handles the stateless transport and always closes it.
- Campaign validators are shared between MCP schemas and browser API handlers.
- Diagnostics filter workspace events; invitations cannot demote the owner.

`__tests__/mcp.test.ts` uses an actual SDK HTTP client against the route handler.
It covers discovery/resources, advanced campaign creation through the product
handler, cross-workspace access, concurrent isolation, read-only enforcement,
role changes, key and OAuth revocation/expiry, wrong OAuth client, insufficient
scopes, JWT issuer/audience/lifetime, connected-profile metadata, secret-free key lists, foreign Origins,
payload limits and owner protection. Coverage checks require every authenticated
product route to have a mapped tool, excluding provider callbacks and internal
health/webhook/cron/credential routes.

Run `npm run typecheck`, `npm test` and `npm run build` before rollout. The SDK
transport contract is documented in the
[official MCP SDK guide](https://ts.sdk.modelcontextprotocol.io/server).
