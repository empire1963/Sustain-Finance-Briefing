# Start here: Sustain on Vercel

This is the complete Vercel-ready source, including the backend and Supabase sign-in. Deployment to your Vercel account still needs the setup below; no Vercel site has been published by this export.

1. **Use your existing Supabase collector project.** Run `supabase/reader-setup.sql` in its SQL Editor. This adds the account preferences and saved-story tables without changing the news collector.
2. **Configure Supabase Auth.** Enable Email sign-in and email confirmation. In Auth URL Configuration, set the Site URL to your eventual production website address and add that address as an allowed redirect. Add `http://127.0.0.1:4174/` for local testing.
3. **Add environment values.** Copy `.env.example` to `.env` for local use. Fill in `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, and your approved email addresses in `SUSTAIN_ALLOWED_EMAILS`. Keep `SUSTAIN_PUBLIC_NEWS=false` for private access.
4. **Run the application with Node.js 24.**

```sh
npm ci
npm run build
npm test
npm run dev
```

Open [http://127.0.0.1:4174](http://127.0.0.1:4174), create your account, confirm its email, and sign in. Your email must match the server's allowed list.

5. **Import the source into Vercel.** Select the folder containing `package.json` as the project root, Framework Preset **Other**, and Node.js **24.x**. `vercel.json` already configures `npm ci`, `npm run build`, the `public` output directory, and API functions. Add the same environment values to the appropriate Vercel environments, then deploy.
6. **Finish the production URLs.** Add the deployed HTTPS address to Supabase Auth's Site URL and Redirect URLs, then test sign-in, saving a story, preferences, sign-out, and access from your iPhone. Add each preview URL separately if testing authentication on previews.

Use [VERCEL-MIGRATION.md](./VERCEL-MIGRATION.md) for the full configuration and troubleshooting notes. Do not upload only `dist/` or `public/`: Vercel needs the complete project for the API functions.

The existing cloud collector continues running independently. Its durable Supabase tables are used directly, so the optional cloud snapshot token is not required for the normal setup. Secrets and existing Sites D1 reader data are not included. Old reading lists require a separate identity-mapped data migration.
