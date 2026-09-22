-- The collector token must already exist in Vault. No raw credential belongs here.
-- Wake every minute, but dispatch only when collection is due or needs recovery.
-- A gateway failure leaves the work due; the next wake retries automatically.
select cron.schedule(
  'sustain-news-collector',
  '* * * * *',
  $job$
    select net.http_post(
      url := 'https://uapantevajhyxerdppnc.supabase.co/functions/v1/sustain-feed/collect',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'X-Sustain-Collector', (select decrypted_secret from vault.decrypted_secrets where name = 'sustain_collector_token')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    )
    from public.sustain_collector
    where id = true
      and lease_until < (extract(epoch from now()) * 1000)::bigint
      and (
        last_started <= (extract(epoch from now()) * 1000)::bigint - 870000
        or last_finished < last_started
        or last_error is not null
        or successful_sources < total_sources
        or exists (
          select 1 from public.sustain_sources
          where checked_at <= (extract(epoch from now()) * 1000)::bigint - 870000
        )
      );
  $job$
);
select cron.schedule(
  'sustain-cron-history-cleanup',
  '15 3 * * *',
  $job$
    delete from cron.job_run_details
    where jobid in (select jobid from cron.job where jobname in ('sustain-news-collector', 'sustain-cron-history-cleanup'))
      and end_time < now() - interval '14 days';
  $job$
);
