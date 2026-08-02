-- 0056 — Aislamiento: listado de buckets, definers abiertos a anon,
--        columna cruda de verificación e índices que faltan bajo las policies.
--
-- Contexto de la auditoría que la origina:
--   * Las 65 tablas de `public` ya tienen RLS ENABLE + FORCE y 4 policies
--     (select/insert/update/delete). Eso NO se toca acá.
--   * Todas las funciones SECURITY DEFINER ya tienen `search_path` fijo y
--     revalidan tenant + rol adentro. Tampoco se tocan sus cuerpos.
--   * Lo que quedaba abierto es lo de abajo.
--
-- Lo que esta migración NO hace, a propósito (queda reportado, no aplicado):
--   * `listings/posts/comments/listing_comments/guides`: el contenido
--     `published` se ve entre tenants. Está documentado como decisión de SEO
--     en 0004 y en `src/lib/tenant/guard.ts`. Cerrarlo dejaría el sitio
--     público en blanco para anon, porque `app.current_tenant_id()` es NULL
--     sin sesión y la app no empuja el tenant a la sesión de Postgres.
--   * `profiles_select using(true)`: expone `role`, `account_status` y
--     `suspended_until` a anon. El REVOKE por columna es la respuesta, pero
--     `perfil/[id]/page.tsx` hace `select("*")` y reventaría con 42501.
--     Primero la app tiene que listar columnas explícitas.

begin;

-- ---------------------------------------------------------------------------
-- 1. Storage: un bucket público no necesita que se pueda LISTAR entero
-- ---------------------------------------------------------------------------
-- Las 4 policies decían `using (bucket_id = 'x')`: cualquiera, incluso sin
-- sesión, podía enumerar TODOS los archivos de TODOS los tenants — incluidas
-- las fotos de avisos en borrador, cuya fila sí está tapada por RLS.
--
-- Sacarlas no rompe ninguna imagen: la app siempre arma las URLs contra
-- `/storage/v1/object/public/...` (ver `src/components/**/helpers.ts` y
-- `next.config.ts`), y ese endpoint no consulta RLS. El único `.list()` del
-- código (`src/app/(app)/perfil/actions.ts`) usa el cliente admin.
--
-- Se conserva SELECT para el usuario con sesión dentro de la carpeta de su
-- propio tenant: es lo que necesita el upsert de Storage (INSERT+SELECT+UPDATE)
-- al reemplazar un avatar o una foto ya subida.

drop policy if exists avatars_select on storage.objects;
create policy avatars_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select app.current_tenant_id())::text
  );

drop policy if exists listing_photos_select on storage.objects;
create policy listing_photos_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'listing-photos'
    and (storage.foldername(name))[1] = (select app.current_tenant_id())::text
  );

drop policy if exists post_media_select on storage.objects;
create policy post_media_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'post-media'
    and (storage.foldername(name))[1] = (select app.current_tenant_id())::text
  );

drop policy if exists tenant_assets_select on storage.objects;
create policy tenant_assets_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'tenant-assets'
    and (storage.foldername(name))[1] = (select app.current_tenant_id())::text
  );

-- `job-cvs` no se toca: el bucket ya es privado, la policy es `to authenticated`
-- y limita al dueño del CV o al empleador dueño del aviso. Es la correcta.

-- ---------------------------------------------------------------------------
-- 2. SECURITY DEFINER: sacarle a `anon` lo que ya le niega el cuerpo
-- ---------------------------------------------------------------------------
-- Postgres le da EXECUTE a PUBLIC por defecto, así que estas cuatro quedaron
-- publicadas en /rest/v1/rpc/ para gente sin sesión. Las cuatro arrancan con
-- `if auth.uid() is null ... raise NOT_AUTHENTICATED`, o sea que hoy no son
-- explotables — pero el gate está una capa más adentro de lo que debería, y
-- cada una es un endpoint anónimo que no tiene por qué existir.
--
-- Se revoca sólo a `anon`. `authenticated` las sigue necesitando: dos son de
-- dueño (CTAs del aviso, compartir perfil en una postulación) y dos exigen
-- domain_admin adentro, rol que en Postgres viaja igual como `authenticated`.

revoke execute on function public.save_listing_ctas(uuid, text, text, text, text, text, text, text) from anon;
revoke execute on function public.set_application_share_profile(uuid, boolean) from anon;
revoke execute on function public.listing_reach(uuid) from anon;
revoke execute on function public.job_application_tally(uuid[]) from anon;

-- `get_tenant_by_domain`, `record_cta_click` y `record_listing_share` sí se
-- dejan abiertas a anon: la primera la usa el middleware para resolver el
-- dominio antes de que exista sesión, y las otras dos registran telemetría de
-- las fichas públicas, que las ve gente sin cuenta.

