# Reader database setup

Use the **existing Supabase project that runs Sustain's news collector**. Run [`reader-setup.sql`](./reader-setup.sql) in that project's SQL Editor, then follow the Vercel deployment instructions in the export's top-level documentation. Re-running the reader script preserves saved data and reapplies this script's policies and function.

This adds two reader tables and one save function. It does not change `sustain_sources`, `sustain_collector`, the collector Edge Function, Vault secrets, or its 15-minute Cron schedule. Do not rerun `cloud/schema.sql` or create a second collector for this migration. A different Supabase project needs the collector deployed and collecting successfully before the reader setup can be used.

Existing ChatGPT/Sites reader identities do not map automatically to Supabase Auth users. The portable edition's saved stories and preferences start with the new Supabase accounts; this script does not copy the old private reading lists.

## Server contract

The Vercel server verifies the caller with Supabase Auth, obtains that verified user's UUID, then uses its server-only Supabase secret key. Every preferences/list/delete query must include that exact `user_id`. Never accept a user ID or article payload from a browser request. The database's `service_role` bypasses RLS, so that filtering is required even with RLS enabled.

The browser has no direct table or RPC access: `PUBLIC`, `anon`, and `authenticated` privileges are revoked. Only the backend's `service_role` receives the relevant privileges. Keep the server secret out of browser bundles and source control.

For saves, resolve the submitted article URL against the collected feed, then call `sustain_save_story` with:

| Argument | Value |
| --- | --- |
| `p_user_id` | UUID returned by successful server-side Auth verification |
| `p_url` | The grouped story representative's canonical source URL |
| `p_payload` | The server's trusted article object, whose `url` equals `p_url` |
| `p_saved_at` | Current Unix time in milliseconds |

The function returns a saved-story row (`user_id`, `article_url`, `payload`, `saved_at`). Use its returned `saved_at` in the response: saving an existing story replaces its payload but preserves the original saved date. The URL must still occur in a top-level article in `sustain_sources`. Other source links grouped under the story should first resolve to that representative URL in the server.

All application saves must use this RPC. Direct admin table inserts bypass its 500-story limit. Deletions may use a normal server-side, user-filtered table delete.

| SQL error | Meaning | Suggested HTTP handling |
| --- | --- | --- |
| `P0001` / `saved_story_limit` | Already at 500 stories | 409, ask the reader to remove one |
| `P0002` / `story_not_in_feed` | URL has aged out or is not collected | 404, ask the reader to refresh |
| `22023` / `invalid_saved_story` | Invalid URL, payload, or timestamp | 400 for invalid input; log a server-built payload error |
| `25001` / `save_requires_read_committed` | Unsupported transaction isolation | Server configuration error; use default READ COMMITTED |

The RPC uses a per-user transaction advisory lock. Under READ COMMITTED, the count query sees saves committed by the previous lock holder before admitting a new story. Snapshot isolation is rejected to prevent a stale count after waiting. The lock releases automatically on commit or rollback. Different readers can save independently.

## Verify the installation

Run this read-only query after setup. Both table rows should show RLS enabled, neither public role should have table access, and only `service_role` should have RPC access:

```sql
select
  c.relname,
  c.relrowsecurity as rls_enabled,
  has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE') as anon_access,
  has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE') as authenticated_access,
  has_table_privilege('service_role', c.oid, 'SELECT,INSERT,UPDATE,DELETE') as service_access
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('sustain_reader_preferences', 'sustain_saved_stories');

select
  role_name,
  has_function_privilege(
    role_name,
    'public.sustain_save_story(uuid,text,jsonb,bigint)',
    'EXECUTE'
  ) as can_save
from (values ('anon'), ('authenticated'), ('service_role')) roles(role_name);

select prosecdef as security_definer, proconfig
from pg_proc
where oid = 'public.sustain_save_story(uuid,text,jsonb,bigint)'::regprocedure;
```

The function must report `security_definer = false`; its search path is empty. Then exercise the deployed app using two different test accounts: each should see only their own saved stories and preferences. Signing out must deny reader API access. Removing a story must leave the other account's copy intact.

## Local SQL verification performed

The exact setup script passed 20 checks using an isolated, in-memory PostgreSQL engine (PGlite 0.5.8), with simulated Supabase roles and `auth.users`. Checks covered applying setup twice, RLS and privilege metadata, actual anonymous/authenticated permission failures, service-role saves, feed membership, invalid/oversized payloads, preserving the first saved date, the 500-story cap, resaving at capacity, saving after deletion, separate users' limits, rejecting snapshot isolation, and account-deletion cascades.

No live database was modified by these tests. PGlite uses one connection, so this validates SQL execution and behavior but is not a multi-session concurrency test. For a staging concurrency check, start with 499 stories for a test user and submit two distinct feed-backed saves from separate sessions. Hold the first transaction open: the second must wait, then fail with `saved_story_limit` after the first commits. Both users and feed fixtures for that test should be disposable staging data.

References: [Supabase database functions](https://supabase.com/docs/guides/database/functions), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [PostgreSQL advisory locks](https://www.postgresql.org/docs/current/explicit-locking.html#ADVISORY-LOCKS), [transaction isolation](https://www.postgresql.org/docs/current/transaction-iso.html).
