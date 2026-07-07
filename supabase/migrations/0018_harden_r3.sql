-- =============================================================================
-- 0018_harden_r3.sql — Comunidad Latina
-- Endurecimiento post-fiscalía R3 (corrector): delta sobre 0016_boosts (YA
-- aplicada — forward-only, no se edita). Los otros dos findings de DB de la
-- fiscalía (match_chunks con EXECUTE a anon, comment sobreprometedor de
-- question_hash) se corrigieron EN ORIGEN en 0017_rag_assistant.sql, que aún
-- no estaba aplicada.
--
-- boosts — privilegios por COLUMNA para anon/authenticated.
-- La rama pública de boosts_select (status='active', transparencia FTC)
-- exponía la FILA COMPLETA vía PostgREST y cross-tenant: buyer_id (quién
-- pagó), amount_cents (cuánto) y stripe_checkout_session_id — dato de pago
-- vinculable a un perfil, justo lo que el anti-honeypot §5.4 dice no exponer.
-- La transparencia FTC solo requiere QUÉ listing está destacado y hasta
-- cuándo → esas columnas quedan legibles; las de pago/comprador quedan solo
-- para service_role.
--
-- ¿Por qué column-level GRANT y no una vista/policy más estricta?
--   * Una vista security definer suma un advisor ERROR de Supabase y otra
--     superficie; scoping por tenant en la policy (app.current_tenant_id())
--     rompería la vista pública para visitantes anónimos (sin tenant en JWT).
--   * Las 4 policies canónicas de 0016 quedan INTACTAS (contrato del
--     enumerador); las expresiones de policy pueden seguir referenciando
--     buyer_id aunque el rol no pueda seleccionarlo (los checks de columna
--     no aplican a las expresiones de RLS).
--   * Nota operativa: `select *` sobre boosts por PostgREST ahora devuelve
--     permission denied para anon/authenticated — las queries de la app ya
--     piden columnas explícitas (listing_id / ends_at); el webhook y las
--     server actions usan service_role (grants completos).
-- =============================================================================

revoke select on table public.boosts from anon, authenticated;
grant select (id, tenant_id, listing_id, package, duration_days, status, starts_at, ends_at, created_at)
  on table public.boosts to anon, authenticated;

comment on table public.boosts is
  'Impulso one-time de un listing (§7). status/starts_at/ends_at los escribe SOLO el webhook Stripe (service_role). La UI marca el resultado como "Destacado · Publicidad" (FTC). Pagar no altera Trust Score ni verificación. Desde 0018: anon/authenticated solo pueden SELECT columnas de transparencia (qué listing, qué paquete, hasta cuándo) — buyer_id/amount_cents/currency/stripe_checkout_session_id son solo-service_role (anti-honeypot §5.4: datos de pago vinculables a un perfil no viajan por PostgREST).';
