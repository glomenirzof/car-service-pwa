-- Core multi-tenant schema.
-- Every tenant-dependent table carries tenant_id and references its parents
-- through composite (tenant_id, id) foreign keys, so a row can never point at
-- another tenant's service/resource/booking even if an id is guessed.
-- Tables live in the private "app" schema (not exposed through the Data API);
-- access goes through Edge Functions calling the SQL functions defined later.

create extension if not exists btree_gist with schema extensions;
create extension if not exists pgcrypto with schema extensions;

create schema if not exists app;
revoke all on schema app from public;

-- ---------------------------------------------------------------------------
-- Tenants and membership
-- ---------------------------------------------------------------------------

create table app.tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])$'),
  status text not null default 'preview' check (status in ('preview', 'live', 'suspended')),
  name text not null check (length(name) between 2 and 60),
  short_name text not null,
  timezone text not null,
  currency text not null default 'RUB',
  locale text not null default 'ru-RU',
  -- Public part of business.json (texts, contacts, brand, booking policy).
  profile jsonb not null default '{}'::jsonb,
  config_hash text,
  config_version integer not null default 0,
  published_at timestamptz,
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function app.is_valid_timezone(p_tz text) returns boolean
language plpgsql immutable
set search_path = ''
as $$
begin
  perform now() at time zone p_tz;
  return exists (select 1 from pg_catalog.pg_timezone_names where name = p_tz);
exception when others then
  return false;
end;
$$;

alter table app.tenants add constraint tenants_timezone_valid check (app.is_valid_timezone(timezone));

create table app.tenant_members (
  tenant_id uuid not null references app.tenants (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'staff')),
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);
create index tenant_members_user_idx on app.tenant_members (user_id);

-- ---------------------------------------------------------------------------
-- Catalog: resources (posts/boxes/lifts), services, price history
-- ---------------------------------------------------------------------------

create table app.resources (
  id uuid not null default gen_random_uuid() primary key,
  tenant_id uuid not null references app.tenants (id) on delete cascade,
  key text not null check (key ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  name text not null,
  kind text not null default 'box',
  description text,
  capabilities text[] not null check (cardinality(capabilities) > 0),
  sort_order integer not null default 0,
  is_active boolean not null default true,   -- controlled by business.json
  is_paused boolean not null default false,  -- controlled by the owner, survives republish
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, key)
);

create table app.services (
  id uuid not null default gen_random_uuid() primary key,
  tenant_id uuid not null references app.tenants (id) on delete cascade,
  key text not null check (key ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  name text not null,
  category text not null,
  description text not null default '',
  duration_minutes integer not null check (duration_minutes between 10 and 20160),
  buffer_minutes integer not null default 0 check (buffer_minutes between 0 and 1440),
  completion text not null default 'same_day' check (completion in ('same_day', 'multi_day')),
  capability text not null,
  price_amount numeric(12, 2) not null check (price_amount >= 0),
  price_is_from boolean not null default false,
  image_path text,
  popular boolean not null default false,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  is_paused boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, key)
);

create table app.service_price_history (
  id bigint generated always as identity primary key,
  tenant_id uuid not null,
  service_id uuid not null,
  price_amount numeric(12, 2) not null,
  price_is_from boolean not null,
  duration_minutes integer not null,
  buffer_minutes integer not null,
  valid_from timestamptz not null default now(),
  source text not null check (source in ('publish', 'owner')),
  foreign key (tenant_id, service_id) references app.services (tenant_id, id) on delete cascade
);
create index service_price_history_service_idx on app.service_price_history (tenant_id, service_id, valid_from desc);

-- ---------------------------------------------------------------------------
-- Schedule: weekly working hours define reception moments; exceptions override
-- a whole date (a row with NULL times = closed).
-- ---------------------------------------------------------------------------

create table app.working_hours (
  tenant_id uuid not null references app.tenants (id) on delete cascade,
  weekday smallint not null check (weekday between 1 and 7), -- ISO: 1 = Monday
  opens time not null,
  closes time not null,
  check (opens < closes),
  primary key (tenant_id, weekday, opens)
);

create table app.schedule_exceptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants (id) on delete cascade,
  on_date date not null,
  opens time,
  closes time,
  note text,
  source text not null check (source in ('config', 'owner')),
  created_at timestamptz not null default now(),
  check ((opens is null) = (closes is null)),
  check (opens is null or opens < closes)
);
create index schedule_exceptions_date_idx on app.schedule_exceptions (tenant_id, on_date);

