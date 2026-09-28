-- API surface called by Edge Functions.
--   public_*  : executed as role anon (after rate limiting in the function).
--               SECURITY DEFINER, expose only non-personal data or data of the
--               single booking whose token hash was presented.
--   owner_*   : executed as role authenticated with verified JWT claims.
--               Mutations are SECURITY DEFINER + explicit membership check;
--               reads are SECURITY INVOKER so row level security applies.
--   worker / pipeline functions are granted to service_role only.

-- ---------------------------------------------------------------------------
-- Public (client) API
-- ---------------------------------------------------------------------------

create or replace function app.public_tenant(p_slug text) returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'slug', t.slug,
    'name', t.name,
    'shortName', t.short_name,
    'status', t.status,
    'timezone', t.timezone,
    'currency', t.currency,
    'locale', t.locale,
    'profile', t.profile,
    'configVersion', t.config_version,
    'services', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id, 'key', s.key, 'name', s.name, 'category', s.category,
               'description', s.description, 'durationMinutes', s.duration_minutes,
               'completion', s.completion,
               'price', jsonb_build_object('amount', s.price_amount, 'isFrom', s.price_is_from),
               'imagePath', s.image_path, 'popular', s.popular)
             order by s.sort_order)
        from app.services s
       where s.tenant_id = t.id and s.is_active and not s.is_paused
         and exists (select 1 from app.resources r
                      where r.tenant_id = s.tenant_id and r.is_active and not r.is_paused
                        and s.capability = any (r.capabilities))), '[]'::jsonb),
    'workingHours', coalesce((
      select jsonb_agg(jsonb_build_object('weekday', w.weekday,
                                          'opens', to_char(w.opens, 'HH24:MI'),
                                          'closes', to_char(w.closes, 'HH24:MI'))
             order by w.weekday, w.opens)
        from app.working_hours w where w.tenant_id = t.id), '[]'::jsonb),
    'exceptions', coalesce((
      select jsonb_agg(x order by x ->> 'date')
        from (
          select jsonb_build_object(
                   'date', e.on_date,
                   'closed', bool_and(e.opens is null),
                   'intervals', coalesce(jsonb_agg(jsonb_build_array(to_char(e.opens, 'HH24:MI'), to_char(e.closes, 'HH24:MI'))
                                                   order by e.opens) filter (where e.opens is not null), '[]'::jsonb),
                   'note', max(e.note)) as x
            from app.schedule_exceptions e
           where e.tenant_id = t.id
             and e.on_date between (now() at time zone t.timezone)::date
                               and (now() at time zone t.timezone)::date + 60
             and e.source = case when exists (
                   select 1 from app.schedule_exceptions o
                    where o.tenant_id = e.tenant_id and o.on_date = e.on_date and o.source = 'owner')
                 then 'owner' else 'config' end
           group by e.on_date) q), '[]'::jsonb),
    'media', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'kind', m.kind, 'source', m.source, 'path', m.path,
                                          'alt', m.alt, 'width', m.width, 'height', m.height)
             order by m.kind, m.source, m.sort_order, m.created_at)
        from app.media m where m.tenant_id = t.id), '[]'::jsonb),
    'resourcesCount', (select count(*) from app.resources r
                        where r.tenant_id = t.id and r.is_active and not r.is_paused)
  )
  from app.tenants t
  where t.slug = p_slug and t.status in ('preview', 'live')
$$;

create or replace function app.tenant_id_for_public(p_slug text) returns uuid
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select id into v_id from app.tenants where slug = p_slug and status in ('preview', 'live');
  if v_id is null then
    raise exception 'tenant_unavailable';
  end if;
  return v_id;
end;
$$;

create or replace function app.availability_json(
  p_tenant uuid, p_service uuid, p_from date, p_to date, p_exclude_booking uuid, p_enforce_policy boolean
) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_tz text;
  v_service app.services;
