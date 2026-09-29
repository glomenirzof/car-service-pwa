-- Pipeline (tenant:publish / tenant:verify / activation) and owner reports.

-- ---------------------------------------------------------------------------
-- Publish a normalized business config. Upserts catalog rows by key and never
-- touches bookings, customers, payments, owner-uploaded media, owner schedule
-- exceptions or owner pause flags. Services/resources removed from the config
-- are deactivated (existing bookings keep referencing them).
-- ---------------------------------------------------------------------------

create or replace function app.publish_tenant(p_payload jsonb, p_config_hash text)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_t jsonb := p_payload -> 'tenant';
  v_tenant app.tenants;
  v_created boolean := false;
  v_item jsonb;
  v_ord integer;
  v_old app.services;
  v_service_id uuid;
  v_stats jsonb := '{}'::jsonb;
  v_added_services integer := 0;
  v_updated_services integer := 0;
  v_price_changes integer := 0;
  v_deactivated_services integer := 0;
  v_deactivated_resources integer := 0;
  v_future_on_inactive integer := 0;
begin
  if v_t is null or v_t ->> 'slug' is null then
    raise exception 'invalid_input' using detail = 'tenant.slug';
  end if;

  select * into v_tenant from app.tenants where slug = v_t ->> 'slug' for update;
  if not found then
    insert into app.tenants (slug, status, name, short_name, timezone, currency, locale, profile)
    values (v_t ->> 'slug', 'preview', v_t ->> 'name', v_t ->> 'shortName', v_t ->> 'timezone',
            coalesce(v_t ->> 'currency', 'RUB'), coalesce(v_t ->> 'locale', 'ru-RU'),
            coalesce(v_t -> 'profile', '{}'::jsonb))
    returning * into v_tenant;
    v_created := true;
  end if;

  update app.tenants
     set name = v_t ->> 'name',
         short_name = v_t ->> 'shortName',
         timezone = v_t ->> 'timezone',
         currency = coalesce(v_t ->> 'currency', 'RUB'),
         locale = coalesce(v_t ->> 'locale', 'ru-RU'),
         profile = coalesce(v_t -> 'profile', '{}'::jsonb),
         config_hash = p_config_hash,
         config_version = config_version + 1,
         published_at = now()
   where id = v_tenant.id
  returning * into v_tenant;

  -- Resources
  v_ord := 0;
  for v_item in select * from jsonb_array_elements(coalesce(p_payload -> 'resources', '[]'::jsonb)) loop
    v_ord := v_ord + 1;
    insert into app.resources (tenant_id, key, name, kind, description, capabilities, sort_order, is_active)
    values (v_tenant.id, v_item ->> 'key', v_item ->> 'name', coalesce(v_item ->> 'kind', 'box'),
            v_item ->> 'description',
            array(select jsonb_array_elements_text(v_item -> 'capabilities')), v_ord, true)
    on conflict (tenant_id, key) do update
       set name = excluded.name, kind = excluded.kind, description = excluded.description,
           capabilities = excluded.capabilities, sort_order = excluded.sort_order, is_active = true;
  end loop;
  update app.resources
     set is_active = false
   where tenant_id = v_tenant.id and is_active
     and key not in (select jsonb_array_elements(coalesce(p_payload -> 'resources', '[]'::jsonb)) ->> 'key');
  get diagnostics v_deactivated_resources = row_count;

  -- Services (+ price history on every price/duration change)
  v_ord := 0;
  for v_item in select * from jsonb_array_elements(coalesce(p_payload -> 'services', '[]'::jsonb)) loop
    v_ord := v_ord + 1;
    select * into v_old from app.services where tenant_id = v_tenant.id and key = v_item ->> 'key';
    insert into app.services (
      tenant_id, key, name, category, description, duration_minutes, buffer_minutes, completion,
      capability, price_amount, price_is_from, image_path, popular, sort_order, is_active)
    values (
      v_tenant.id, v_item ->> 'key', v_item ->> 'name', v_item ->> 'category',
      coalesce(v_item ->> 'description', ''),
      (v_item ->> 'durationMinutes')::integer, coalesce((v_item ->> 'bufferMinutes')::integer, 0),
      coalesce(v_item ->> 'completion', 'same_day'), v_item ->> 'capability',
      (v_item ->> 'priceAmount')::numeric, coalesce((v_item ->> 'priceIsFrom')::boolean, false),
      v_item ->> 'imagePath', coalesce((v_item ->> 'popular')::boolean, false), v_ord, true)
    on conflict (tenant_id, key) do update
       set name = excluded.name, category = excluded.category, description = excluded.description,
           duration_minutes = excluded.duration_minutes, buffer_minutes = excluded.buffer_minutes,
           completion = excluded.completion, capability = excluded.capability,
           price_amount = excluded.price_amount, price_is_from = excluded.price_is_from,
           image_path = excluded.image_path, popular = excluded.popular,
           sort_order = excluded.sort_order, is_active = true
    returning id into v_service_id;

    if v_old.id is null then
      v_added_services := v_added_services + 1;
    else
      v_updated_services := v_updated_services + 1;
    end if;
    if v_old.id is null
       or v_old.price_amount <> (v_item ->> 'priceAmount')::numeric
       or v_old.price_is_from <> coalesce((v_item ->> 'priceIsFrom')::boolean, false)
       or v_old.duration_minutes <> (v_item ->> 'durationMinutes')::integer
       or v_old.buffer_minutes <> coalesce((v_item ->> 'bufferMinutes')::integer, 0) then
      insert into app.service_price_history (tenant_id, service_id, price_amount, price_is_from,
                                             duration_minutes, buffer_minutes, source)
      values (v_tenant.id, v_service_id, (v_item ->> 'priceAmount')::numeric,
              coalesce((v_item ->> 'priceIsFrom')::boolean, false),
              (v_item ->> 'durationMinutes')::integer, coalesce((v_item ->> 'bufferMinutes')::integer, 0),
              'publish');
      if v_old.id is not null then
        v_price_changes := v_price_changes + 1;
      end if;
    end if;
  end loop;
  update app.services
     set is_active = false
   where tenant_id = v_tenant.id and is_active
     and key not in (select jsonb_array_elements(coalesce(p_payload -> 'services', '[]'::jsonb)) ->> 'key');
  get diagnostics v_deactivated_services = row_count;

  select count(*) into v_future_on_inactive
    from app.bookings b
    join app.services s on s.tenant_id = b.tenant_id and s.id = b.service_id
    join app.resources r on r.tenant_id = b.tenant_id and r.id = b.resource_id
   where b.tenant_id = v_tenant.id and b.status = 'scheduled' and b.start_at > now()
     and (not s.is_active or not r.is_active);

  -- Weekly hours are fully owned by the config.
  delete from app.working_hours where tenant_id = v_tenant.id;
  insert into app.working_hours (tenant_id, weekday, opens, closes)
  select v_tenant.id, (h ->> 'weekday')::smallint, (h ->> 'opens')::time, (h ->> 'closes')::time
    from jsonb_array_elements(coalesce(p_payload -> 'workingHours', '[]'::jsonb)) h;

  -- Config exceptions are replaced; owner exceptions are preserved.
  delete from app.schedule_exceptions where tenant_id = v_tenant.id and source = 'config';
  insert into app.schedule_exceptions (tenant_id, on_date, opens, closes, note, source)
  select v_tenant.id, (e ->> 'date')::date, (e ->> 'opens')::time, (e ->> 'closes')::time, e ->> 'note', 'config'
    from jsonb_array_elements(coalesce(p_payload -> 'exceptions', '[]'::jsonb)) e;

  -- Config media are replaced; owner uploads are preserved.
  delete from app.media where tenant_id = v_tenant.id and source = 'config';
  insert into app.media (tenant_id, source, kind, path, alt, width, height, sort_order)
  select v_tenant.id, 'config', m ->> 'kind', m ->> 'path', coalesce(m ->> 'alt', ''),
         (m ->> 'width')::integer, (m ->> 'height')::integer, coalesce((m ->> 'sortOrder')::integer, 0)
    from jsonb_array_elements(coalesce(p_payload -> 'media', '[]'::jsonb)) m;

  return jsonb_build_object(
    'tenantId', v_tenant.id,
    'slug', v_tenant.slug,
    'status', v_tenant.status,
    'created', v_created,
    'configVersion', v_tenant.config_version,
    'services', jsonb_build_object('added', v_added_services, 'updated', v_updated_services,
                                   'priceChanges', v_price_changes, 'deactivated', v_deactivated_services),
    'resources', jsonb_build_object('deactivated', v_deactivated_resources),
    'warnings', case when v_future_on_inactive > 0
                     then jsonb_build_array(v_future_on_inactive || ' будущих записей ссылаются на выключенные услуги или ресурсы')
                     else '[]'::jsonb end,
    'preserved', jsonb_build_object(
      'bookings', (select count(*) from app.bookings where tenant_id = v_tenant.id),
      'ownerMedia', (select count(*) from app.media where tenant_id = v_tenant.id and source = 'owner'),
      'ownerExceptions', (select count(*) from app.schedule_exceptions where tenant_id = v_tenant.id and source = 'owner'))
  );