-- ---------------------------------------------------------------------------
-- Customers and bookings (personal data)
-- ---------------------------------------------------------------------------

create table app.customers (
  id uuid not null default gen_random_uuid() primary key,
  tenant_id uuid not null references app.tenants (id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  phone text not null check (phone ~ '^\+\d{10,15}$'),
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, phone)
);

create table app.bookings (
  id uuid not null default gen_random_uuid() primary key,
  tenant_id uuid not null references app.tenants (id) on delete cascade,
  service_id uuid not null,
  resource_id uuid not null,
  customer_id uuid not null,
  customer_name text not null check (length(customer_name) between 1 and 80),
  status text not null default 'scheduled'
    check (status in ('scheduled', 'arrived', 'completed', 'cancelled', 'no_show')),
  start_at timestamptz not null,
  end_at timestamptz not null,           -- end of work (without buffer)
  occupied_until timestamptz not null,   -- end of work + buffer
  -- Snapshot taken by the server at booking time: later price or duration
  -- changes never rewrite an existing booking.
  service_name text not null,
  duration_minutes integer not null,
  buffer_minutes integer not null,
  price_amount numeric(12, 2) not null,
  price_is_from boolean not null default false,
  currency text not null,
  final_amount numeric(12, 2) check (final_amount is null or final_amount >= 0),
  car text,
  car_plate text,
  comment text check (comment is null or length(comment) <= 500),
  source text not null default 'client' check (source in ('client', 'owner', 'demo')),
  is_demo boolean not null default false,
  reschedule_count integer not null default 0,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  arrived_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by text check (cancelled_by is null or cancelled_by in ('client', 'owner', 'system')),
  cancel_reason text,
  check (end_at > start_at),
  check (occupied_until >= end_at),
  unique (tenant_id, id),
  foreign key (tenant_id, service_id) references app.services (tenant_id, id),
  foreign key (tenant_id, resource_id) references app.resources (tenant_id, id),
  foreign key (tenant_id, customer_id) references app.customers (tenant_id, id)
);
create index bookings_start_idx on app.bookings (tenant_id, start_at);
create index bookings_customer_idx on app.bookings (tenant_id, customer_id);
create index bookings_completed_idx on app.bookings (tenant_id, completed_at) where completed_at is not null;
create index bookings_arrived_idx on app.bookings (tenant_id, arrived_at) where arrived_at is not null;

-- One table for everything that occupies a resource: bookings AND owner blocks.
-- The exclusion constraint is the single source of truth against double booking.
create table app.resource_occupancies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  resource_id uuid not null,
  kind text not null check (kind in ('booking', 'block')),
  booking_id uuid,
  during tstzrange not null,
  note text,
  created_by uuid,
  created_at timestamptz not null default now(),
  check ((kind = 'booking') = (booking_id is not null)),
  check (not isempty(during) and lower_inc(during) and not upper_inc(during)
         and lower(during) is not null and upper(during) is not null),
  foreign key (tenant_id, resource_id) references app.resources (tenant_id, id),
  foreign key (tenant_id, booking_id) references app.bookings (tenant_id, id) on delete cascade,
  constraint resource_occupancies_no_overlap
    exclude using gist (
      tenant_id extensions.gist_uuid_ops with =,
      resource_id extensions.gist_uuid_ops with =,
      during with &&)
);
create unique index resource_occupancies_booking_uidx on app.resource_occupancies (booking_id) where booking_id is not null;
create index resource_occupancies_during_idx on app.resource_occupancies
  using gist (tenant_id extensions.gist_uuid_ops, during);

-- Client access to a single booking: only the SHA-256 of the bearer token is stored.
create table app.booking_access (
  booking_id uuid primary key,
  tenant_id uuid not null,
  token_hash bytea not null unique check (octet_length(token_hash) = 32),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  foreign key (tenant_id, booking_id) references app.bookings (tenant_id, id) on delete cascade
);

-- Idempotency ledger for create / reschedule / cancel / payment requests.
create table app.request_ledger (
  tenant_id uuid not null references app.tenants (id) on delete cascade,
  operation text not null,
  idempotency_key uuid not null,
  request_hash text not null,
  booking_id uuid,
  response jsonb,
  created_at timestamptz not null default now(),
  primary key (tenant_id, operation, idempotency_key)
);
create index request_ledger_created_idx on app.request_ledger (created_at);

create table app.booking_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null,
  booking_id uuid not null,
  kind text not null,
  actor text not null check (actor in ('client', 'owner', 'system')),
  actor_user_id uuid,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, booking_id) references app.bookings (tenant_id, id) on delete cascade
);
create index booking_events_booking_idx on app.booking_events (tenant_id, booking_id, id);

