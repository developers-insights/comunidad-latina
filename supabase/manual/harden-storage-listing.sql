-- =============================================================================
-- MANUAL — harden-storage-listing.sql
-- Aplicar DESDE EL DASHBOARD DE SUPABASE (SQL Editor), NO por `npm run db:migrate`.
--
-- POR QUÉ ES MANUAL: `storage.objects` pertenece al rol `supabase_storage_admin`.
-- El rol `postgres` (que usan tanto el MCP de Supabase como la conexión directa
-- de scripts/apply-migrations.mjs) NO es dueño ni miembro de ese rol en este
-- proyecto, así que `create/drop policy on storage.objects` falla con
-- "must be owner of relation objects". El SQL Editor del Dashboard sí corre con
-- privilegio suficiente. (Alternativa 100% UI: Storage → Policies.)
--
-- QUÉ ARREGLA (advisor 0025 public_bucket_allows_listing + minimización §5.4):
-- Los buckets públicos avatars/listing-photos/tenant-assets tenían un SELECT
-- amplio `using(bucket_id = 'X')` para anon+authenticated. En un bucket público
-- eso NO se necesita para servir el objeto por URL —
--   {SUPABASE_URL}/storage/v1/object/public/{bucket}/{path}
-- bypassa RLS (bucket.public = true). Lo único que habilitaba era `list()` /
-- enumeración. Y el path de avatars es `{tenant_id}/{user_id}/...`, así que
-- cualquiera podía LISTAR el bucket y extraer el set completo de user_ids de un
-- tenant → exactamente el vector de enumeración de población que el anti-honeypot
-- §5.4 prohíbe.
--
-- FIX: el SELECT (list) se scopea al DUEÑO del objeto (owner_id, que Storage
-- setea en el INSERT). El acceso público por URL queda intacto; el app arma esas
-- URLs con /object/public (src/components/listings/helpers.ts) y no usa `.list()`.
-- El service_role (server) bypassa RLS igual. Sigue habiendo 1 policy de SELECT
-- por bucket → el enumerador RLS se mantiene verde.
--
-- SEGURIDAD: aplicar en el mismo pase que el pentest humano / firma senior
-- (§14.4), antes del primer dato real. Hoy los buckets están vacíos → riesgo 0.
-- =============================================================================

drop policy if exists avatars_select on storage.objects;
create policy avatars_select on storage.objects
for select to authenticated
using (
  bucket_id = 'avatars'
  and owner_id = (select auth.uid())::text
);

drop policy if exists listing_photos_select on storage.objects;
create policy listing_photos_select on storage.objects
for select to authenticated
using (
  bucket_id = 'listing-photos'
  and owner_id = (select auth.uid())::text
);

drop policy if exists tenant_assets_select on storage.objects;
create policy tenant_assets_select on storage.objects
for select to authenticated
using (
  bucket_id = 'tenant-assets'
  and owner_id = (select auth.uid())::text
);