begin
  select timezone into v_tz from app.tenants where id = p_tenant;
  select * into v_service from app.services where tenant_id = p_tenant and id = p_service;
  if v_service.id is null then
    raise exception 'not_found' using detail = 'service';
  end if;
  return jsonb_build_object(
    'timezone', v_tz,
    'serviceId', p_service,
    'durationMinutes', v_service.duration_minutes,
    'completion', v_service.completion,
    'from', p_from,
    'to', p_to,
    'days', coalesce((
      select jsonb_agg(jsonb_build_object(
               'date', d.day,
               'slots', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'startAt', a.start_at,
                          'time', to_char(a.start_at at time zone v_tz, 'HH24:MI'),
                          'freeResources', cardinality(a.free_resources))
                        order by a.start_at)
                   from app.available_starts(p_tenant, p_service, p_from, p_to, p_exclude_booking, p_enforce_policy) a
                  where a.local_day = d.day and cardinality(a.free_resources) > 0), '[]'::jsonb))
             order by d.day)
        from (select g::date as day from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') g) d
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function app.public_availability(p_slug text, p_service uuid, p_from date, p_to date)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id_for_public(p_slug);
begin
  if p_to - p_from > 14 then
    raise exception 'invalid_input' using detail = 'max 15 days per request';
  end if;
  perform 1 from app.services where tenant_id = v_tenant and id = p_service and is_active and not is_paused;
  if not found then
    raise exception 'not_found' using detail = 'service';
  end if;
  return app.availability_json(v_tenant, p_service, p_from, p_to, null, true);
end;
$$;

create or replace function app.public_create_booking(
  p_slug text,
  p_service uuid,
  p_start timestamptz,
  p_customer_name text,
  p_phone text,
  p_car text,
  p_car_plate text,
  p_comment text,
  p_idempotency_key uuid,
  p_token_hash bytea
) returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id_for_public(p_slug);
begin
  return app.create_booking(
    v_tenant, p_service, p_start, p_customer_name, p_phone, p_car, p_car_plate, p_comment,
    p_idempotency_key,
    md5(concat_ws('|', p_service, extract(epoch from p_start), btrim(p_customer_name), p_phone,
                  btrim(p_car), upper(btrim(p_car_plate)), btrim(p_comment), encode(p_token_hash, 'hex'))),
    p_token_hash, 'client', null, null, true);
end;
$$;

-- Resolve a presented token hash to its booking (and tenant).
create or replace function app.booking_by_token(p_token_hash bytea, p_slug text)
returns table (tenant_id uuid, booking_id uuid)
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  return query
  with touched as (
    update app.booking_access a
       set last_used_at = now()
      from app.tenants t
     where a.token_hash = p_token_hash
       and t.id = a.tenant_id
       and t.slug = p_slug
    returning a.tenant_id, a.booking_id
  )
  select touched.tenant_id, touched.booking_id from touched;
  if not found then
    raise exception 'not_found' using detail = 'booking';
  end if;
end;
$$;

create or replace function app.public_get_booking(p_slug text, p_token_hash bytea) returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_booking uuid;
  v_tenant uuid;
begin
  select b.booking_id, b.tenant_id into v_booking, v_tenant from app.booking_by_token(p_token_hash, p_slug) b;
  return jsonb_build_object(
    'booking', app.booking_client_view(v_booking),
    'push', jsonb_build_object('subscriptions',
      (select count(*) from app.push_subscriptions s where s.tenant_id = v_tenant and s.booking_id = v_booking)));
end;
$$;

create or replace function app.public_booking_availability(
  p_slug text, p_token_hash bytea, p_from date, p_to date
) returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_booking uuid;
  v_tenant uuid;
  v_service uuid;
begin
  if p_to - p_from > 14 then
    raise exception 'invalid_input' using detail = 'max 15 days per request';
  end if;
  select b.booking_id, b.tenant_id into v_booking, v_tenant from app.booking_by_token(p_token_hash, p_slug) b;
  select service_id into v_service from app.bookings where tenant_id = v_tenant and id = v_booking;
  return app.availability_json(v_tenant, v_service, p_from, p_to, v_booking, true);
end;
$$;

create or replace function app.public_reschedule_booking(
  p_slug text, p_token_hash bytea, p_new_start timestamptz, p_idempotency_key uuid
) returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_booking uuid;
  v_tenant uuid;
begin
  select b.booking_id, b.tenant_id into v_booking, v_tenant from app.booking_by_token(p_token_hash, p_slug) b;
  return app.reschedule_booking(v_tenant, v_booking, p_new_start, p_idempotency_key, 'client', null, true);
end;
$$;

create or replace function app.public_cancel_booking(p_slug text, p_token_hash bytea, p_reason text) returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_booking uuid;
  v_tenant uuid;
begin
  select b.booking_id, b.tenant_id into v_booking, v_tenant from app.booking_by_token(p_token_hash, p_slug) b;
  return app.cancel_booking(v_tenant, v_booking, 'client', null, p_reason);
end;
$$;

create or replace function app.public_save_push_subscription(
  p_slug text, p_token_hash bytea, p_endpoint text, p_p256dh text, p_auth text, p_user_agent text
) returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_booking uuid;
  v_tenant uuid;
begin
  select b.booking_id, b.tenant_id into v_booking, v_tenant from app.booking_by_token(p_token_hash, p_slug) b;
  if p_endpoint !~ '^https://' or length(p_endpoint) > 2000 or length(p_p256dh) > 200 or length(p_auth) > 100 then
    raise exception 'invalid_input' using detail = 'subscription';
  end if;
  insert into app.push_subscriptions (tenant_id, audience, booking_id, endpoint, p256dh, auth_secret, user_agent)
  values (v_tenant, 'client', v_booking, p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (tenant_id, booking_id, endpoint) where audience = 'client'
  do update set p256dh = excluded.p256dh, auth_secret = excluded.auth_secret, failure_count = 0;
  return jsonb_build_object('subscribed', true);
end;
$$;

create or replace function app.public_delete_push_subscription(p_slug text, p_token_hash bytea, p_endpoint text)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_booking uuid;
  v_tenant uuid;
begin
  select b.booking_id, b.tenant_id into v_booking, v_tenant from app.booking_by_token(p_token_hash, p_slug) b;
  delete from app.push_subscriptions
   where tenant_id = v_tenant and booking_id = v_booking and endpoint = p_endpoint;
  return jsonb_build_object('subscribed', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- Owner API
-- ---------------------------------------------------------------------------

create or replace function app.owner_context() returns jsonb
language sql stable security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'tenantId', t.id, 'slug', t.slug, 'name', t.name, 'status', t.status,
           'timezone', t.timezone, 'currency', t.currency, 'role', m.role)
         order by t.name), '[]'::jsonb)
    from app.tenant_members m
    join app.tenants t on t.id = m.tenant_id
   where m.user_id = (select auth.uid())