-- Money actually received. Separate from booking price and from completed orders.
create table app.payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  booking_id uuid not null,
  amount numeric(12, 2) not null check (amount > 0),
  method text not null check (method in ('cash', 'card', 'transfer', 'other')),
  received_at timestamptz not null default now(),
  note text,
  recorded_by uuid,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, booking_id) references app.bookings (tenant_id, id) on delete cascade
);
create index payments_received_idx on app.payments (tenant_id, received_at);
create index payments_booking_idx on app.payments (tenant_id, booking_id);

-- ---------------------------------------------------------------------------
-- Media: pipeline images (static, source = config) and owner uploads
-- (Supabase Storage, source = owner). Republishing replaces only config rows.
-- ---------------------------------------------------------------------------

create table app.media (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants (id) on delete cascade,
  source text not null check (source in ('config', 'owner')),
  kind text not null check (kind in ('hero', 'gallery')),
  path text not null,
  alt text not null default '',
  width integer,
  height integer,
  sort_order integer not null default 0,
  uploaded_by uuid,
  created_at timestamptz not null default now(),
  check (source <> 'owner' or path ~ '^tenants/[0-9a-f-]{36}/owner/')
);
create index media_tenant_idx on app.media (tenant_id, kind, sort_order);

-- ---------------------------------------------------------------------------
-- Web Push subscriptions and the notification outbox
-- ---------------------------------------------------------------------------

create table app.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants (id) on delete cascade,
  audience text not null check (audience in ('client', 'owner')),
  booking_id uuid,
  user_id uuid references auth.users (id) on delete cascade,
  endpoint text not null check (endpoint ~ '^https://'),
  p256dh text not null,
  auth_secret text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_success_at timestamptz,
  failure_count integer not null default 0,
  check ((audience = 'client' and booking_id is not null and user_id is null)
      or (audience = 'owner' and user_id is not null and booking_id is null)),
  foreign key (tenant_id, booking_id) references app.bookings (tenant_id, id) on delete cascade
);
create unique index push_subscriptions_client_uidx on app.push_subscriptions (tenant_id, booking_id, endpoint) where audience = 'client';
create unique index push_subscriptions_owner_uidx on app.push_subscriptions (tenant_id, user_id, endpoint) where audience = 'owner';
create index push_subscriptions_endpoint_idx on app.push_subscriptions (endpoint);

create table app.notification_jobs (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references app.tenants (id) on delete cascade,
  booking_id uuid,
  audience text not null check (audience in ('client', 'owner')),
  kind text not null check (kind in (
    'owner_new_booking', 'owner_booking_rescheduled', 'owner_booking_cancelled',
    'client_reminder', 'client_booking_rescheduled', 'client_booking_cancelled')),
  dedupe_key text not null,
  due_at timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'sent', 'failed', 'cancelled', 'suppressed', 'skipped')),
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  lease_until timestamptz,
  leased_by text,
  last_error text,
  -- Booking facts the job was created for; the worker re-checks them before sending.
  expected_start_at timestamptz,
  expected_version integer,
  data jsonb not null default '{}'::jsonb,
  sent_count integer not null default 0,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (tenant_id, dedupe_key),
  foreign key (tenant_id, booking_id) references app.bookings (tenant_id, id) on delete cascade
);
create index notification_jobs_due_idx on app.notification_jobs (due_at) where status = 'pending';
create index notification_jobs_lease_idx on app.notification_jobs (lease_until) where status = 'processing';
create index notification_jobs_booking_idx on app.notification_jobs (tenant_id, booking_id);

-- ---------------------------------------------------------------------------
-- Shared atomic counters: public rate limits and the LLM budget.
-- ---------------------------------------------------------------------------

create table app.usage_counters (
  bucket text not null,
  window_start timestamptz not null,
  count bigint not null default 0,
  primary key (bucket, window_start)
);
create index usage_counters_window_idx on app.usage_counters (window_start);

-- updated_at maintenance
create or replace function app.touch_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger tenants_touch before update on app.tenants for each row execute function app.touch_updated_at();
create trigger resources_touch before update on app.resources for each row execute function app.touch_updated_at();
create trigger services_touch before update on app.services for each row execute function app.touch_updated_at();
create trigger customers_touch before update on app.customers for each row execute function app.touch_updated_at();
create trigger bookings_touch before update on app.bookings for each row execute function app.touch_updated_at();
