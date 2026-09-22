# Sustain — complete source export

Exported 22 September 2026 from the current local project, including the latest
refresh retry and source-health fixes. This is the complete authored source,
not just the website's rendered HTML. All 29 existing tests passed at export.

## Vercel compatibility

This project currently targets ChatGPT Sites / Cloudflare Workers with D1.
It **cannot run unchanged on Vercel**. Read `VERCEL-MIGRATION.md` before importing
it. Uploading only `dist/` would display the interface, but news, accounts,
saved stories and preferences would not work without the backend migration.

## Included

- `dist/`: authored HTML, CSS and browser JavaScript, including automatic refresh.
- `server/`: API, news parsing, scoring, related coverage, storage and account logic.
- `cloud/`: complete Supabase collector, schema, access policies and retry schedule.
- `db/` and `drizzle/`: D1 schema and migration history.
- `scripts/`: build, collector bundling and local database helpers.
- `tests/`: regression tests.
- Package manifest, pinned dependency lockfile, sample environment file and original README.
- `.openai/hosting.json`: original Sites project association; not a Vercel config.

The ZIP includes local changes made after the last published Sites version.
It does not assert that those changes have already been published to the live site.

## Local run

Use Node.js 24 and the pnpm version specified by `package.json`:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm test
pnpm build
pnpm dev
```

Open http://127.0.0.1:4173. Without cloud environment values, the local preview
retrieves publisher feeds directly and stores its local cache in `.sites-runtime`.
Set values from `.env.example` in your environment to use the existing collector.
The preview script injects a local test identity; never deploy that preview server
as production authentication.

## Credentials and data

No plaintext credentials, Git history, installed dependencies, cache databases,
saved personal stories or private preferences are included. Re-enter credentials
through your hosting provider's environment settings. Existing collector token
hashes in `cloud/auth-config.json` are included; hashes cannot recover the tokens.
Do not replace the collector hashes unless you also update its corresponding
Vault and hosting secrets.

The original README describes the Sites architecture. The migration guide explains
what must change for Vercel. No website deployment or live data migration was
performed as part of this source export.