$$;

create or replace function app.owner_tenant(p_tenant uuid) returns jsonb
language plpgsql stable security invoker
set search_path = ''
as $$
begin
  perform app.assert_member(p_tenant);
  return (
    select jsonb_build_object(
      'tenantId', t.id, 'slug', t.slug, 'name', t.name, 'shortName', t.short_name,
      'status', t.status, 'timezone', t.timezone, 'currency', t.currency, 'profile', t.profile,
      'configVersion', t.config_version, 'publishedAt', t.published_at,
      'resources', coalesce((
        select jsonb_agg(jsonb_build_object('id', r.id, 'key', r.key, 'name', r.name, 'kind', r.kind,
                                            'capabilities', r.capabilities, 'isActive', r.is_active,
                                            'isPaused', r.is_paused)
               order by r.sort_order)
          from app.resources r where r.tenant_id = t.id), '[]'::jsonb),
      'services', coalesce((
        select jsonb_agg(jsonb_build_object('id', s.id, 'key', s.key, 'name', s.name, 'category', s.category,
                                            'durationMinutes', s.duration_minutes, 'bufferMinutes', s.buffer_minutes,
                                            'completion', s.completion, 'capability', s.capability,
                                            'price', jsonb_build_object('amount', s.price_amount, 'isFrom', s.price_is_from),
                                            'isActive', s.is_active, 'isPaused', s.is_paused)
               order by s.sort_order)
          from app.services s where s.tenant_id = t.id), '[]'::jsonb),
      'workingHours', coalesce((
        select jsonb_agg(jsonb_build_object('weekday', w.weekday, 'opens', to_char(w.opens, 'HH24:MI'),
                                            'closes', to_char(w.closes, 'HH24:MI'))
               order by w.weekday, w.opens)
          from app.working_hours w where w.tenant_id = t.id), '[]'::jsonb),
      'exceptions', coalesce((
        select jsonb_agg(jsonb_build_object('id', e.id, 'date', e.on_date,
                                            'opens', to_char(e.opens, 'HH24:MI'), 'closes', to_char(e.closes, 'HH24:MI'),
                                            'note', e.note, 'source', e.source)
               order by e.on_date, e.opens nulls first)
          from app.schedule_exceptions e
         where e.tenant_id = t.id and e.on_date >= (now() at time zone t.timezone)::date - 1), '[]'::jsonb),
      'media', coalesce((
        select jsonb_agg(jsonb_build_object('id', m.id, 'kind', m.kind, 'source', m.source, 'path', m.path,
                                            'alt', m.alt, 'width', m.width, 'height', m.height)
               order by m.kind, m.source, m.sort_order, m.created_at)
          from app.media m where m.tenant_id = t.id), '[]'::jsonb))
      from app.tenants t where t.id = p_tenant);
