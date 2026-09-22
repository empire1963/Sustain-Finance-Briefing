# Sustain

A private, mobile-friendly sustainable-finance reader on Sites with a Cloudflare Worker and D1 storage.

## News and coverage

Seventeen public RSS feeds are configured in server/sources.mjs. Six new official feeds cover the European Investment Bank, European Commission Finance, FCA, ECB, BIS and SEC. ADB uses its official FeedBurner distribution because its native endpoint rejects the collector cloud region. Endpoints were verified on 17 September 2026. Broad official feeds are filtered for sustainable finance and may return zero relevant items. Availability does not imply complete geographic or publisher coverage.

Cloud collection is enabled through Supabase Cron and the sustain-feed Edge Function in project uapantevajhyxerdppnc (London). The collector runs every 15 minutes with no user device required. Two separate 256-bit tokens control collection and snapshot reads. Only their SHA-256 hashes are in source; the collector token is in Supabase Vault and the reader token in Sites secret environment. The Edge Function authenticates every request and uses its own built-in Supabase admin credential; that database credential never leaves the function.

Supabase stores only public-feed news and collector health. Its two public-schema tables have RLS, revoked anon/authenticated grants and service-role-only policies. An expiring conditional-write lease coordinates collection. The Site synchronises at most once per minute, keeps a D1 copy and preserves previous news if the cloud read fails. Saved stories and preferences remain in Sites D1. Cloud health reports actual completed runs; source attempt/success times remain distinct.

The primary job is sustain-news-collector. A daily cleanup retains only 14 days of its cron history. Publisher feeds remain capped at 100 articles and 90 days; even failed feeds prune dated expired records. Cloud retention does not affect user-saved snapshots. If Supabase is paused or unavailable, cached news remains visible and the status shows the delay. No email or push notifications are created.

The remote schema is defined in cloud/schema.sql and cloud/service-policies.sql, applied as recorded Supabase migrations. cloud/collector.mjs uses the same feed parser, source list and retrieval code as the Site. Build its self-contained bundle with node scripts/build-collector.mjs; no runtime dependency download is needed. The application lockfile pins the bundled dependencies. Supabase project creation was quoted at $0 per month for this organisation; usage remains subject to its plan limits.

Collected stories last up to 90 days, capped at 100 per source. Failed feeds retain their last successful data and show separate attempt/success timestamps. There is no sample-news fallback. Article URLs are deduplicated. Exact or very similar headlines can be grouped only with matching stage, topic, region and nearby dates; every publisher link remains. Different stages or conflicting identified amounts stay separate. Syndicated coverage does not increase priority.

## Briefs and priority

Publisher excerpts are limited to 45 words / 330 characters. Full content:encoded articles, images and paywalled content are not fetched. Cards add extracted stage, first currency amount and qualifications. No generative AI or full-article summarisation service is used. Reading context is general topic context, not a transaction-specific conclusion.

server/assessment.mjs explains priority through stage, explicitly named geographic scope and currency amounts. Intentions, proposals and conditional funding have capped scale points. Reversals can be high priority. USD/EUR/GBP use rough nominal bands, with no conversion; other currencies receive no scale points. Unknown scope receives no scope points. The score is a reading aid, not investment advice or a reliability measure. Every component is exposed in the rating explanation and method dialog.

## Personal reading and calendar

The platform supplies the authenticated user ID. /api/me, /api/preferences and /api/saved require this identity. Writes require a same-origin JSON request, validate bounded inputs, and use prepared SQL. Each reader owns preferences and up to 500 saved snapshots, persisted in D1 across devices. Saved URLs must exist in collected feeds. No client-selected user ID is trusted. The local-only preview injects a fixed preview identity; production never does.

Daily briefing selects up to ten highest-priority collected articles from the past 24 hours matching the reader's topics and regions. It is calculated on visiting the site; optional default opening is saved with preferences. Email and push delivery are not configured. Saved stories remain until removed and explicitly display that their excerpt and assessment are snapshots.

server/deadlines.mjs contains six curated official milestones with scope, status, evidence, source link and verification date (17 September 2026). These are date-only events, not invented deadline times. The selected calendar is not automatically re-verified. RFC 5545 calendar downloads are snapshots without automatic updates.

## Build and verification

Use pnpm install --frozen-lockfile, node scripts/build.mjs, then node preview.mjs. Preview serves the built Worker using Node 24 SQLite in ignored .sites-runtime. dist/index.html, dist/styles.css and dist/app.js are authored assets embedded in dist/server/index.js at build time. Restart preview after builds. Production uses the existing Sites identity and owner-private access.

Run node --test tests/*.test.mjs for parsing, hostile input, retention, publisher failures, concurrent refresh, conservative prioritisation, related-source preservation, per-reader isolation and validated saves. Check /api/news for source availability. Schema migrations are generated from db/schema.ts with Drizzle and copied into the deployment bundle. Applied migrations are immutable; new changes append migrations. No production schema changes run in requests.
