# Sustain

A mobile-friendly sustainable-finance reader, prepared for **Vercel with Node.js 24 and Supabase**. This export includes the frontend, Vercel API functions, email/password authentication, durable reader storage, and integration with the existing cloud news collector. It has not been deployed to Vercel as part of this export.

Start with [START-HERE.md](./START-HERE.md), then follow [VERCEL-MIGRATION.md](./VERCEL-MIGRATION.md) for deployment.

## Run locally

Use Node.js 24. Copy `.env.example` to `.env`, fill in your existing Supabase project's values, and run `supabase/reader-setup.sql` in that project's SQL Editor.

```sh
npm ci
npm run build
npm test
npm run dev
```

Open [http://127.0.0.1:4174](http://127.0.0.1:4174). This uses real Supabase sign-in and storage. Rebuild after editing frontend assets. The npm lockfile is the dependency source for this deployment.

## What is included

- Global sustainable-finance news from 17 selected public feeds, including official institutions and regulators.
- Short publisher excerpts, source links, explained priority scores, funding/policy stages, and related coverage.
- Topic and region preferences, a daily briefing generated on opening the site, and up to 500 saved stories per account.
- Curated policy milestones and calendar downloads.
- Cloud collection approximately every 15 minutes, with automatic retries through the existing Supabase schedule.

Public feeds provide selected coverage, not every sustainable-finance story. Excerpts are capped at 45 words / 330 characters; this application does not fetch paywalled articles or generate full-article AI summaries. Priority is a rule-based reading aid whose reasons are shown. The six calendar milestones were verified on 17 September 2026 and need editorial updates when policies change. Email and push news delivery are not configured.

## Runtime and storage

`dist/` contains authored frontend files. `npm run build` writes static output to `public/`. `api/*.js` supplies `/api/config`, `/api/news`, `/api/me`, `/api/preferences`, and `/api/saved`; `runtime/` implements their Vercel behavior. `vercel.json` configures the build, output, functions, and security headers.

The Vercel backend verifies Supabase Auth access tokens on every protected request. Access defaults to verified accounts listed in the server-only `SUSTAIN_ALLOWED_EMAILS`. Reader data is stored in `sustain_reader_preferences` and `sustain_saved_stories`; [reader setup](./supabase/README.md) documents their access model and atomic save limit.

The existing Supabase collector remains responsible for fetching publisher feeds. It keeps public news in `sustain_sources` and run status in `sustain_collector`, capped at 100 articles per source and 90 days. Vercel can read these durable tables directly. Optional snapshot endpoint settings use the existing Edge Function first and fall back to the tables if that endpoint fails. A warm Vercel function also retains its last loaded snapshot during temporary errors; a cold function still needs Supabase to load news.

Shared parsing, scoring, deadlines and grouping live in `server/`. The original Sites Worker, D1 helpers, `db/`, `drizzle/`, and `.openai/hosting.json` remain as legacy source; the Vercel runtime does not use the Sites identity or D1 binding. Legacy Sites build helpers are preserved for reference and are not part of the Vercel package scripts.

## Source, credentials and data

No plaintext credentials, installed dependencies, Git history, private reading lists or preferences are part of this export. Configure secrets in Vercel's environment settings and keep `.env` local. `cloud/auth-config.json` contains the existing collector's token hashes, which cannot recover its tokens; preserve them when reusing that collector.

Existing saved stories in Sites D1 are not included and will not automatically appear under new Supabase accounts. Migrating those records needs a separate data export and a verified mapping from the old identities to the new accounts.

Run `npm test` for the regression suite. SQL verification and its limits are recorded in [supabase/README.md](./supabase/README.md). Production sign-in, redirects, allowed-account access and persistence must also be checked after your deployment.
