# Export verification

The Vercel edition was checked with Node.js 24 before packaging:

- A clean `npm ci` installation using `package-lock.json`, followed by `npm run build` and the full `npm test` suite.
- All five native Vercel function exports import successfully. The built HTML, bundled JavaScript and CSS were served successfully by the included local HTTP server.
- Regression coverage for news parsing, source health, automatic refresh/retries, verified authentication, account changes, request validation, isolated reader storage, feed-backed saves, cold/warm collector failures, and database fallback.
- The reader SQL passed 20 isolated PostgreSQL checks, documented in `supabase/README.md`.
- The dependency audit reported zero known vulnerabilities at export time.

The original page layout and stylesheet were retained, with account controls and authentication styles added. Browser visual verification was unavailable because the browser tool could not start in this session.

No live Vercel deployment, real account sign-in or production database migration was performed. Follow `START-HERE.md` to configure your project, then verify production sign-in, redirects, account isolation, persistence and mobile layout. Source exports do not contain the old Sites D1 reader records.
