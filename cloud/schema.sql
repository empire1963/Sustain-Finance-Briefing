create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create table public.sustain_sources (
  source_id text primary key,
  articles jsonb not null check (jsonb_typeof(articles) = 'array' and jsonb_array_length(articles) <= 100),
  checked_at bigint not null,
  fetched_at bigint not null,
  error text
);
create table public.sustain_collector (
  id boolean primary key default true check (id),
  lease_until bigint not null default 0,
  last_started bigint not null default 0,
  last_finished bigint not null default 0,
  last_error text,
  successful_sources integer not null default 0,
  total_sources integer not null default 0,
  run_count bigint not null default 0
);
alter table public.sustain_sources enable row level security;
alter table public.sustain_collector enable row level security;
revoke all on public.sustain_sources, public.sustain_collector from public, anon, authenticated;
grant select, insert, update, delete on public.sustain_sources, public.sustain_collector to service_role;
comment on table public.sustain_sources is 'Public news excerpts collected by Sustain; service-only, no client access.';
comment on table public.sustain_collector is 'Sustain collector lease and health; service-only, no client access.';
