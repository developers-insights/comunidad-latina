-- =============================================================================
-- 0025_post_media_storage.sql — Comunidad Latina
-- Bucket post-media: fotos de posts del feed (foto obligatoria, 0023).
-- Path canónico: {tenant_id}/{user_id}/{archivo}.webp — espejo de avatars 0012.
-- Cierra el desvío documentado en feed/actions.ts (posts subían a
-- listing-photos vía admin client porque su policy exigía un listing propio).
--
-- AISLADA a propósito: si el rol de migraciones no puede tocar storage.objects
-- en este proyecto (precedente: supabase/manual/harden-storage-listing.sql),
-- esta migración se corre a mano desde el SQL Editor del Dashboard y el resto
-- del release no se bloquea.
-- =============================================================================

insert into storage.buckets (id, name, public)
values ('post-media', 'post-media', true)
on conflict (id) do update set public = true;

create policy post_media_select on storage.objects
for select to anon, authenticated
using (bucket_id = 'post-media');

create policy post_media_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'post-media'
  and (storage.foldername(name))[1] = (select app.current_tenant_id())::text
  and (storage.foldername(name))[2] = (select auth.uid())::text
);

create policy post_media_update on storage.objects
for update to authenticated
using (
  bucket_id = 'post-media'
  and (storage.foldername(name))[1] = (select app.current_tenant_id())::text
  and (storage.foldername(name))[2] = (select auth.uid())::text
)
with check (
  bucket_id = 'post-media'
  and (storage.foldername(name))[1] = (select app.current_tenant_id())::text
  and (storage.foldername(name))[2] = (select auth.uid())::text
);

create policy post_media_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'post-media'
  and (storage.foldername(name))[1] = (select app.current_tenant_id())::text
  and (storage.foldername(name))[2] = (select auth.uid())::text
);