end;
$$;

-- Readiness report used by tenant:verify and by activation.
create or replace function app.tenant_readiness(p_slug text) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_tenant app.tenants;
  v_problems text[] := '{}';
  v_bookable integer;
  v_hours integer;
  v_members integer;
begin
  select * into v_tenant from app.tenants where slug = p_slug;
  if not found then
    raise exception 'not_found' using detail = 'tenant';
  end if;
  select count(*) into v_bookable
    from app.services s
   where s.tenant_id = v_tenant.id and s.is_active
     and exists (select 1 from app.resources r
                  where r.tenant_id = s.tenant_id and r.is_active and s.capability = any (r.capabilities));
  select count(*) into v_hours from app.working_hours where tenant_id = v_tenant.id;
  select count(*) into v_members from app.tenant_members where tenant_id = v_tenant.id and role = 'owner';

  if v_bookable = 0 then v_problems := array_append(v_problems, 'нет ни одной услуги с подходящим ресурсом'); end if;
  if v_hours = 0 then v_problems := array_append(v_problems, 'не заданы рабочие часы'); end if;
  if v_members = 0 then v_problems := array_append(v_problems, 'не назначен владелец (npm run owner:invite)'); end if;
  if coalesce(v_tenant.profile -> 'contacts' ->> 'phone', '') = '' then
    v_problems := array_append(v_problems, 'не указан телефон');
  end if;
  if coalesce(v_tenant.profile -> 'contacts' ->> 'address', '') = '' then
    v_problems := array_append(v_problems, 'не указан адрес');
  end if;

  return jsonb_build_object(
    'tenantId', v_tenant.id,
    'slug', v_tenant.slug,
    'status', v_tenant.status,
    'configHash', v_tenant.config_hash,
    'configVersion', v_tenant.config_version,
    'bookableServices', v_bookable,
    'workingIntervals', v_hours,
    'owners', v_members,
    'demoBookings', (select count(*) from app.bookings where tenant_id = v_tenant.id and is_demo),
    'realBookings', (select count(*) from app.bookings where tenant_id = v_tenant.id and not is_demo),
    'ready', cardinality(v_problems) = 0,
    'problems', to_jsonb(v_problems)
  );
