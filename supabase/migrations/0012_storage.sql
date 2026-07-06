-- =============================================================================
-- 0012_storage.sql — Comunidad Latina
-- Buckets: avatars, listing-photos, tenant-assets (lectura pública).
-- Aislamiento fuera de Postgres (§5.2.2): TODA escritura exige que el primer
-- segmento del path sea el tenant_id del JWT. En avatars, el segundo segmento
-- es el auth.uid() del dueño. Path canónico:
--   avatars:         {tenant_id}/{user_id}/avatar.webp
--   listing-photos:  {tenant_id}/{listing_id}/{archivo}.webp
--   tenant-assets:   {tenant_id}/{logo|og|...}.webp
-- =============================================================================

insert into storage.buckets (id, name, public)
values
  ('avatars', 'avatars', true),
  ('listing-photos', 'listing-photos', true),
  ('tenant-assets', 'tenant-assets', true)
on conflict (id) do update set public = true;

-- ---------------------------------------------------------------------------
-- avatars — {tenant_id}/{user_id}/...
-- ---------------------------------------------------------------------------
create policy avatars_select on storage.objects
for select to anon, authenticated
using (bucket_id = 'avatars');

create policy avatars_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select app.current_tenant_id())::text
  and (storage.foldername(name))[2] = (select auth.uid())::text
);

create policy avatars_update on storage.objects
for update to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select app.current_tenant_id())::text
  and (storage.foldername(name))[2] = (select auth.uid())::text
)
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select app.current_tenant_id())::text
  and (storage.foldername(name))[2] = (select auth.uid())::text
);

create policy avatars_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select app.current_tenant_id())::text
  and (storage.foldername(name))[2] = (select auth.uid())::text
);

-- ---------------------------------------------------------------------------
-- listing-photos — {tenant_id}/{listing_id}/... ; sube SOLO el dueño del
-- listing (segmento 2 = listing propio del mismo tenant); borra/edita solo
-- quien subió (owner_id).
-- ---------------------------------------------------------------------------
create policy listing_photos_select on storage.objects
for select to anon, authenticated
using (bucket_id = 'listing-photos');

-- INSERT: tenant del JWT en el segmento 1 Y el listing del segmento 2 debe
-- existir, ser del mismo tenant y pertenecer al que sube. Sin esto, cualquier
-- miembro del tenant podría hostear contenido arbitrario bajo el namespace
-- público de listings ajenos. (Si el segmento 2 no es un uuid válido, el cast
-- lanza error y la subida se rechaza igual: el path canónico es obligatorio.)
create policy listing_photos_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'listing-photos'
  and (storage.foldername(name))[1] = (select app.current_tenant_id())::text
  and exists (
    select 1 from public.listings l
    where l.id = ((storage.foldername(name))[2])::uuid
      and l.tenant_id = (select app.current_tenant_id())
      and l.created_by = (select auth.uid())
  )
);

create policy listing_photos_update on storage.objects
for update to authenticated
using (
  bucket_id = 'listing-photos'
  and (storage.foldername(name))[1] = (select app.current_tenant_id())::text
  and owner_id = (select auth.uid())::text
)
with check (
  bucket_id = 'listing-photos'
  and (storage.foldername(name))[1] = (select app.current_tenant_id())::text
  and owner_id = (select auth.uid())::text
);

create policy listing_photos_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'listing-photos'
  and (storage.foldername(name))[1] = (select app.current_tenant_id())::text
  and owner_id = (select auth.uid())::text
);

-- ---------------------------------------------------------------------------
-- tenant-assets — {tenant_id}/... ; escribe solo domain_admin de ESE tenant
-- ---------------------------------------------------------------------------
create policy tenant_assets_select on storage.objects
for select to anon, authenticated
using (bucket_id = 'tenant-assets');

create policy tenant_assets_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'tenant-assets'
  and (storage.foldername(name))[1] = (select app.current_tenant_id())::text
  and (select app.current_user_role()) in ('domain_admin', 'global_admin')
);

create policy tenant_assets_update on storage.objects
for update to authenticated
using (
  bucket_id = 'tenant-assets'
  and (storage.foldername(name))[1] = (select app.current_tenant_id())::text
  and (select app.current_user_role()) in ('domain_admin', 'global_admin')
)
with check (
  bucket_id = 'tenant-assets'
  and (storage.foldername(name))[1] = (select app.current_tenant_id())::text
  and (select app.current_user_role()) in ('domain_admin', 'global_admin')
);

create policy tenant_assets_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'tenant-assets'
  and (storage.foldername(name))[1] = (select app.current_tenant_id())::text
  and (select app.current_user_role()) in ('domain_admin', 'global_admin')
);
