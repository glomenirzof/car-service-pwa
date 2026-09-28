-- Booking operations. Each function runs inside the caller's transaction, so
-- every step (ledger, booking, occupancy, access token hash, audit event,
-- notification outbox) commits or rolls back together. Double booking is
-- prevented by the EXCLUDE constraint on app.resource_occupancies, never by
-- a read-then-write check alone.
--
-- Errors are raised with a stable machine-readable message:
--   not_found, forbidden, unauthenticated, tenant_unavailable, invalid_input,
--   slot_unavailable, conflict, invalid_state, too_late, idempotency_conflict

-- ---------------------------------------------------------------------------
-- Views returned to callers
-- ---------------------------------------------------------------------------

create or replace function app.booking_client_view(p_booking uuid) returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', b.id,
    'status', b.status,
    'startAt', b.start_at,
    'endAt', b.end_at,
    'service', jsonb_build_object('id', b.service_id, 'name', b.service_name,
                                  'durationMinutes', b.duration_minutes),
    'resource', jsonb_build_object('name', r.name),
    'price', jsonb_build_object('amount', b.price_amount, 'isFrom', b.price_is_from, 'currency', b.currency),
    'customerName', b.customer_name,
    'phoneMasked', regexp_replace(c.phone, '^(\+\d{1,2})\d+(\d{2})$', '\1•••••••\2'),
    'car', b.car,
    'carPlate', b.car_plate,
    'comment', b.comment,
    'isDemo', b.is_demo,
    'rescheduleCount', b.reschedule_count,
    'version', b.version,
    'changeDeadline', b.start_at - make_interval(hours => app.tenant_setting_int(t.profile, 'clientChangeUntilHours', 12)),
    'canChange', b.status = 'scheduled'
      and now() < b.start_at - make_interval(hours => app.tenant_setting_int(t.profile, 'clientChangeUntilHours', 12)),
    'tenant', jsonb_build_object(
      'slug', t.slug, 'name', t.name, 'timezone', t.timezone,
      'phone', t.profile -> 'contacts' ->> 'phone',
      'address', t.profile -> 'contacts' ->> 'address')
  )
  from app.bookings b
  join app.tenants t on t.id = b.tenant_id
  join app.resources r on r.tenant_id = b.tenant_id and r.id = b.resource_id
  join app.customers c on c.tenant_id = b.tenant_id and c.id = b.customer_id
  where b.id = p_booking
$$;

-- ---------------------------------------------------------------------------
-- Notification outbox
-- ---------------------------------------------------------------------------

create or replace function app.enqueue_job(
  p_booking app.bookings,
  p_audience text,
  p_kind text,
  p_dedupe_key text,
  p_due_at timestamptz,
  p_data jsonb default '{}'::jsonb
) returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  -- Preview tenants and demo bookings never produce real notifications.
  select case when t.status = 'live' and not p_booking.is_demo then 'pending' else 'suppressed' end
  into v_status
  from app.tenants t where t.id = p_booking.tenant_id;

  insert into app.notification_jobs (
    tenant_id, booking_id, audience, kind, dedupe_key, due_at, status,
    expected_start_at, expected_version, data)
  values (
    p_booking.tenant_id, p_booking.id, p_audience, p_kind, p_dedupe_key, p_due_at, v_status,
    p_booking.start_at, p_booking.version, p_data)
  on conflict (tenant_id, dedupe_key) do nothing;
end;
$$;

create or replace function app.schedule_booking_notifications(
  p_booking_id uuid,
  p_event text,   -- created | rescheduled | cancelled
  p_actor text    -- client | owner | system
) returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_booking app.bookings;
  v_profile jsonb;
  v_minutes integer;
  v_due timestamptz;