end;
$$;

-- Preview -> live. Refuses when business settings are incomplete, then removes
-- every demo row so the live studio starts clean.
create or replace function app.activate_tenant(p_slug text) returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_report jsonb;
  v_tenant_id uuid;
  v_deleted integer;
begin
  v_report := app.tenant_readiness(p_slug);
  if not (v_report ->> 'ready')::boolean then
    raise exception 'not_ready' using detail = (v_report -> 'problems')::text;
  end if;
  v_tenant_id := (v_report ->> 'tenantId')::uuid;

  delete from app.bookings where tenant_id = v_tenant_id and is_demo;
  get diagnostics v_deleted = row_count;
  delete from app.customers c
   where c.tenant_id = v_tenant_id and c.is_demo
     and not exists (select 1 from app.bookings b where b.tenant_id = c.tenant_id and b.customer_id = c.id);
  delete from app.notification_jobs where tenant_id = v_tenant_id and status = 'suppressed';

  update app.tenants set status = 'live', activated_at = now() where id = v_tenant_id;
  return jsonb_build_object('slug', p_slug, 'status', 'live', 'demoBookingsRemoved', v_deleted);
end;
$$;

create or replace function app.add_member(p_slug text, p_user uuid, p_role text default 'owner') returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  select id into v_tenant from app.tenants where slug = p_slug;
  if v_tenant is null then
    raise exception 'not_found' using detail = 'tenant';
  end if;
  insert into app.tenant_members (tenant_id, user_id, role) values (v_tenant, p_user, p_role)
  on conflict (tenant_id, user_id) do update set role = excluded.role;
  return jsonb_build_object('tenantId', v_tenant, 'userId', p_user, 'role', p_role);
end;
$$;

-- ---------------------------------------------------------------------------
-- Owner reports. SECURITY INVOKER: they run as the authenticated owner, so
-- row level security is what limits them to the owner's tenant.
-- ---------------------------------------------------------------------------

