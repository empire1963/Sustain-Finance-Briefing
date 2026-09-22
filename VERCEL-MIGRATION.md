# Deploying Sustain on Vercel

This source export preserves the existing project. A Vercel adapter has not been
implemented or deployed. These are the concrete compatibility changes required.

## 1. Keep the frontend and news logic

The authored frontend is in `dist/`, including `app.js`, `auto-refresh.js` and
`source-health.js`. The reusable news logic is in `server/feed.mjs`,
`server/assessment.mjs`, `server/sources.mjs`, `server/deadlines.mjs` and
`server/news.mjs`.

Retain all JavaScript imports when moving the static files into a Vercel output
directory. Keep output separate from the authored `dist/` files so a build does
not erase the source assets.

## 2. Replace the Worker entrypoint with Vercel Functions

`scripts/build.mjs` currently embeds frontend assets into a Cloudflare Worker
at `dist/server/index.js`. `server/worker.mjs` dispatches its routes through
`fetch(request, env, ctx)`. Vercel does not supply this Worker environment.

Create Node.js Vercel Functions for these routes, preserving the browser's API
contract:

| Route | Methods | Required behaviour |
| --- | --- | --- |
| `/api/news` | GET | Return collected articles, source status, deadlines and collector freshness |
| `/api/me` | GET | Return the authenticated reader's preferences and saved stories |
| `/api/preferences` | PUT | Validate and save preferences for that reader |
| `/api/saved` | POST, DELETE | Validate feed-backed saves and scope all writes to that reader |

Vercel supports functions under `api/` using the Node.js runtime. Set the frontend
output directory and build command for the migrated implementation; do not use
the existing Worker build command as if it were a Vercel build.

Official references:
- https://vercel.com/docs/functions/runtimes/node-js
- https://vercel.com/docs/project-configuration/vercel-json

## 3. Replace the D1 storage binding

The current `env.DB` binding is Cloudflare D1. It is used in `server/store.mjs`,
`server/cloud-sync.mjs` and `server/reader.mjs`. It is not an environment variable
containing a database URL, and Vercel cannot create it from `.openai/hosting.json`.

Use durable storage available through HTTP or a supported database connection.
The existing Supabase project is one possible destination. Port the D1 tables in
`db/schema.ts` and `drizzle/*.sql`, and rewrite D1 prepared-statement calls for
that database. SQLite migrations cannot be run unchanged against PostgreSQL.
Do not use `scripts/local-db.mjs` or a function's temporary filesystem for durable
production storage.

If moving to Supabase, enable row-level security, scope saved stories and
preferences to verified user IDs, and keep database admin keys on the server.
The existing Supabase schema in `cloud/schema.sql` stores public news only; it
does not yet contain the reader tables required for this migration.

## 4. Replace ChatGPT Sites authentication

`server/reader.mjs` currently expects a trusted `oai-authenticated-user-id` header
supplied by Sites. Vercel does not supply that identity. Never trust a browser
that sends this header itself.

Integrate a real authentication provider, for example Supabase Auth, and verify
the session in every personal-data API handler. Replace the frontend's
`/signin-with-chatgpt` link and ChatGPT-specific sign-in messages. Preserve the
same-origin write checks, validation and reader isolation in the existing code.

The current site is private. Vercel hosting does not inherit that access policy.
Choose access controls before exposing private data. Existing D1 saved stories
and preferences are not contained in this ZIP; migrating them is a separate data
export/import step and requires mapping the old identities to the new accounts.

Reference: https://supabase.com/docs/guides/auth

## 5. Reuse the cloud collector

The existing Supabase collector can continue independently of Vercel.
Configure the following as Vercel server-side environment values:

```dotenv
SUSTAIN_CLOUD_URL=https://uapantevajhyxerdppnc.supabase.co/functions/v1/sustain-feed/snapshot
SUSTAIN_CLOUD_READ_TOKEN=<existing private reader token>
```

The snapshot endpoint requires `X-Sustain-Reader`. It must be requested by a
server function; never expose its token in browser JavaScript. Reuse
`validateSnapshot()` from `server/cloud-sync.mjs` and preserve stale data on
transient network errors.

`cloud/schedule.sql` contains the updated schedule: it wakes every minute and
dispatches collection when source checks are due or recovery is needed. Normal
publisher collection remains approximately every 15 minutes. A failed gateway
request leaves collection due for a later retry. The schedule uses Supabase
Vault for its private collector token. Vercel Cron is not required for this
existing setup.

For a new Supabase project, replace the project endpoint in `cloud/schedule.sql`,
apply the collector schema and service policies, insert the singleton collector
row (`insert into public.sustain_collector(id) values(true)`), generate new
random reader/collector tokens, store the collector token in Vault, and put
their SHA-256 hashes in `cloud/auth-config.json`. Bundle with
`node scripts/build-collector.mjs`, then deploy the resulting Edge Function as
`sustain-feed` with platform JWT verification disabled only because every
route performs the existing custom token validation. Configure the schedule
and verify both an actual collection and its HTTP response.

## 6. Verify before deploying

After implementing the adapter, test news responses, automatic retries,
sign-in/out, isolation between two readers, saved stories and preferences,
mobile layouts and failed collector requests. The exported 29 tests validate
the current implementation; they do not validate an unimplemented Vercel port.

Then import the migrated project into Vercel, configure its runtime environment
values, deploy, and verify the production endpoints and persistence. This ZIP
does not deploy a site automatically.