begin
  select * into v_booking from app.bookings where id = p_booking_id;
  select profile into v_profile from app.tenants where id = v_booking.tenant_id;

  if p_event in ('rescheduled', 'cancelled') then
    -- Reminders for the old time must never fire.
    update app.notification_jobs
       set status = 'cancelled', finished_at = now(), last_error = 'superseded:' || p_event
     where tenant_id = v_booking.tenant_id
       and booking_id = v_booking.id
       and kind = 'client_reminder'
       and status in ('pending', 'processing');
  end if;

  if p_event = 'created' and p_actor = 'client' then
    perform app.enqueue_job(v_booking, 'owner', 'owner_new_booking',
      'owner_new:' || v_booking.id, now());
  elsif p_event = 'rescheduled' then
    perform app.enqueue_job(v_booking,
      case when p_actor = 'client' then 'owner' else 'client' end,
      case when p_actor = 'client' then 'owner_booking_rescheduled' else 'client_booking_rescheduled' end,
      'rescheduled:' || v_booking.id || ':v' || v_booking.version, now());
  elsif p_event = 'cancelled' then
    perform app.enqueue_job(v_booking,
      case when p_actor = 'client' then 'owner' else 'client' end,
      case when p_actor = 'client' then 'owner_booking_cancelled' else 'client_booking_cancelled' end,
      'cancelled:' || v_booking.id, now());
  end if;

  if p_event in ('created', 'rescheduled') and v_booking.status = 'scheduled' then
    for v_minutes in
      select value::integer
      from jsonb_array_elements_text(coalesce(v_profile -> 'booking' -> 'reminderMinutesBefore', '[1440, 120]'::jsonb))
    loop
      v_due := v_booking.start_at - make_interval(mins => v_minutes);
      if v_due > now() + interval '1 minute' then
        perform app.enqueue_job(v_booking, 'client', 'client_reminder',
          'reminder:' || v_booking.id || ':' || extract(epoch from v_booking.start_at)::bigint || ':' || v_minutes,
          v_due, jsonb_build_object('minutesBefore', v_minutes));
      end if;
    end loop;
  end if;
end;
$$;

create or replace function app.log_booking_event(
  p_tenant uuid, p_booking uuid, p_kind text, p_actor text, p_actor_user uuid, p_data jsonb
) returns void
language sql volatile security definer
set search_path = ''
as $$
  insert into app.booking_events (tenant_id, booking_id, kind, actor, actor_user_id, data)
  values (p_tenant, p_booking, p_kind, p_actor, p_actor_user, coalesce(p_data, '{}'::jsonb))
$$;

-- ---------------------------------------------------------------------------
-- Idempotency ledger helpers
-- ---------------------------------------------------------------------------

-- Returns NULL when the key was claimed by this call (proceed), otherwise the
-- stored response of the earlier successful request. A concurrent duplicate
-- blocks on the primary key until the first transaction finishes.
create or replace function app.ledger_claim(
  p_tenant uuid, p_operation text, p_key uuid, p_request_hash text
) returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_row app.request_ledger;
begin
  if p_key is null then
    raise exception 'invalid_input' using detail = 'idempotency key is required';
  end if;
  insert into app.request_ledger (tenant_id, operation, idempotency_key, request_hash)
  values (p_tenant, p_operation, p_key, p_request_hash)
  on conflict do nothing;
  if found then
    return null;
  end if;
  select * into v_row from app.request_ledger
   where tenant_id = p_tenant and operation = p_operation and idempotency_key = p_key;
  if v_row.request_hash <> p_request_hash then
    raise exception 'idempotency_conflict';
  end if;
  return coalesce(v_row.response, '{}'::jsonb) || jsonb_build_object('replayed', true);
end;
$$;

create or replace function app.ledger_store(
  p_tenant uuid, p_operation text, p_key uuid, p_booking uuid, p_response jsonb
) returns void
language sql volatile security definer
set search_path = ''
as $$
  update app.request_ledger
     set booking_id = p_booking, response = p_response
   where tenant_id = p_tenant and operation = p_operation and idempotency_key = p_key
$$;

-- ---------------------------------------------------------------------------
-- Create
-- ---------------------------------------------------------------------------

create or replace function app.create_booking(
  p_tenant uuid,
  p_service uuid,
  p_start timestamptz,
  p_customer_name text,
  p_phone text,
  p_car text,
  p_car_plate text,
  p_comment text,
  p_idempotency_key uuid,
  p_request_hash text,
  p_token_hash bytea,
  p_source text,
  p_actor_user uuid default null,
  p_preferred_resource uuid default null,
  p_enforce_policy boolean default true
) returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_tenant app.tenants;
  v_service app.services;
  v_replay jsonb;
  v_free uuid[];
  v_resource uuid;
  v_customer uuid;
  v_booking app.bookings;
  v_is_demo boolean;
  v_response jsonb;
  v_name text := btrim(coalesce(p_customer_name, ''));
