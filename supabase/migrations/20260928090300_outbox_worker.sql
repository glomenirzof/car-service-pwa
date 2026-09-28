-- Notification outbox worker API (service_role only).
-- Jobs are claimed with FOR UPDATE SKIP LOCKED and a lease; an expired lease
-- makes a job claimable again, so a crashed worker never loses a job and two
-- workers never send the same job concurrently. Before returning a job the
-- claim re-checks that the booking still matches what the job was created
-- for (status, start time, version) so a reschedule or cancellation that
-- happened after enqueueing never produces a stale reminder.

create or replace function app.claim_notification_jobs(
  p_worker text,
  p_limit integer default 20,
  p_lease_seconds integer default 120
) returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_claimed bigint[];
begin
  if p_worker is null or length(p_worker) = 0 then
    raise exception 'invalid_input' using detail = 'worker';
  end if;

  update app.notification_jobs
     set status = 'failed', finished_at = now(), last_error = coalesce(last_error, 'lease expired')
   where status = 'processing' and lease_until < now() and attempts >= max_attempts;

  with candidate as (
    select id
      from app.notification_jobs
     where (status = 'pending' and due_at <= now())
        or (status = 'processing' and lease_until < now() and attempts < max_attempts)
     order by due_at, id
     limit greatest(1, least(p_limit, 100))
     for update skip locked
  ), claimed as (
    update app.notification_jobs j
       set status = 'processing',
           leased_by = p_worker,
           lease_until = now() + make_interval(secs => p_lease_seconds),
           attempts = j.attempts + 1
      from candidate c
     where j.id = c.id
    returning j.id
  )
  select coalesce(array_agg(id), '{}') into v_claimed from claimed;

  -- Stale jobs: booking changed or no longer in the expected state.
  update app.notification_jobs j
     set status = 'skipped', finished_at = now(), lease_until = null, last_error = 'stale'
    from app.bookings b
   where j.id = any (v_claimed)
     and b.tenant_id = j.tenant_id and b.id = j.booking_id
     and (
       (j.kind = 'client_reminder' and (b.status <> 'scheduled' or b.start_at <> j.expected_start_at))
       or (j.kind in ('owner_booking_rescheduled', 'client_booking_rescheduled') and b.status = 'cancelled')
       or (j.kind = 'owner_new_booking' and b.status = 'cancelled')
     );

  -- Jobs without any push subscription have nobody to notify.
  update app.notification_jobs j
     set status = 'skipped', finished_at = now(), lease_until = null, last_error = 'no_subscriptions'
   where j.id = any (v_claimed)
     and j.status = 'processing'
     and not exists (
       select 1 from app.push_subscriptions s
        where s.tenant_id = j.tenant_id
          and ((j.audience = 'client' and s.audience = 'client' and s.booking_id = j.booking_id)
            or (j.audience = 'owner' and s.audience = 'owner'
                and exists (select 1 from app.tenant_members m
                             where m.tenant_id = s.tenant_id and m.user_id = s.user_id)))
     );

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', j.id,
      'kind', j.kind,
      'audience', j.audience,
      'attempts', j.attempts,
      'maxAttempts', j.max_attempts,
      'data', j.data,
      'tenant', jsonb_build_object('slug', t.slug, 'name', t.name, 'shortName', t.short_name,
                                   'timezone', t.timezone, 'status', t.status),
      'booking', jsonb_build_object(
        'id', b.id, 'status', b.status, 'startAt', b.start_at, 'endAt', b.end_at,
        'serviceName', b.service_name, 'customerName', b.customer_name,
        'resourceName', r.name, 'cancelReason', b.cancel_reason),
      'subscriptions', coalesce((
        select jsonb_agg(jsonb_build_object('id', s.id, 'endpoint', s.endpoint,
                                            'p256dh', s.p256dh, 'auth', s.auth_secret))
          from app.push_subscriptions s
         where s.tenant_id = j.tenant_id
           and ((j.audience = 'client' and s.audience = 'client' and s.booking_id = j.booking_id)
             or (j.audience = 'owner' and s.audience = 'owner'
                 and exists (select 1 from app.tenant_members m
                              where m.tenant_id = s.tenant_id and m.user_id = s.user_id)))
      ), '[]'::jsonb)
    ) order by j.due_at, j.id)
      from app.notification_jobs j
      join app.tenants t on t.id = j.tenant_id
      left join app.bookings b on b.tenant_id = j.tenant_id and b.id = j.booking_id
      left join app.resources r on r.tenant_id = b.tenant_id and r.id = b.resource_id
     where j.id = any (v_claimed) and j.status = 'processing'
  ), '[]'::jsonb);
end;
$$;

-- Report the outcome of a claimed job. Only the current lease holder may
-- finish it; returns false when the lease was lost (another worker took over).
create or replace function app.finish_notification_job(
  p_job bigint,
  p_worker text,
  p_outcome text,               -- sent | retry | failed
  p_error text default null,
  p_sent_count integer default 0,
  p_gone_endpoints text[] default '{}'
) returns boolean
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_job app.notification_jobs;
begin
  if p_outcome not in ('sent', 'retry', 'failed') then
    raise exception 'invalid_input' using detail = 'outcome';
  end if;
  select * into v_job from app.notification_jobs
   where id = p_job and status = 'processing' and leased_by = p_worker
   for update;
  if not found then
    return false;
  end if;

  if cardinality(p_gone_endpoints) > 0 then
    delete from app.push_subscriptions
     where tenant_id = v_job.tenant_id and endpoint = any (p_gone_endpoints);
  end if;

  if p_outcome = 'sent' then
    update app.notification_jobs
       set status = 'sent', finished_at = now(), lease_until = null,
           sent_count = p_sent_count, last_error = p_error
     where id = p_job;
    update app.push_subscriptions s
       set last_success_at = now(), failure_count = 0
     where s.tenant_id = v_job.tenant_id
       and ((v_job.audience = 'client' and s.booking_id = v_job.booking_id)
         or (v_job.audience = 'owner' and s.audience = 'owner'));
  elsif p_outcome = 'retry' and v_job.attempts < v_job.max_attempts then
    update app.notification_jobs
       set status = 'pending', lease_until = null, leased_by = null, last_error = p_error,
           due_at = now() + make_interval(secs => least(3600, 30 * power(2, v_job.attempts)::integer))
     where id = p_job;
  else
    update app.notification_jobs
       set status = 'failed', finished_at = now(), lease_until = null, last_error = p_error
     where id = p_job;
  end if;
  return true;
end;
$$;
