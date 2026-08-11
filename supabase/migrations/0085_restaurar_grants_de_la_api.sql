-- =============================================================================
-- 0085_restaurar_grants_de_la_api.sql — Comunidad Latina
--
-- LA APP ENTERA SE VEÍA VACÍA (feed, propiedades, negocios, empleos, perfiles).
-- No era el feed ni una query: `anon` y `authenticated` habían perdido TODOS los
-- privilegios sobre TODAS las tablas de `public`. Medido antes de tocar nada:
--
--     tablas en public .................................. 91
--     con SELECT para anon .............................. 0
--     con SELECT para authenticated .................... 17  (todas *_caughtcode)
--     ACL de public.posts ... {postgres=arwdDxtm, service_role=arwdDxtm}
--
-- O sea: cada consulta de la app devolvía 42501 "permission denied for table".
-- El código las captura con `console.warn` y sigue con `[]` (por diseño: un feed
-- roto no debe tirar la pantalla), así que el síntoma fue "no hay nada" en vez
-- de un error — por eso pasó desapercibido.
--
-- RLS Y POLICIES ESTÁN INTACTAS: 4 policies por tabla, `relrowsecurity` en true.
-- Lo único que faltaba era el GRANT, que es el escalón de ABAJO de la RLS: sin
-- privilegio de tabla, Postgres ni llega a evaluar la policy.
--
-- DE DÓNDE VINO. No de este repo: ninguna migración 0001–0084 revoca privilegios
-- de tabla a `anon`/`authenticated` de forma masiva (verificado recorriendo los
-- `statements` de supabase_migrations.schema_migrations). Esta base es
-- COMPARTIDA con otro proyecto (las 17 tablas `*_caughtcode`), y el estado del
-- catálogo lo delata: los default privileges de `public` para tablas nuevas
-- quedaron en {postgres, authenticated, service_role} — sin `anon` — que es
-- exactamente lo que hereda una tabla creada DESPUÉS de un
-- `revoke all on all tables in schema public from anon, authenticated` seguido
-- de un `alter default privileges ... revoke ... from anon`. Las de caughtcode
-- nacieron después y por eso conservan `authenticated`; las nuestras, no.
--
-- QUÉ HACE ESTA MIGRACIÓN
--   1. Devuelve el grant estándar de Supabase (`all`) a `anon` y `authenticated`
--      sobre las tablas de ESTE proyecto — las `*_caughtcode` no se tocan, no
--      son nuestras.
--   2. Vuelve a aplicar, una por una, las restricciones por COLUMNA que sí son
--      decisiones nuestras y que el paso 1 borraría de nuevo: 0018 (boosts),
--      0057 (verification_checks), 0058 (profiles, creator_scores,
--      business_scores), 0059 (trust_scores) y el grant de username/cover_url.
--      Sin este paso, "reparar" sería reabrir cuatro agujeros ya cerrados.
--
-- LO QUE **NO** HACE, a propósito: no toca los default privileges del schema.
-- Son globales y compartidos con el otro proyecto. Consecuencia a tener
-- presente: una tabla NUEVA nuestra nace sin acceso para `anon`, así que toda
-- migración que cree una tabla pública tiene que terminar con su
-- `grant ... to anon, authenticated` explícito.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Baseline: el grant estándar, solo sobre las tablas de este proyecto
-- ---------------------------------------------------------------------------
do $$
declare
  v_tabla   record;
  v_contador int := 0;
begin
  for v_tabla in
    select c.oid::regclass::text as nombre
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind in ('r', 'p', 'v', 'm')
       and c.relname not like '%\_caughtcode'
     order by 1
  loop
    execute format('grant all on %s to anon, authenticated', v_tabla.nombre);
    v_contador := v_contador + 1;
  end loop;

  raise notice 'grants restaurados en % tablas de public', v_contador;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Y de nuevo el endurecimiento por columna que el paso 1 acaba de pisar
-- ---------------------------------------------------------------------------

-- 0018 — boosts: solo columnas de transparencia FTC (nada de buyer_id, montos
-- ni la sesión de Stripe).
revoke select on table public.boosts from anon, authenticated;
grant select (id, tenant_id, listing_id, package, duration_days, status, starts_at, ends_at, created_at)
  on table public.boosts to anon, authenticated;

-- 0056/0057 — verification_checks.evidence trae nombre real y matrícula.
revoke select on public.verification_checks from anon, authenticated;
grant select (
  id,
  tenant_id,
  subject_kind,
  subject_id,
  license_number,
  registry,
  registry_url,
  result,
  checked_at,
  disclaimer_version,
  created_at
) on public.verification_checks to anon, authenticated;

-- 0058 — profiles: sin cuenta no se saca la lista de admins de cada comunidad.
-- Las columnas son las de 0058 MÁS username/cover_url (migración
-- `campos_de_registro_y_perfil`, 2026-08-08).
revoke select on public.profiles from anon;
grant select (
  id,
  display_name,
  avatar_url,
  country_origin,
  area_label,
  bio,
  identity_verified,
  created_at,
  username,
  cover_url
) on public.profiles to anon;

-- 0058 — internos del motor de scoring (`factors` es el manual para gamearlo).
revoke select on public.creator_scores from anon;
grant select (profile_id, tenant_id, score, score_previous, level, is_provisional, score_version, computed_at)
  on public.creator_scores to anon;

revoke select on public.business_scores from anon;
grant select (business_id, tenant_id, score, score_previous, level, score_version, computed_at)
  on public.business_scores to anon;

-- 0059 — trust_scores: `signals` se queda (23 archivos lo piden en páginas
-- públicas); lo que sale es `factors`.
revoke select on public.trust_scores from anon;
grant select (
  profile_id,
  tenant_id,
  score,
  score_previous,
  level,
  signals,
  score_version,
  computed_at
) on public.trust_scores to anon;

commit;
