-- Public bucket for owner-uploaded photos. Uploads happen only through signed
-- upload URLs minted by the owner-api function after a membership check, so
-- no INSERT policy for anon/authenticated is needed on storage.objects.
-- Guarded: plain PostgreSQL test databases have no storage schema.
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('tenant-media', 'tenant-media', true, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do update
      set public = true,
          file_size_limit = excluded.file_size_limit,
          allowed_mime_types = excluded.allowed_mime_types;
  else
    raise notice 'storage schema not present: skipping bucket creation';
  end if;
end
$$;