end;
$$;

create or replace function app.owner_schedule(
  p_tenant uuid, p_from date, p_to date, p_include_cancelled boolean default false
) returns jsonb
language plpgsql stable security invoker
set search_path = ''
as $$
declare
  v_start timestamptz;
  v_end timestamptz;
  v_tz text;
begin
  perform app.assert_member(p_tenant);
  if p_to < p_from or p_to - p_from > 31 then
    raise exception 'invalid_input' using detail = 'period';
  end if;
  select starts_at, ends_at, timezone into v_start, v_end, v_tz from app.local_period(p_tenant, p_from, p_to);
  return jsonb_build_object(
    'period', jsonb_build_object('from', p_from, 'to', p_to, 'timezone', v_tz, 'startsAt', v_start, 'endsAt', v_end),
    'resources', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'kind', r.kind,
                                          'isActive', r.is_active, 'isPaused', r.is_paused)
             order by r.sort_order)
        from app.resources r where r.tenant_id = p_tenant and (r.is_active or exists (
          select 1 from app.resource_occupancies o where o.tenant_id = r.tenant_id and o.resource_id = r.id
             and o.during && tstzrange(v_start, v_end, '[)')))), '[]'::jsonb),
    'bookings', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', b.id, 'status', b.status, 'startAt', b.start_at, 'endAt', b.end_at,
               'occupiedUntil', b.occupied_until, 'resourceId', b.resource_id,
               'serviceName', b.service_name, 'customerName', b.customer_name, 'phone', c.phone,
               'car', b.car, 'carPlate', b.car_plate, 'comment', b.comment,
               'price', jsonb_build_object('amount', b.price_amount, 'isFrom', b.price_is_from),
               'finalAmount', b.final_amount,
               'paid', coalesce((select sum(p.amount) from app.payments p
                                  where p.tenant_id = b.tenant_id and p.booking_id = b.id), 0),
               'isDemo', b.is_demo, 'source', b.source)
             order by b.start_at)
        from app.bookings b
        join app.customers c on c.tenant_id = b.tenant_id and c.id = b.customer_id
       where b.tenant_id = p_tenant
         and b.start_at < v_end and b.occupied_until > v_start
         and (p_include_cancelled or b.status <> 'cancelled')), '[]'::jsonb),
    'blocks', coalesce((
      select jsonb_agg(jsonb_build_object('id', o.id, 'resourceId', o.resource_id,
                                          'from', lower(o.during), 'to', upper(o.during), 'note', o.note)
             order by lower(o.during))
        from app.resource_occupancies o
       where o.tenant_id = p_tenant and o.kind = 'block'
         and o.during && tstzrange(v_start, v_end, '[)')), '[]'::jsonb)
  );
end;
$$;