-- Period boundaries in the tenant timezone: [from 00:00, to+1 00:00).
create or replace function app.local_period(p_tenant uuid, p_from date, p_to date)
returns table (starts_at timestamptz, ends_at timestamptz, timezone text)
language sql stable security definer
set search_path = ''
as $$
  select p_from::timestamp at time zone t.timezone,
         (p_to + 1)::timestamp at time zone t.timezone,
         t.timezone
    from app.tenants t
   where t.id = p_tenant
$$;

create or replace function app.owner_stats(p_tenant uuid, p_from date, p_to date) returns jsonb
language plpgsql stable security invoker
set search_path = ''
as $$
declare
  v_start timestamptz;
  v_end timestamptz;
  v_tz text;
begin
  perform app.assert_member(p_tenant);
  if p_to < p_from or p_to - p_from > 366 then
    raise exception 'invalid_input' using detail = 'period';
  end if;
  select starts_at, ends_at, timezone into v_start, v_end, v_tz from app.local_period(p_tenant, p_from, p_to);

  return jsonb_build_object(
    'period', jsonb_build_object('from', p_from, 'to', p_to, 'timezone', v_tz,
                                 'startsAt', v_start, 'endsAt', v_end),
    -- A visit = the car actually arrived (arrived_at inside the period).
    'visits', (select count(*) from app.bookings
                where tenant_id = p_tenant and arrived_at >= v_start and arrived_at < v_end),
    -- Completed orders: work finished inside the period, at the final amount.
    'completedOrders', (
      select jsonb_build_object('count', count(*), 'amount', coalesce(sum(final_amount), 0))
        from app.bookings
       where tenant_id = p_tenant and status = 'completed'
         and completed_at >= v_start and completed_at < v_end),
    -- Money received inside the period, whatever the booking date.
    'paymentsReceived', (
      select jsonb_build_object(
               'count', coalesce(sum(m.n), 0),
               'amount', coalesce(sum(m.amount_sum), 0),
               'byMethod', coalesce(jsonb_object_agg(m.method, m.amount_sum), '{}'::jsonb))
        from (
          select method, sum(amount) as amount_sum, count(*) as n
            from app.payments
           where tenant_id = p_tenant and received_at >= v_start and received_at < v_end
           group by method
        ) m),
    -- Still-to-happen bookings in the period: expected value, NOT revenue.
    'upcoming', (
      select jsonb_build_object('count', count(*), 'expectedAmount', coalesce(sum(price_amount), 0))
        from app.bookings
       where tenant_id = p_tenant and status in ('scheduled', 'arrived')
         and start_at >= v_start and start_at < v_end),
    'cancelled', (select count(*) from app.bookings
                   where tenant_id = p_tenant and status = 'cancelled'
                     and cancelled_at >= v_start and cancelled_at < v_end),
    'noShows', (select count(*) from app.bookings
                 where tenant_id = p_tenant and status = 'no_show'
                   and start_at >= v_start and start_at < v_end),
    -- Completed in the period but not fully paid (all payments, any date).
    'outstanding', (
      select jsonb_build_object('count', count(*), 'amount', coalesce(sum(b.final_amount - coalesce(p.paid, 0)), 0))
        from app.bookings b
        left join (select booking_id, sum(amount) as paid from app.payments
                    where tenant_id = p_tenant group by booking_id) p on p.booking_id = b.id
       where b.tenant_id = p_tenant and b.status = 'completed'
         and b.completed_at >= v_start and b.completed_at < v_end
         and b.final_amount > coalesce(p.paid, 0)),
    'byService', coalesce((
      select jsonb_agg(jsonb_build_object('serviceName', service_name, 'count', n, 'amount', amount)
                       order by amount desc, service_name)
        from (select service_name, count(*) as n, sum(final_amount) as amount
                from app.bookings
               where tenant_id = p_tenant and status = 'completed'
                 and completed_at >= v_start and completed_at < v_end
               group by service_name) s), '[]'::jsonb),
    'byDay', coalesce((
      select jsonb_agg(jsonb_build_object(
               'date', d.day,
               'visits', (select count(*) from app.bookings
                           where tenant_id = p_tenant
                             and (arrived_at at time zone v_tz)::date = d.day),
               'completedAmount', (select coalesce(sum(final_amount), 0) from app.bookings
                                    where tenant_id = p_tenant and status = 'completed'
                                      and (completed_at at time zone v_tz)::date = d.day),
               'paymentsAmount', (select coalesce(sum(amount), 0) from app.payments
                                   where tenant_id = p_tenant
                                     and (received_at at time zone v_tz)::date = d.day))
               order by d.day)
        from (select g::date as day from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') g) d
       where p_to - p_from <= 62), '[]'::jsonb)
  );
end;
$$;
