-- Row level security and strict privileges.
-- * anon: no table access at all; only EXECUTE on public_* functions.
-- * authenticated: SELECT on tenant data, filtered by RLS to tenants the user
--   is a member of; mutations only through owner_* functions. Never sees
--   token hashes, the idempotency ledger, push endpoints or the outbox.
-- * service_role: pipeline + notification worker.
-- PostgreSQL grants EXECUTE on new functions to PUBLIC by default; that is
-- revoked here and for every future function in the schema.

revoke all on all tables in schema app from public, anon, authenticated;
revoke all on all sequences in schema app from public, anon, authenticated;
revoke all on all functions in schema app from public, anon, authenticated;
alter default privileges in schema app revoke all on tables from public, anon, authenticated;
alter default privileges in schema app revoke all on sequences from public, anon, authenticated;
alter default privileges in schema app revoke execute on functions from public, anon, authenticated;

grant usage on schema app to anon, authenticated, service_role;
grant all on all tables in schema app to service_role;
grant all on all sequences in schema app to service_role;
grant execute on all functions in schema app to service_role;

-- Enable RLS everywhere (tables without policies deny everyone but the owner
-- role and service_role).
do $$
declare
  r record;
begin
  for r in select tablename from pg_tables where schemaname = 'app' loop
    execute format('alter table app.%I enable row level security', r.tablename);
  end loop;
end
$$;

-- Tables an owner may read (through RLS).
grant select on
  app.tenants, app.tenant_members, app.resources, app.services, app.service_price_history,
  app.working_hours, app.schedule_exceptions, app.customers, app.bookings,
  app.resource_occupancies, app.booking_events, app.payments, app.media
to authenticated;

create policy members_read_own on app.tenant_members
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy tenants_member_read on app.tenants
  for select to authenticated
  using (id in (select m.tenant_id from app.tenant_members m where m.user_id = (select auth.uid())));

do $$
declare
  t text;
begin
  foreach t in array array[
    'resources', 'services', 'service_price_history', 'working_hours', 'schedule_exceptions',
    'customers', 'bookings', 'resource_occupancies', 'booking_events', 'payments', 'media']
  loop
    execute format(
      'create policy %I on app.%I for select to authenticated
         using (tenant_id in (select m.tenant_id from app.tenant_members m where m.user_id = (select auth.uid())))',
      t || '_member_read', t);
  end loop;
end
$$;

-- Public API (anon and authenticated alike).
grant execute on function
  app.public_tenant(text),
  app.tenant_id_for_public(text),
  app.public_availability(text, uuid, date, date),
  app.public_create_booking(text, uuid, timestamptz, text, text, text, text, text, uuid, bytea),
  app.public_get_booking(text, bytea),
  app.public_booking_availability(text, bytea, date, date),
  app.public_reschedule_booking(text, bytea, timestamptz, uuid),
  app.public_cancel_booking(text, bytea, text),
  app.public_save_push_subscription(text, bytea, text, text, text, text),
  app.public_delete_push_subscription(text, bytea, text)
to anon, authenticated;

-- Owner API.
grant execute on function
  app.owner_context(),
  app.owner_tenant(uuid),
  app.owner_schedule(uuid, date, date, boolean),
  app.owner_booking(uuid, uuid),
  app.owner_find_bookings(uuid, text, integer),
  app.owner_availability(uuid, uuid, date, date, uuid),
  app.owner_create_booking(uuid, uuid, timestamptz, text, text, text, text, text, uuid, uuid),
  app.owner_reschedule_booking(uuid, uuid, timestamptz, uuid),
  app.owner_cancel_booking(uuid, uuid, text),
  app.owner_set_booking_status(uuid, uuid, text, numeric),
  app.owner_record_payment(uuid, uuid, numeric, text, timestamptz, text, uuid),
  app.owner_block_resource(uuid, uuid, timestamptz, timestamptz, text),
  app.owner_unblock_resource(uuid, uuid),
  app.owner_set_paused(uuid, text, uuid, boolean),
  app.owner_set_exception(uuid, date, jsonb, text),
  app.owner_delete_exception(uuid, date),
  app.owner_add_media(uuid, text, text, integer, integer),
  app.owner_delete_media(uuid, uuid),
  app.owner_save_push_subscription(uuid, text, text, text, text),
  app.owner_delete_push_subscription(uuid, text),
  app.owner_push_status(uuid),
  app.owner_stats(uuid, date, date)
to authenticated;

-- Helpers the SECURITY INVOKER owner functions and RLS policies call.
grant execute on function
  app.is_member(uuid),
  app.assert_member(uuid),
  app.local_period(uuid, date, date),
  app.tenant_setting_int(jsonb, text, integer)
to authenticated;