create or replace function app.owner_booking(p_tenant uuid, p_booking uuid) returns jsonb
language plpgsql stable security invoker
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  perform app.assert_member(p_tenant);
  select jsonb_build_object(
           'id', b.id, 'status', b.status, 'startAt', b.start_at, 'endAt', b.end_at,
           'occupiedUntil', b.occupied_until, 'resourceId', b.resource_id, 'resourceName', r.name,
           'serviceId', b.service_id, 'serviceName', b.service_name,
           'durationMinutes', b.duration_minutes, 'bufferMinutes', b.buffer_minutes,
           'customerName', b.customer_name, 'phone', c.phone,
           'car', b.car, 'carPlate', b.car_plate, 'comment', b.comment,
           'price', jsonb_build_object('amount', b.price_amount, 'isFrom', b.price_is_from, 'currency', b.currency),
           'finalAmount', b.final_amount, 'source', b.source, 'isDemo', b.is_demo,
           'createdAt', b.created_at, 'arrivedAt', b.arrived_at, 'completedAt', b.completed_at,
           'cancelledAt', b.cancelled_at, 'cancelledBy', b.cancelled_by, 'cancelReason', b.cancel_reason,
           'rescheduleCount', b.reschedule_count,
           'payments', coalesce((
             select jsonb_agg(jsonb_build_object('id', p.id, 'amount', p.amount, 'method', p.method,
                                                 'receivedAt', p.received_at, 'note', p.note)
                    order by p.received_at)
               from app.payments p where p.tenant_id = b.tenant_id and p.booking_id = b.id), '[]'::jsonb),
           'events', coalesce((
             select jsonb_agg(jsonb_build_object('kind', e.kind, 'actor', e.actor, 'data', e.data, 'at', e.created_at)
                    order by e.id)
               from app.booking_events e where e.tenant_id = b.tenant_id and e.booking_id = b.id), '[]'::jsonb),
           'customerHistory', (
             select jsonb_build_object('bookings', count(*),
                                       'completed', count(*) filter (where h.status = 'completed'))
               from app.bookings h where h.tenant_id = b.tenant_id and h.customer_id = b.customer_id))
    into v_result
    from app.bookings b
    join app.resources r on r.tenant_id = b.tenant_id and r.id = b.resource_id
    join app.customers c on c.tenant_id = b.tenant_id and c.id = b.customer_id
   where b.tenant_id = p_tenant and b.id = p_booking;
  if v_result is null then
    raise exception 'not_found' using detail = 'booking';
  end if;
  return v_result;
end;
$$;

create or replace function app.owner_find_bookings(p_tenant uuid, p_query text, p_limit integer default 20)
returns jsonb
language plpgsql stable security invoker
set search_path = ''
as $$
declare
  v_q text := btrim(coalesce(p_query, ''));
  v_digits text := regexp_replace(coalesce(p_query, ''), '\D', '', 'g');
begin
  perform app.assert_member(p_tenant);
  if length(v_q) < 2 then
    raise exception 'invalid_input' using detail = 'query too short';
  end if;
  return coalesce((
    select jsonb_agg(x)
      from (
        select jsonb_build_object('id', b.id, 'status', b.status, 'startAt', b.start_at,
                                  'serviceName', b.service_name, 'customerName', b.customer_name,
                                  'phone', c.phone, 'car', b.car, 'carPlate', b.car_plate) as x
          from app.bookings b
          join app.customers c on c.tenant_id = b.tenant_id and c.id = b.customer_id
         where b.tenant_id = p_tenant
           and (b.customer_name ilike '%' || v_q || '%'
                or b.car_plate ilike '%' || v_q || '%'
                or b.car ilike '%' || v_q || '%'
                or (length(v_digits) >= 4 and c.phone like '%' || v_digits || '%'))
         order by abs(extract(epoch from (b.start_at - now())))
         limit least(greatest(p_limit, 1), 50)) q), '[]'::jsonb);
end;
$$;

create or replace function app.owner_availability(
  p_tenant uuid, p_service uuid, p_from date, p_to date, p_exclude_booking uuid default null
) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform app.assert_member(p_tenant);
  if p_to - p_from > 14 then
    raise exception 'invalid_input' using detail = 'max 15 days per request';
  end if;
  return app.availability_json(p_tenant, p_service, p_from, p_to, p_exclude_booking, false);
end;
$$;

create or replace function app.owner_create_booking(
  p_tenant uuid, p_service uuid, p_start timestamptz, p_customer_name text, p_phone text,
  p_car text, p_car_plate text, p_comment text, p_idempotency_key uuid, p_resource uuid default null
) returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  perform app.assert_member(p_tenant);
  return app.create_booking(
    p_tenant, p_service, p_start, p_customer_name, p_phone, p_car, p_car_plate, p_comment,
    p_idempotency_key,
    md5(concat_ws('|', p_service, extract(epoch from p_start), btrim(p_customer_name), p_phone,
                  btrim(p_car), upper(btrim(p_car_plate)), btrim(p_comment), p_resource)),
    null, 'owner', (select auth.uid()), p_resource, false);
end;
$$;

create or replace function app.owner_reschedule_booking(
  p_tenant uuid, p_booking uuid, p_new_start timestamptz, p_idempotency_key uuid
) returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  perform app.assert_member(p_tenant);
  return app.reschedule_booking(p_tenant, p_booking, p_new_start, p_idempotency_key, 'owner', (select auth.uid()), false);
