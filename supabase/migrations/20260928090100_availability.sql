-- Availability.
-- Working hours only define *reception moments* (when a car can be accepted).
-- A service then occupies one concrete suitable resource for a continuous
-- range [start, start + duration + buffer), which may span nights and days
-- for multi_day services. All local-date math uses the tenant timezone, so
-- DST changes and date boundaries follow the studio's wall clock.

-- Membership helpers (used by RLS policies and owner functions).
create or replace function app.is_member(p_tenant uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from app.tenant_members m
    where m.tenant_id = p_tenant and m.user_id = (select auth.uid())
  )
$$;

create or replace function app.assert_member(p_tenant uuid) returns void
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated';
  end if;
  if not app.is_member(p_tenant) then
    raise exception 'forbidden';
  end if;
end;
$$;

create or replace function app.tenant_setting_int(p_profile jsonb, p_key text, p_default integer)
returns integer
language sql immutable
set search_path = ''
as $$
  select coalesce((p_profile -> 'booking' ->> p_key)::integer, p_default)
$$;

-- Opening intervals of one local date as absolute timestamps.
-- Owner exceptions beat config exceptions; any exception for the date replaces
-- the weekly hours (a row with NULL times means "closed").
create or replace function app.day_intervals(p_tenant uuid, p_day date)
returns table (opens_at timestamptz, closes_at timestamptz)
language sql stable
set search_path = ''
as $$
  with t as (
    select timezone from app.tenants where id = p_tenant
  ),
  exc as (
    select e.opens, e.closes
    from app.schedule_exceptions e
    where e.tenant_id = p_tenant
      and e.on_date = p_day
      and e.source = case
        when exists (
          select 1 from app.schedule_exceptions o
          where o.tenant_id = p_tenant and o.on_date = p_day and o.source = 'owner'
        ) then 'owner' else 'config' end
  )
  select (p_day + e.opens) at time zone t.timezone,
         (p_day + e.closes) at time zone t.timezone
  from exc e cross join t
  where e.opens is not null
  union all
  select (p_day + w.opens) at time zone t.timezone,
         (p_day + w.closes) at time zone t.timezone
  from app.working_hours w cross join t
  where w.tenant_id = p_tenant
    and w.weekday = extract(isodow from p_day)::smallint
    and not exists (select 1 from exc)
$$;

-- Candidate start moments for a service in a local date range, with the list
-- of resources that are free for the whole occupied range at that moment.
-- p_enforce_policy applies lead time and booking horizon (client flow);
-- the owner cabinet may pass false.
create or replace function app.available_starts(
  p_tenant uuid,
  p_service uuid,
  p_from date,
  p_to date,
  p_exclude_booking uuid default null,
  p_enforce_policy boolean default true
)
returns table (start_at timestamptz, local_day date, free_resources uuid[])
language plpgsql stable
set search_path = ''
as $$
declare
  v_tenant app.tenants;
  v_service app.services;
  v_step integer;
  v_lead integer;
  v_horizon integer;
  v_work interval;
  v_total interval;
  v_today date;
begin
  select * into v_tenant from app.tenants where id = p_tenant;
  if not found then
    return;
  end if;
  select * into v_service from app.services where tenant_id = p_tenant and id = p_service;
  if not found then
    return;
  end if;
  if p_to < p_from or p_to - p_from > 62 then
    raise exception 'invalid_input' using detail = 'date range must be 0..62 days';
  end if;

  v_step := app.tenant_setting_int(v_tenant.profile, 'slotStepMinutes', 30);
  v_lead := app.tenant_setting_int(v_tenant.profile, 'minLeadMinutes', 60);
  v_horizon := app.tenant_setting_int(v_tenant.profile, 'horizonDays', 30);
  v_work := make_interval(mins => v_service.duration_minutes);
  v_total := make_interval(mins => v_service.duration_minutes + v_service.buffer_minutes);
  v_today := (now() at time zone v_tenant.timezone)::date;

  return query
  with days as (
    select d::date as day
    from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') d
    where not p_enforce_policy
       or (d::date >= v_today and d::date <= v_today + v_horizon)
  ),
  windows as (
    select days.day, w.opens_at, w.closes_at
    from days
    cross join lateral app.day_intervals(p_tenant, days.day) w
  ),
  candidates as (
    select distinct on (s) s as start_at, windows.day
    from windows
    cross join lateral generate_series(
      windows.opens_at,
      windows.closes_at - interval '1 second',
      make_interval(mins => v_step)
    ) s
    where (v_service.completion = 'multi_day' or s + v_work <= windows.closes_at)
      and (
        not p_enforce_policy
        or (s >= now() + make_interval(mins => v_lead)
            and s < now() + make_interval(days => v_horizon + 1))
      )
    order by s
  )
  select c.start_at,
         c.day,
         array(
           select r.id
           from app.resources r
           where r.tenant_id = p_tenant
             and r.is_active
             and not r.is_paused
             and v_service.capability = any (r.capabilities)
             and not exists (
               select 1
               from app.resource_occupancies o
               where o.tenant_id = p_tenant
                 and o.resource_id = r.id
                 and o.during && tstzrange(c.start_at, c.start_at + v_total, '[)')
                 and (p_exclude_booking is null or o.booking_id is distinct from p_exclude_booking)
             )
           order by r.sort_order, r.key
         )
  from candidates c
  order by c.start_at;
end;
$$;

-- Free resources for one exact start (NULL when the moment is not a valid
-- reception moment at all, empty array when every suitable resource is busy).
create or replace function app.free_resources_at(
  p_tenant uuid,
  p_service uuid,
  p_start timestamptz,
  p_exclude_booking uuid default null,
  p_enforce_policy boolean default true
) returns uuid[]
language plpgsql stable
set search_path = ''
as $$
declare
  v_tz text;
  v_day date;
  v_free uuid[];
begin
  select timezone into v_tz from app.tenants where id = p_tenant;
  if v_tz is null then
    return null;
  end if;
  v_day := (p_start at time zone v_tz)::date;
  select a.free_resources into v_free
  from app.available_starts(p_tenant, p_service, v_day, v_day, p_exclude_booking, p_enforce_policy) a
  where a.start_at = p_start;
  return v_free;
end;
$$;