begin
  select * into v_tenant from app.tenants where id = p_tenant;
  if not found or v_tenant.status not in ('preview', 'live') then
    raise exception 'tenant_unavailable';
  end if;

  v_replay := app.ledger_claim(p_tenant, 'create', p_idempotency_key, p_request_hash);
  if v_replay is not null then
    return v_replay;
  end if;

  select * into v_service from app.services
   where tenant_id = p_tenant and id = p_service and is_active and not is_paused;
  if not found then
    raise exception 'not_found' using detail = 'service';
  end if;
  if length(v_name) < 1 or length(v_name) > 80 then
    raise exception 'invalid_input' using detail = 'name';
  end if;
  if p_phone is null or p_phone !~ '^\+\d{10,15}$' then
    raise exception 'invalid_input' using detail = 'phone';
  end if;
  if p_source = 'client' and (p_token_hash is null or octet_length(p_token_hash) <> 32) then
    raise exception 'invalid_input' using detail = 'token';
  end if;

  v_free := app.free_resources_at(p_tenant, p_service, p_start, null, p_enforce_policy);
  if v_free is null then
    raise exception 'slot_unavailable' using detail = 'not a reception moment';
  end if;
  if p_preferred_resource is not null then
    if not p_preferred_resource = any (v_free) then
      raise exception 'slot_unavailable' using detail = 'resource busy';
    end if;
    v_free := array_prepend(p_preferred_resource, array_remove(v_free, p_preferred_resource));
  end if;
  if cardinality(v_free) = 0 then
    raise exception 'slot_unavailable';
  end if;

  -- Everything booked while a studio is in preview is demo data.
  v_is_demo := v_tenant.status = 'preview' or p_source = 'demo';

  insert into app.customers (tenant_id, name, phone, is_demo)
  values (p_tenant, v_name, p_phone, v_is_demo)
  on conflict (tenant_id, phone) do update set updated_at = now()
  returning id into v_customer;

  -- Try suitable resources in order; a concurrent booking that grabbed the
  -- same resource surfaces as exclusion_violation and we move to the next one.
  foreach v_resource in array v_free loop
    begin
      insert into app.bookings (
        tenant_id, service_id, resource_id, customer_id, customer_name, status,
        start_at, end_at, occupied_until,
        service_name, duration_minutes, buffer_minutes,
        price_amount, price_is_from, currency,
        car, car_plate, comment, source, is_demo)
      values (
        p_tenant, p_service, v_resource, v_customer, v_name, 'scheduled',
        p_start,
        p_start + make_interval(mins => v_service.duration_minutes),
        p_start + make_interval(mins => v_service.duration_minutes + v_service.buffer_minutes),
        v_service.name, v_service.duration_minutes, v_service.buffer_minutes,
        v_service.price_amount, v_service.price_is_from, v_tenant.currency,
        nullif(btrim(p_car), ''), nullif(upper(btrim(p_car_plate)), ''), nullif(btrim(p_comment), ''),
        p_source, v_is_demo)
      returning * into v_booking;

      insert into app.resource_occupancies (tenant_id, resource_id, kind, booking_id, during, created_by)
      values (p_tenant, v_resource, 'booking', v_booking.id,
              tstzrange(v_booking.start_at, v_booking.occupied_until, '[)'), p_actor_user);
      exit;
    exception when exclusion_violation then
      v_booking := null;
    end;
  end loop;

  if v_booking.id is null then
    raise exception 'slot_unavailable';
  end if;

  if p_token_hash is not null then
    insert into app.booking_access (booking_id, tenant_id, token_hash)
    values (v_booking.id, p_tenant, p_token_hash);
  end if;

  perform app.log_booking_event(p_tenant, v_booking.id, 'created',
    case when p_source = 'owner' then 'owner' when p_source = 'demo' then 'system' else 'client' end,
    p_actor_user,
    jsonb_build_object('startAt', v_booking.start_at, 'resourceId', v_resource, 'price', v_booking.price_amount));

  perform app.schedule_booking_notifications(v_booking.id, 'created',
    case when p_source = 'owner' then 'owner' when p_source = 'demo' then 'system' else 'client' end);

  v_response := jsonb_build_object('booking', app.booking_client_view(v_booking.id), 'replayed', false);
  perform app.ledger_store(p_tenant, 'create', p_idempotency_key, v_booking.id, v_response);
  return v_response;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reschedule: the old occupancy is replaced inside the same transaction; if