end;
$$;

create or replace function app.owner_cancel_booking(p_tenant uuid, p_booking uuid, p_reason text) returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  perform app.assert_member(p_tenant);
  return app.cancel_booking(p_tenant, p_booking, 'owner', (select auth.uid()), p_reason);
end;
$$;

create or replace function app.owner_set_booking_status(
  p_tenant uuid, p_booking uuid, p_status text, p_final_amount numeric default null
) returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  perform app.assert_member(p_tenant);
  return app.set_booking_status(p_tenant, p_booking, p_status, p_final_amount, (select auth.uid()));
end;
$$;

create or replace function app.owner_record_payment(
  p_tenant uuid, p_booking uuid, p_amount numeric, p_method text, p_received_at timestamptz,
  p_note text, p_idempotency_key uuid
) returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  perform app.assert_member(p_tenant);
  return app.record_payment(p_tenant, p_booking, p_amount, p_method, p_received_at, p_note,
                            p_idempotency_key, (select auth.uid()));
end;
$$;

create or replace function app.owner_block_resource(
  p_tenant uuid, p_resource uuid, p_from timestamptz, p_to timestamptz, p_note text
) returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  perform app.assert_member(p_tenant);
  return app.block_resource(p_tenant, p_resource, p_from, p_to, p_note, (select auth.uid()));
end;
$$;

create or replace function app.owner_unblock_resource(p_tenant uuid, p_block uuid) returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  perform app.assert_member(p_tenant);
  return app.unblock_resource(p_tenant, p_block);
end;
$$;

create or replace function app.owner_set_paused(p_tenant uuid, p_kind text, p_id uuid, p_paused boolean) returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  perform app.assert_member(p_tenant);
  if p_kind = 'service' then
    update app.services set is_paused = p_paused where tenant_id = p_tenant and id = p_id;
  elsif p_kind = 'resource' then
    update app.resources set is_paused = p_paused where tenant_id = p_tenant and id = p_id;
  else
    raise exception 'invalid_input' using detail = 'kind';
  end if;
  if not found then
    raise exception 'not_found' using detail = p_kind;
  end if;
  return jsonb_build_object('id', p_id, 'kind', p_kind, 'isPaused', p_paused);
end;
$$;

-- Replace the owner's exception for one date. p_intervals = [] means closed.
create or replace function app.owner_set_exception(p_tenant uuid, p_date date, p_intervals jsonb, p_note text)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_interval jsonb;
begin
  perform app.assert_member(p_tenant);
  if jsonb_typeof(p_intervals) <> 'array' or jsonb_array_length(p_intervals) > 4 then
    raise exception 'invalid_input' using detail = 'intervals';
  end if;
  delete from app.schedule_exceptions where tenant_id = p_tenant and on_date = p_date and source = 'owner';
  if jsonb_array_length(p_intervals) = 0 then
    insert into app.schedule_exceptions (tenant_id, on_date, note, source)
    values (p_tenant, p_date, nullif(btrim(p_note), ''), 'owner');
  else
    for v_interval in select * from jsonb_array_elements(p_intervals) loop
      insert into app.schedule_exceptions (tenant_id, on_date, opens, closes, note, source)
      values (p_tenant, p_date, (v_interval ->> 0)::time, (v_interval ->> 1)::time, nullif(btrim(p_note), ''), 'owner');
    end loop;
  end if;
  return jsonb_build_object('date', p_date, 'closed', jsonb_array_length(p_intervals) = 0);
end;
$$;

create or replace function app.owner_delete_exception(p_tenant uuid, p_date date) returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  perform app.assert_member(p_tenant);
  delete from app.schedule_exceptions where tenant_id = p_tenant and on_date = p_date and source = 'owner';
  return jsonb_build_object('date', p_date, 'deleted', found);
end;
$$;

create or replace function app.owner_add_media(
  p_tenant uuid, p_path text, p_alt text, p_width integer, p_height integer
) returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform app.assert_member(p_tenant);
  if p_path is null or position('tenants/' || p_tenant::text || '/owner/' in p_path) <> 1 or p_path like '%..%' then
    raise exception 'invalid_input' using detail = 'path';
  end if;
  insert into app.media (tenant_id, source, kind, path, alt, width, height, sort_order, uploaded_by)
  values (p_tenant, 'owner', 'gallery', p_path, coalesce(left(p_alt, 140), ''), p_width, p_height,
          (select coalesce(max(sort_order), 0) + 1 from app.media where tenant_id = p_tenant and source = 'owner'),
          (select auth.uid()))
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'path', p_path);
end;
$$;

