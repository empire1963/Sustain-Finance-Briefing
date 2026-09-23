-- Sustain reader accounts for the portable Vercel edition.
-- Run once in the existing collector project's Supabase SQL Editor.
-- Re-running is safe for this script's own tables, policies and function.
-- Existing collector tables, Edge Functions and Cron jobs are not changed.
begin;

do $setup$
begin
  if pg_catalog.to_regclass('public.sustain_sources') is null then
    raise exception using
      errcode = 'P0001',
      message = 'collector_setup_required',
      hint = 'Use the Supabase project containing the existing Sustain collector.';
  end if;
end
$setup$;

create table if not exists public.sustain_reader_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  preferences jsonb not null
    check (jsonb_typeof(preferences) = 'object' and octet_length(preferences::text) <= 8192),
  updated_at bigint not null check (updated_at between 0 and 9007199254740991)
);

create table if not exists public.sustain_saved_stories (
  user_id uuid not null references auth.users (id) on delete cascade,
  article_url text not null
    check (length(article_url) between 8 and 2048
      and article_url ~* '^https?://'
      and article_url !~ '[[:space:][:cntrl:]]'),
  payload jsonb not null
    check (jsonb_typeof(payload) = 'object'
      and octet_length(payload::text) <= 65536
      and payload ->> 'url' is not null
      and payload ->> 'url' = article_url),
  saved_at bigint not null check (saved_at between 0 and 9007199254740991),
  primary key (user_id, article_url)
);

-- The primary keys cover user-filtered updates, deletions and account removal.
-- This index covers the saved list's newest-first retrieval.
create index if not exists sustain_saved_stories_user_saved_at_idx
  on public.sustain_saved_stories (user_id, saved_at desc, article_url);

alter table public.sustain_reader_preferences enable row level security;
alter table public.sustain_saved_stories enable row level security;

revoke all on public.sustain_reader_preferences, public.sustain_saved_stories
  from public, anon, authenticated;
grant select, insert, update, delete
  on public.sustain_reader_preferences, public.sustain_saved_stories
  to service_role;

drop policy if exists sustain_reader_preferences_service_access
  on public.sustain_reader_preferences;
create policy sustain_reader_preferences_service_access
  on public.sustain_reader_preferences for all to service_role
  using (true) with check (true);

drop policy if exists sustain_saved_stories_service_access
  on public.sustain_saved_stories;
create policy sustain_saved_stories_service_access
  on public.sustain_saved_stories for all to service_role
  using (true) with check (true);

comment on table public.sustain_reader_preferences is
  'Sustain preferences. Server-only access after Supabase Auth verification; always filter by verified user_id.';
comment on table public.sustain_saved_stories is
  'Sustain saved news. Server-only access; new saves must use sustain_save_story for the atomic 500-story cap.';

create or replace function public.sustain_save_story(
  p_user_id uuid,
  p_url text,
  p_payload jsonb,
  p_saved_at bigint
)
returns public.sustain_saved_stories
language plpgsql
volatile
security invoker
set search_path = ''
as $save$
declare
  v_saved public.sustain_saved_stories%rowtype;
begin
  if p_user_id is null
    or p_url is null
    or pg_catalog.length(p_url) not between 8 and 2048
    or p_url !~* '^https?://'
    or p_url ~ '[[:space:][:cntrl:]]'
    or p_payload is null
    or pg_catalog.jsonb_typeof(p_payload) <> 'object'
    or pg_catalog.octet_length(p_payload::text) > 65536
    or (p_payload ->> 'url') is distinct from p_url
    or p_saved_at is null
    or p_saved_at not between 0 and 9007199254740991 then
    raise exception using errcode = '22023', message = 'invalid_saved_story';
  end if;

  -- A fresh statement snapshot after the advisory lock sees the prior save's
  -- committed count. Reject snapshot-isolation callers that could see an old
  -- count after waiting. PostgREST's default READ COMMITTED is supported.
  if pg_catalog.current_setting('transaction_isolation')
    not in ('read committed', 'read uncommitted') then
    raise exception using errcode = '25001', message = 'save_requires_read_committed';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('sustain:saved-stories:' || p_user_id::text, 0)
  );

  -- The server resolves a grouped selection to the representative's canonical
  -- URL and constructs p_payload from its trusted feed, never the request body.
  -- Check source membership again here as defense in depth. The collector
  -- stores ungrouped articles, whose top-level url is the canonical source URL.
  if not exists (
    select 1 from public.sustain_sources as source
    where source.articles @> pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('url', p_url)
    )
  ) then
    raise exception using errcode = 'P0002', message = 'story_not_in_feed';
  end if;

  -- Existing saves do not consume another slot or reset their original date.
  update public.sustain_saved_stories
  set payload = p_payload
  where user_id = p_user_id and article_url = p_url
  returning * into v_saved;
  if found then
    return v_saved;
  end if;

  if (select count(*) from public.sustain_saved_stories where user_id = p_user_id) >= 500 then
    raise exception using errcode = 'P0001', message = 'saved_story_limit';
  end if;

  insert into public.sustain_saved_stories (user_id, article_url, payload, saved_at)
  values (p_user_id, p_url, p_payload, p_saved_at)
  returning * into v_saved;
  return v_saved;
end
$save$;

revoke all on function public.sustain_save_story(uuid, text, jsonb, bigint)
  from public, anon, authenticated;
grant execute on function public.sustain_save_story(uuid, text, jsonb, bigint)
  to service_role;

comment on function public.sustain_save_story(uuid, text, jsonb, bigint) is
  'Service-only save of a verified feed story; per-user transaction lock, 500-story limit, preserves saved_at. Requires READ COMMITTED.';

-- Refresh PostgREST's function/table schema cache after this transaction commits.
notify pgrst, 'reload schema';
commit;