-- no suitable resource is free the exception aborts the whole transaction and
-- the original booking and occupancy stay untouched.
-- ---------------------------------------------------------------------------

create or replace function app.reschedule_booking(
  p_tenant uuid,
  p_booking uuid,
  p_new_start timestamptz,
  p_idempotency_key uuid,
  p_actor text,
  p_actor_user uuid default null,
  p_enforce_policy boolean default true
) returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_tenant app.tenants;
  v_booking app.bookings;
  v_replay jsonb;
  v_free uuid[];
  v_resource uuid;
  v_placed boolean := false;
  v_old_start timestamptz;
  v_response jsonb;
begin
  select * into v_tenant from app.tenants where id = p_tenant;
  if not found or v_tenant.status not in ('preview', 'live') then
    raise exception 'tenant_unavailable';
  end if;

  v_replay := app.ledger_claim(p_tenant, 'reschedule', p_idempotency_key,
    p_booking::text || '@' || extract(epoch from p_new_start)::bigint);
  if v_replay is not null then
    return v_replay;
  end if;

  select * into v_booking from app.bookings
   where tenant_id = p_tenant and id = p_booking
   for update;
  if not found then
    raise exception 'not_found' using detail = 'booking';
  end if;
  if v_booking.status <> 'scheduled' then
    raise exception 'invalid_state' using detail = v_booking.status;
  end if;
  if p_actor = 'client' and now() >= v_booking.start_at
       - make_interval(hours => app.tenant_setting_int(v_tenant.profile, 'clientChangeUntilHours', 12)) then
    raise exception 'too_late';
  end if;

  if v_booking.start_at = p_new_start then
    v_response := jsonb_build_object('booking', app.booking_client_view(v_booking.id), 'replayed', false, 'changed', false);
    perform app.ledger_store(p_tenant, 'reschedule', p_idempotency_key, v_booking.id, v_response);
    return v_response;
  end if;

  v_free := app.free_resources_at(p_tenant, v_booking.service_id, p_new_start, v_booking.id, p_enforce_policy);
  if v_free is null or cardinality(v_free) = 0 then
    raise exception 'slot_unavailable';
  end if;
  -- Keep the car on the same resource when possible.
  if v_booking.resource_id = any (v_free) then
    v_free := array_prepend(v_booking.resource_id, array_remove(v_free, v_booking.resource_id));
  end if;

  v_old_start := v_booking.start_at;
  delete from app.resource_occupancies where tenant_id = p_tenant and booking_id = v_booking.id;

  foreach v_resource in array v_free loop
    begin
      insert into app.resource_occupancies (tenant_id, resource_id, kind, booking_id, during, created_by)
      values (p_tenant, v_resource, 'booking', v_booking.id,
              tstzrange(p_new_start,
                        p_new_start + make_interval(mins => v_booking.duration_minutes + v_booking.buffer_minutes),
                        '[)'),
              p_actor_user);
      v_placed := true;
      exit;
    exception when exclusion_violation then
      null;
    end;
  end loop;

  if not v_placed then
    -- Aborts the transaction: the delete above is rolled back as well.
    raise exception 'slot_unavailable';
  end if;

  update app.bookings
     set start_at = p_new_start,
         end_at = p_new_start + make_interval(mins => duration_minutes),
         occupied_until = p_new_start + make_interval(mins => duration_minutes + buffer_minutes),
         resource_id = v_resource,
         reschedule_count = reschedule_count + 1,
         version = version + 1
   where id = v_booking.id;

  perform app.log_booking_event(p_tenant, v_booking.id, 'rescheduled', p_actor, p_actor_user,
    jsonb_build_object('from', v_old_start, 'to', p_new_start, 'resourceId', v_resource));
  perform app.schedule_booking_notifications(v_booking.id, 'rescheduled', p_actor);

  v_response := jsonb_build_object('booking', app.booking_client_view(v_booking.id), 'replayed', false, 'changed', true);
  perform app.ledger_store(p_tenant, 'reschedule', p_idempotency_key, v_booking.id, v_response);
  return v_response;
end;
$$;

-- ---------------------------------------------------------------------------
-- Cancel (naturally idempotent: cancelling a cancelled booking returns it)
-- ---------------------------------------------------------------------------