create or replace function app.owner_delete_media(p_tenant uuid, p_media uuid) returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_path text;
begin
  perform app.assert_member(p_tenant);
  delete from app.media where tenant_id = p_tenant and id = p_media and source = 'owner'
  returning path into v_path;
  if v_path is null then
    raise exception 'not_found' using detail = 'media';
  end if;
  return jsonb_build_object('id', p_media, 'path', v_path, 'deleted', true);
end;
$$;

create or replace function app.owner_save_push_subscription(
  p_tenant uuid, p_endpoint text, p_p256dh text, p_auth text, p_user_agent text
) returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  perform app.assert_member(p_tenant);
  if p_endpoint !~ '^https://' or length(p_endpoint) > 2000 or length(p_p256dh) > 200 or length(p_auth) > 100 then
    raise exception 'invalid_input' using detail = 'subscription';
  end if;
  insert into app.push_subscriptions (tenant_id, audience, user_id, endpoint, p256dh, auth_secret, user_agent)
  values (p_tenant, 'owner', (select auth.uid()), p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (tenant_id, user_id, endpoint) where audience = 'owner'
  do update set p256dh = excluded.p256dh, auth_secret = excluded.auth_secret, failure_count = 0;
  return jsonb_build_object('subscribed', true);
end;
$$;

create or replace function app.owner_delete_push_subscription(p_tenant uuid, p_endpoint text) returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  perform app.assert_member(p_tenant);
  delete from app.push_subscriptions
   where tenant_id = p_tenant and audience = 'owner' and user_id = (select auth.uid()) and endpoint = p_endpoint;
  return jsonb_build_object('subscribed', false);
end;
$$;

create or replace function app.owner_push_status(p_tenant uuid) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform app.assert_member(p_tenant);
  return jsonb_build_object(
    'devices', (select count(*) from app.push_subscriptions
                 where tenant_id = p_tenant and audience = 'owner' and user_id = (select auth.uid())),
    'recent', coalesce((
      select jsonb_agg(jsonb_build_object('kind', j.kind, 'status', j.status, 'dueAt', j.due_at,
                                          'error', j.last_error) order by j.id desc)
        from (select * from app.notification_jobs
               where tenant_id = p_tenant and audience = 'owner'
               order by id desc limit 10) j), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- Shared atomic counters (rate limits, LLM budget) — service_role only
-- ---------------------------------------------------------------------------

create or replace function app.usage_hit(
  p_bucket text, p_window_seconds integer, p_limit bigint, p_cost bigint default 1
) returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_count bigint;
begin
  insert into app.usage_counters (bucket, window_start, count)
  values (p_bucket, v_window, p_cost)
  on conflict (bucket, window_start) do update set count = app.usage_counters.count + excluded.count
  returning count into v_count;
  return jsonb_build_object(
    'allowed', v_count <= p_limit,
    'count', v_count,
    'limit', p_limit,
    'resetAt', v_window + make_interval(secs => p_window_seconds));
end;
$$;

create or replace function app.usage_get(p_bucket text, p_window_seconds integer) returns bigint
language sql stable security definer
set search_path = ''
as $$
  select coalesce((
    select count from app.usage_counters
     where bucket = p_bucket
       and window_start = to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds)
  ), 0)
$$;

create or replace function app.housekeeping() returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_counters integer;
  v_ledger integer;
  v_jobs integer;
begin
  delete from app.usage_counters where window_start < now() - interval '2 days';
  get diagnostics v_counters = row_count;
  delete from app.request_ledger where created_at < now() - interval '14 days';
  get diagnostics v_ledger = row_count;
  delete from app.notification_jobs
   where status in ('sent', 'failed', 'cancelled', 'suppressed', 'skipped')
     and coalesce(finished_at, created_at) < now() - interval '90 days';
  get diagnostics v_jobs = row_count;
  return jsonb_build_object('counters', v_counters, 'ledger', v_ledger, 'jobs', v_jobs);
end;
$$;
