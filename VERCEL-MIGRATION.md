# Deploy Sustain on Vercel

The Vercel adapter, Supabase authentication and PostgreSQL reader storage are implemented in this export. Follow these steps to configure and deploy them. The export itself does not publish a Vercel deployment or migrate private data.

## 1. Prepare the existing Supabase project

Use the project that already runs the Sustain collector and contains `public.sustain_sources` and `public.sustain_collector`.

Run [`supabase/reader-setup.sql`](./supabase/reader-setup.sql) in its SQL Editor. It adds the reader preferences/saved-story tables and a service-only save RPC. It can be rerun without clearing reader data. The collector tables, Edge Function, Vault and Cron jobs remain in place. Do not apply the SQLite files in `drizzle/` to PostgreSQL or rerun the existing collector schema.

The API keeps its privileged Supabase key on the server, verifies each reader using Supabase Auth, and filters all personal operations by the verified user ID. The database rejects direct browser access. See [reader database details](./supabase/README.md) for the schema, save limit and verification queries.

## 2. Configure email sign-in

In Supabase Auth, enable the Email provider and **Confirm email**. The application supports account creation, email/password sign-in, password reset and sign-out; its API requires a verified email address.

In Auth **URL Configuration**:

- Set **Site URL** to your production HTTPS website address, for example `https://sustain.example.com/`.
- Add that exact address to **Redirect URLs**. Confirmation and password-reset links return to `/`.
- Add `http://127.0.0.1:4174/` for the included local server.
- Add the exact Vercel preview addresses you use for authentication testing. Avoid a redirect wildcard covering other people's deployments.

Use the final Vercel address if you do not have a custom website domain. You can finish this configuration immediately after the first deployment. Supabase's default email delivery has recipient/rate restrictions; configure its SMTP settings when needed for your intended readers. Confirm actual email delivery before relying on sign-up or password reset. [Password authentication](https://supabase.com/docs/guides/auth/passwords), [redirect configuration](https://supabase.com/docs/guides/auth/redirect-urls).

## 3. Configure environment values

For local development, copy `.env.example` to `.env`. In Vercel, add the same values in the project's Environment Variables settings for Production and any Preview environments you will use.

| Variable | Required value |
| --- | --- |
| `SUPABASE_URL` | Existing collector project's HTTPS API URL |
| `SUPABASE_PUBLISHABLE_KEY` | Its `sb_publishable_...` key; exposed to the browser for Auth |
| `SUPABASE_SECRET_KEY` | Its `sb_secret_...` server key; never exposed to the browser |
| `SUSTAIN_ALLOWED_EMAILS` | Comma-separated approved email addresses for private mode |
| `SUSTAIN_PUBLIC_NEWS` | Leave `false` for private mode; optionally set exactly `true` for public news |

Private mode is the default. An empty allowed-email list grants no reader access. Emails are compared without case sensitivity after server-side Auth verification. The allowed list and secret key are not included in `/api/config`.

Setting `SUSTAIN_PUBLIC_NEWS=true` makes the news feed readable without signing in and permits any verified account to use its own saved stories and preferences. Personal records still require authentication and remain scoped to that account. This setting therefore opens access beyond the private email list; use it only when that is intended.

The following server-only values are optional:

| Variable | Purpose |
| --- | --- |
| `SUSTAIN_CLOUD_URL` | Existing collector's HTTPS `/functions/v1/sustain-feed/snapshot` URL |
| `SUSTAIN_CLOUD_READ_TOKEN` | Matching private reader token for that endpoint |

Set both optional values to use the Edge snapshot first. If they are absent, Vercel reads the collector's durable tables directly. If the snapshot endpoint fails, the backend also falls back to those tables. The reader token is not needed for the normal direct-table setup.

Do not put the secret key or snapshot token in client code, URLs, Git, or a public-prefixed environment variable. Redeploy after changing Vercel environment values so the new deployment uses them.

## 4. Build locally

Use Node.js **24.x** and npm:

```sh
npm ci
npm run build
npm test
npm run dev
```

The local address is `http://127.0.0.1:4174/`. It uses the same Supabase API and Auth checks as Vercel and does not inject a fake user. Rebuild after frontend changes. `package-lock.json` pins the npm installation.

The build bundles `dist/app.js` and copies the authored HTML/CSS into `public/`. Keep `dist/` as source. API functions live in `api/` and call `runtime/`; they are not static files in `public/`.

## 5. Import and deploy

Import the complete project into Vercel, usually through your Git repository. Choose the directory containing this `package.json` as Root Directory.

| Setting | Value |
| --- | --- |
| Framework Preset | **Other** |
| Node.js version | **24.x** |
| Install Command | `npm ci` |
| Build Command | `npm run build` |
| Output Directory | `public` |

The supplied `vercel.json` already declares these build/output settings and the API function configuration. Add environment values, deploy, and finish the Supabase redirect URLs from step 2. Vercel supports the configured [Node.js 24 runtime](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions) and [project configuration](https://vercel.com/docs/project-configuration/vercel-json).

The Content Security Policy permits the standard `*.supabase.co` and `*.supabase.in` hosts. If `SUPABASE_URL` uses a **custom Supabase API hostname**, add that exact HTTPS origin to `connect-src` in `vercel.json` before deploying. A custom website domain only needs the corresponding Supabase Auth redirect settings.

## 6. Verify the deployed application

Create an approved account, confirm its email, and sign in. Check that news and source timestamps load, a saved story and preferences survive a reload, and sign-out removes private content from the interface. Check a second approved account sees its own reading list. In private mode, a signed-out `/api/news` request must return 401 and an unapproved verified account must be denied.

The existing collector works independently of Vercel: its schedule checks every minute for due work or recovery, while normal feed collection remains approximately every 15 minutes. Vercel Cron is unnecessary. Check actual completed-run timestamps in the application; a successful schedule entry alone does not prove the HTTP collection finished.

Durable news remains in Supabase even between Vercel cold starts. A warm function retains its last loaded snapshot on temporary failures; a fresh function cannot load news while all Supabase access is unavailable and returns a retryable error instead.

## Existing data and legacy source

Old Sites D1 saved stories and preferences are not inside the source archive. They do not transfer automatically to Supabase Auth accounts. A separate migration must export those records and map each old reader identity to its verified new account before importing.

The original Sites Worker, D1 schema/migrations and `.openai/hosting.json` are retained as legacy source. They are not Vercel configuration and do not supply authentication or a database binding to the new runtime. Shared news parsing and assessment modules remain in use. The existing `cloud/` files preserve the collector's source and configuration; reusing that collector does not require redeploying it.
