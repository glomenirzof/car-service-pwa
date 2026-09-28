-- Supabase Cron schedules. Guarded so the migration is a no-op on databases
-- without pg_cron / pg_net (plain PostgreSQL used by local SQL tests).
--
-- The dispatcher Edge Function URL and its shared secret are read at run time
-- from Supabase Vault, so no secret is stored in this migration:
--   select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
--   select vault.create_secret('<random 32+ chars, same as CRON_SECRET>', 'cron_secret');
-- See SETUP.md, section "Supabase Cron".

do $outer$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron')
     or not exists (select 1 from pg_available_extensions where name = 'pg_net') then
    raise notice 'pg_cron/pg_net not available: skipping cron schedules';
    return;
  end if;

  create extension if not exists pg_cron;
  create extension if not exists pg_net with schema extensions;

  perform cron.unschedule(jobid) from cron.job where jobname in ('notify-dispatch', 'app-housekeeping');

  -- Every minute: ask the notify-dispatch Edge Function to drain due jobs.
  perform cron.schedule(
    'notify-dispatch',
    '* * * * *',
    $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
             || '/functions/v1/notify-dispatch',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
      body := jsonb_build_object('source', 'pg_cron', 'at', now()),
      timeout_milliseconds := 25000
    )
    where exists (select 1 from app.notification_jobs
                   where (status = 'pending' and due_at <= now())
                      or (status = 'processing' and lease_until < now()));
    $job$
  );

  -- Nightly: expire counters, idempotency records and old outbox rows.
  perform cron.schedule('app-housekeeping', '17 3 * * *', 'select app.housekeeping()');
end
$outer$;