-- ---------------------------------------------------------------------------
-- 3. verification_checks.evidence: el crudo del registro no es público
-- ---------------------------------------------------------------------------
-- `verification_checks_select` es `using (true)` para anon, y eso es
-- deliberado: el número de matrícula y el link al registro son la prueba
-- pública del escudo. Pero `evidence` (jsonb) guarda la respuesta cruda del
-- organismo, que puede traer datos personales que nadie pidió publicar.
--
-- Ningún archivo de `src/` lo lee: los 7 llamadores piden columnas explícitas
-- (`result, registry, registry_url, license_number, checked_at, subject_id`).
-- Por eso el REVOKE por columna es seguro acá y no lo es en `profiles`.

revoke select (evidence) on public.verification_checks from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Índices bajo las expresiones de las policies
-- ---------------------------------------------------------------------------
-- Cada columna de acá aparece dentro del `using`/`with check` de al menos una
-- policy y no tenía índice que la cubriera como primera columna: RLS la
-- evaluaba fila por fila. Con dos tenants y 58 avisos no se nota; con volumen
-- real, cada SELECT del feed es un seq scan por cada policy que se evalúa.
--
-- Son las mismas columnas que el advisor `unindexed_foreign_keys` viene
-- marcando, así que el índice sirve doble: la policy y el chequeo de la FK.
-- Sin CONCURRENTLY a propósito: las tablas son chicas y esto corre dentro de
-- la transacción de la migración.

create index if not exists account_restrictions_profile_idx    on public.account_restrictions (profile_id);
create index if not exists appeals_profile_idx                 on public.appeals (profile_id);
create index if not exists boosts_buyer_idx                    on public.boosts (buyer_id);
create index if not exists broadcasts_created_by_idx           on public.broadcasts (created_by);
create index if not exists business_accounts_owner_idx         on public.business_accounts (owner_id);
create index if not exists business_audit_log_business_idx     on public.business_audit_log (business_id);
create index if not exists business_members_profile_idx        on public.business_members (profile_id);
create index if not exists business_verifications_tenant_idx   on public.business_verifications (tenant_id);
create index if not exists campaigns_created_by_idx            on public.campaigns (created_by);
create index if not exists comments_author_idx                 on public.comments (author_id);
create index if not exists conversations_counterpart_idx       on public.conversations (counterpart_id);
create index if not exists conversations_created_by_idx        on public.conversations (created_by);
create index if not exists creator_portfolio_items_creator_idx on public.creator_portfolio_items (creator_id);
create index if not exists cta_clicks_tenant_idx               on public.cta_clicks (tenant_id);
create index if not exists gig_applications_creator_idx        on public.gig_applications (creator_id);
create index if not exists gig_contracts_client_idx            on public.gig_contracts (client_id);
create index if not exists gig_contracts_creator_idx           on public.gig_contracts (creator_id);
create index if not exists gig_reviews_ratee_idx               on public.gig_reviews (ratee_id);
create index if not exists gig_reviews_reviewer_idx            on public.gig_reviews (reviewer_id);
create index if not exists job_application_notes_author_idx    on public.job_application_notes (author_id);
create index if not exists job_application_notes_tenant_idx    on public.job_application_notes (tenant_id);
create index if not exists job_applications_applicant_idx      on public.job_applications (applicant_id);
create index if not exists job_deliverables_contract_idx       on public.job_deliverables (contract_id);
create index if not exists job_deliverables_submitted_by_idx   on public.job_deliverables (submitted_by);
create index if not exists job_revisions_contract_idx          on public.job_revisions (contract_id);
create index if not exists job_revisions_requested_by_idx      on public.job_revisions (requested_by);
create index if not exists listing_comments_author_fk_idx      on public.listing_comments (author_id);
create index if not exists listing_premiums_owner_idx          on public.listing_premiums (owner_id);
create index if not exists listing_private_details_tenant_idx  on public.listing_private_details (tenant_id);
create index if not exists listing_shares_tenant_idx           on public.listing_shares (tenant_id);
create index if not exists listing_views_viewer_idx            on public.listing_views (viewer_id);
create index if not exists listings_created_by_idx             on public.listings (created_by);
create index if not exists messages_sender_idx                 on public.messages (sender_id);
create index if not exists moderation_queue_resolved_by_idx    on public.moderation_queue (resolved_by);
create index if not exists notification_prefs_tenant_idx       on public.notification_prefs (tenant_id);
create index if not exists notifications_profile_fk_idx        on public.notifications (profile_id);
create index if not exists payment_accounts_connected_idx      on public.payment_accounts (connected_account_id);
create index if not exists post_promotions_buyer_idx           on public.post_promotions (buyer_id);
create index if not exists post_views_viewer_idx               on public.post_views (viewer_id);
create index if not exists posts_author_idx                    on public.posts (author_id);
create index if not exists posts_entity_listing_idx            on public.posts (entity_listing_id);
create index if not exists profiles_private_tenant_idx         on public.profiles_private (tenant_id);
create index if not exists reactions_profile_idx               on public.reactions (profile_id);
create index if not exists scam_reports_reporter_idx           on public.scam_reports (reporter_id);
create index if not exists store_memberships_owner_idx         on public.store_memberships (owner_id);
create index if not exists user_blocks_tenant_idx              on public.user_blocks (tenant_id);
create index if not exists user_phones_tenant_idx              on public.user_phones (tenant_id);

commit;