create or replace function app.cancel_booking(
  p_tenant uuid,
  p_booking uuid,
  p_actor text,
  p_actor_user uuid default null,
  p_reason text default null
) returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_tenant app.tenants;
  v_booking app.bookings;
begin
  select * into v_tenant from app.tenants where id = p_tenant;
  if not found then
    raise exception 'tenant_unavailable';
  end if;
  select * into v_booking from app.bookings
   where tenant_id = p_tenant and id = p_booking
   for update;
  if not found then
    raise exception 'not_found' using detail = 'booking';
  end if;
  if v_booking.status = 'cancelled' then
    return jsonb_build_object('booking', app.booking_client_view(v_booking.id), 'changed', false);
  end if;
  if v_booking.status not in ('scheduled', 'arrived') or (p_actor = 'client' and v_booking.status <> 'scheduled') then
    raise exception 'invalid_state' using detail = v_booking.status;
  end if;
  if p_actor = 'client' and now() >= v_booking.start_at
       - make_interval(hours => app.tenant_setting_int(v_tenant.profile, 'clientChangeUntilHours', 12)) then
    raise exception 'too_late';
  end if;

  update app.bookings
     set status = 'cancelled',
         cancelled_at = now(),
         cancelled_by = p_actor,
         cancel_reason = nullif(btrim(p_reason), ''),
         version = version + 1
   where id = v_booking.id;
  delete from app.resource_occupancies where tenant_id = p_tenant and booking_id = v_booking.id;

  perform app.log_booking_event(p_tenant, v_booking.id, 'cancelled', p_actor, p_actor_user,
    jsonb_build_object('reason', p_reason));
  perform app.schedule_booking_notifications(v_booking.id, 'cancelled', p_actor);

  return jsonb_build_object('booking', app.booking_client_view(v_booking.id), 'changed', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Status changes by the owner: arrived (a visit), completed (an order),
-- no_show. Completing early or marking a no-show frees the rest of the range.
-- ---------------------------------------------------------------------------

create or replace function app.set_booking_status(
  p_tenant uuid,
  p_booking uuid,
  p_status text,
  p_final_amount numeric default null,
  p_actor_user uuid default null
) returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_booking app.bookings;
begin
  select * into v_booking from app.bookings
   where tenant_id = p_tenant and id = p_booking
   for update;
  if not found then
    raise exception 'not_found' using detail = 'booking';
  end if;
  if p_final_amount is not null and p_final_amount < 0 then
    raise exception 'invalid_input' using detail = 'final_amount';
  end if;
  if v_booking.status = p_status then
    return jsonb_build_object('booking', app.booking_client_view(v_booking.id), 'changed', false);
  end if;

  if p_status = 'arrived' and v_booking.status = 'scheduled' then
    update app.bookings set status = 'arrived', arrived_at = now(), version = version + 1
     where id = v_booking.id;
  elsif p_status = 'completed' and v_booking.status in ('scheduled', 'arrived') then
    update app.bookings
       set status = 'completed',
           completed_at = now(),
           arrived_at = coalesce(arrived_at, now()),
           final_amount = coalesce(p_final_amount, price_amount),
           version = version + 1
     where id = v_booking.id;
    update app.resource_occupancies
       set during = tstzrange(lower(during),
                              greatest(lower(during) + interval '1 minute',
                                       least(upper(during), now() + make_interval(mins => v_booking.buffer_minutes))),
                              '[)')
     where tenant_id = p_tenant and booking_id = v_booking.id;
  elsif p_status = 'no_show' and v_booking.status = 'scheduled' then
    update app.bookings set status = 'no_show', version = version + 1 where id = v_booking.id;
    update app.resource_occupancies
       set during = tstzrange(lower(during),
                              greatest(lower(during) + interval '1 minute', least(upper(during), now())),
                              '[)')
     where tenant_id = p_tenant and booking_id = v_booking.id;
  else
    raise exception 'invalid_state' using detail = v_booking.status || '->' || p_status;
  end if;

  update app.notification_jobs
     set status = 'cancelled', finished_at = now(), last_error = 'superseded:' || p_status
   where tenant_id = p_tenant and booking_id = v_booking.id
     and kind = 'client_reminder' and status in ('pending', 'processing')
     and p_status in ('completed', 'no_show');

  perform app.log_booking_event(p_tenant, v_booking.id, 'status_' || p_status, 'owner', p_actor_user,
    jsonb_build_object('finalAmount', p_final_amount));
  return jsonb_build_object('booking', app.booking_client_view(v_booking.id), 'changed', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Payments actually received (idempotent)
-- ---------------------------------------------------------------------------

create or replace function app.record_payment(
  p_tenant uuid,
  p_booking uuid,
  p_amount numeric,
  p_method text,
  p_received_at timestamptz,
  p_note text,
  p_idempotency_key uuid,
  p_actor_user uuid default null
) returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_booking app.bookings;
  v_replay jsonb;
  v_payment app.payments;
  v_response jsonb;
begin
  v_replay := app.ledger_claim(p_tenant, 'payment', p_idempotency_key,
    p_booking::text || ':' || p_amount::text || ':' || p_method);
  if v_replay is not null then
    return v_replay;
  end if;
  select * into v_booking from app.bookings where tenant_id = p_tenant and id = p_booking;
  if not found then
    raise exception 'not_found' using detail = 'booking';
  end if;
  if v_booking.status = 'cancelled' then
    raise exception 'invalid_state' using detail = 'cancelled';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'invalid_input' using detail = 'amount';
  end if;
  if p_method not in ('cash', 'card', 'transfer', 'other') then
    raise exception 'invalid_input' using detail = 'method';
  end if;

  insert into app.payments (tenant_id, booking_id, amount, method, received_at, note, recorded_by, is_demo)
  values (p_tenant, p_booking, round(p_amount, 2), p_method, coalesce(p_received_at, now()),
          nullif(btrim(p_note), ''), p_actor_user, v_booking.is_demo)
  returning * into v_payment;

  perform app.log_booking_event(p_tenant, p_booking, 'payment_recorded', 'owner', p_actor_user,
    jsonb_build_object('paymentId', v_payment.id, 'amount', v_payment.amount, 'method', v_payment.method));

  v_response := jsonb_build_object(
    'payment', jsonb_build_object('id', v_payment.id, 'amount', v_payment.amount, 'method', v_payment.method,
                                  'receivedAt', v_payment.received_at),
    'replayed', false);
  perform app.ledger_store(p_tenant, 'payment', p_idempotency_key, p_booking, v_response);
  return v_response;
end;
$$;

-- ---------------------------------------------------------------------------
-- Owner blocks a resource (maintenance, private work). Same table, same
-- EXCLUDE constraint as bookings.
-- ---------------------------------------------------------------------------

create or replace function app.block_resource(
  p_tenant uuid,
  p_resource uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_note text,
  p_actor_user uuid default null
) returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_conflicts jsonb;
begin
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '60 days' then
    raise exception 'invalid_input' using detail = 'range';
  end if;
  perform 1 from app.resources where tenant_id = p_tenant and id = p_resource;
  if not found then
    raise exception 'not_found' using detail = 'resource';
  end if;
  begin
    insert into app.resource_occupancies (tenant_id, resource_id, kind, during, note, created_by)
    values (p_tenant, p_resource, 'block', tstzrange(p_from, p_to, '[)'), nullif(btrim(p_note), ''), p_actor_user)
    returning id into v_id;
  exception when exclusion_violation then
    select coalesce(jsonb_agg(jsonb_build_object(
             'kind', o.kind, 'bookingId', o.booking_id,
             'from', lower(o.during), 'to', upper(o.during),
             'serviceName', b.service_name, 'customerName', b.customer_name)
             order by lower(o.during)), '[]'::jsonb)
      into v_conflicts
      from app.resource_occupancies o
      left join app.bookings b on b.tenant_id = o.tenant_id and b.id = o.booking_id
     where o.tenant_id = p_tenant and o.resource_id = p_resource
       and o.during && tstzrange(p_from, p_to, '[)');
    raise exception 'conflict' using detail = v_conflicts::text;
  end;
  return jsonb_build_object('id', v_id, 'resourceId', p_resource, 'from', p_from, 'to', p_to);
end;
$$;

create or replace function app.unblock_resource(p_tenant uuid, p_block uuid) returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  delete from app.resource_occupancies where tenant_id = p_tenant and id = p_block and kind = 'block';
  if not found then
    raise exception 'not_found' using detail = 'block';
  end if;
  return jsonb_build_object('id', p_block, 'deleted', true);
end;
$$;
