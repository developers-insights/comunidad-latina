-- =============================================================================
-- 0081_el_schema_app_deja_de_estar_abierto_a_anon.sql — Comunidad Latina
--
-- HIGIENE. `anon` tenía EXECUTE sobre 72 de las 85 funciones del schema `app`,
-- varias SECURITY DEFINER. Dos son feas de verdad:
--
--   · `app.creator_activation_eligible(uuid)` es un oráculo de privacidad: sobre
--     CUALQUIER perfil y cross-tenant, sus `reasons` delatan phone_verified,
--     email_verified, el umbral de trust, la edad derivada de
--     `profiles_private.birthdate`, las restricciones activas y el estado de
--     Stripe. Todo eso sin cuenta. Reproducido como anon sobre un perfil ajeno:
--     {"eligible":false,"reasons":["edad_minima","telefono","correo","identidad",
--      "user_score","portafolio"]}
--   · `app.next_gig_code()` MUTA ESTADO —consume una secuencia— sin
--     autenticación de ningún tipo. Reproducido como anon: CL-CM-2026-000014.
--
-- NO ES EXPLOTABLE HOY: PostgREST sólo expone `public` y `graphql_public`, así
-- que pegarle a /rest/v1/rpc/creator_activation_eligible devuelve 406 PGRST106.
-- Es deuda latente: se vuelve real el día que alguien le ponga un envoltorio en
-- `public` (que es exactamente lo que hicieron 0070 y 0071 para otras cuatro) o
-- cambie la configuración de schemas expuestos.
--
-- POR QUÉ **NO** SE REVOCA `usage` SOBRE EL SCHEMA, QUE ERA LO OBVIO
--   Sería una sola línea y cerraría las 72 de un saque. Rompe la app entera.
--   Medido antes de tocar nada: hay NUEVE policies de RLS que aplican al rol
--   `anon` y cuya expresión llama a `app.*` — boosts_select, comments_select,
--   gig_reviews_select, guides_select, listing_comments_select, listings_select,
--   post_promotions_select, posts_select, tenants_select — y las expresiones de
--   una policy se evalúan con los privilegios de QUIEN CONSULTA, no del dueño de
--   la tabla. Sin USAGE sobre `app`, un visitante sin sesión abriendo un aviso,
--   una publicación o la home recibe "permission denied for schema app".
--   `tenants_select` además es la que lee `resolve_tenant_domain` (0060, SECURITY
--   INVOKER), o sea que se caería el middleware antes de que exista sesión: la
--   plataforma entera, no una pantalla.
--     -> `usage` sobre `app` se le DEJA a `anon`. La revocación es por función.
--
-- POR QUÉ HAY QUE REVOCAR TAMBIÉN DE `public` (y por qué acá sí es seguro)
--   Revocar sólo de `anon` habría sido un NO-OP silencioso: las 72 funciones
--   tienen a la vez un grant directo a `anon` Y el grant implícito a `PUBLIC` que
--   Postgres le pone a toda función nueva. Mientras `PUBLIC` conserve EXECUTE,
--   `anon` sigue pudiendo ejecutarlas por herencia.
--
--   El riesgo conocido de tocar `PUBLIC` es sacarle a `authenticated` y
--   `service_role` un permiso que sólo tenían por herencia. Acá no pasa, y no es
--   una suposición — se midió sobre las 85 antes de escribir esto:
--       funciones con grant a PUBLIC ................................ 72
--       de ésas, SIN grant directo a `authenticated` ................. 0
--       de ésas, SIN grant directo a `service_role` .................. 0
--   Las dos lo tienen explícito en las 72. Por eso `revoke ... from public, anon`
--   les saca exactamente un acceso: el de `anon`. Los envoltorios SECURITY
--   INVOKER de 0070/0071, que corren como `service_role` y llaman a `app.*`,
--   siguen teniendo el EXECUTE directo que necesitan. Verificado ejecutándolos,
--   no leyendo el catálogo.
--
-- LAS OCHO QUE SE QUEDAN, UNA POR UNA
--   No es una lista de deseos: es el cierre transitivo de lo que `anon` necesita
--   para que el sitio público funcione, calculado del catálogo.
--     current_tenant_id, current_user_role, is_staff, is_global_admin
--         Las llaman las nueve policies de arriba. `is_staff` e `is_global_admin`
--         llaman a su vez a `current_user_role`, que por eso también entra.
--     unaccent_immutable, media_has_video, video_post_href, pair_blocked
--         Son el cuerpo de `public.global_search` y `public.notification_counts`,
--         las dos únicas funciones de `public` que son SECURITY INVOKER y que
--         `anon` puede ejecutar. Al ser invoker, el cuerpo corre con los
--         privilegios del que llama: sin estas cuatro, la búsqueda del sitio
--         público tira 42501.
--   Todo lo demás que `anon` "usaba" pasa por funciones SECURITY DEFINER de
--   `public` (profile_card, record_cta_click, tenant_public_prices...), cuyo
--   cuerpo corre como el dueño y por lo tanto no necesita que `anon` tenga nada.
--   `app.privacy_allows` y `app.profile_privacy_defaults` son el ejemplo: las
--   llama `profile_card`, que es definer, así que se revocan sin consecuencia.
--
-- Y QUE NO VUELVA A PASAR
--   El schema `app` tiene default privileges que le conceden EXECUTE a `anon`
--   sobre toda función NUEVA (pg_default_acl: {anon=X, authenticated=X,
--   service_role=X}). Sin tocar eso, la próxima migración que agregue una
--   función en `app` reabre el agujero sola. Se le saca `anon` al default y se
--   dejan `authenticated` y `service_role`.
--
-- ADITIVO Y REVERSIBLE: no se borra ni una función, ni una fila, ni una columna.
-- Deshacerlo es `grant execute on all functions in schema app to anon` más
-- `alter default privileges in schema app grant execute on functions to anon`.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Revocar función por función, salvo las ocho que el sitio público necesita
-- ---------------------------------------------------------------------------
do $$
declare
  v_permitidas constant text[] := array[
    -- Las llaman las policies de RLS que aplican al rol `anon`
    'current_tenant_id', 'current_user_role', 'is_staff', 'is_global_admin',
    -- Las llama el cuerpo de public.global_search / public.notification_counts,
    -- que son SECURITY INVOKER y sí son alcanzables por `anon`
    'unaccent_immutable', 'media_has_video', 'video_post_href', 'pair_blocked'
  ];
  v_fn       record;
  v_contador int := 0;
begin
  for v_fn in
    select p.oid::regprocedure::text as firma
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app'
       and p.proname <> all (v_permitidas)
     order by 1
  loop
    -- `public` va primero y no es decorativo: sin sacarle el grant implícito a
    -- PUBLIC, revocarle a `anon` no cambia nada (lo hereda igual).
    execute format('revoke execute on function %s from public', v_fn.firma);
    execute format('revoke execute on function %s from anon',   v_fn.firma);
    v_contador := v_contador + 1;
  end loop;

  raise notice 'app.*: EXECUTE revocado a public+anon en % funciones', v_contador;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Que las nuevas no nazcan abiertas
-- ---------------------------------------------------------------------------
alter default privileges in schema app revoke execute on functions from anon;

-- `authenticated` y `service_role` se reafirman explícitos: son los dos
-- consumidores legítimos de `app.*` (la app con sesión y los envoltorios de
-- 0070/0071), y dejarlo escrito evita que el próximo que lea `pg_default_acl`
-- crea que el schema quedó cerrado para todos.
alter default privileges in schema app grant execute on functions to authenticated, service_role;

comment on schema app is
  'Motor interno: helpers de claims, reglas de negocio y funciones de trigger. PostgREST no lo expone (sólo public y graphql_public), así que nada de acá es alcanzable por REST — pero eso es una propiedad de la configuración, no un permiso, y por eso desde 0081 los permisos también lo dicen. `anon` conserva USAGE sobre el schema porque nueve policies de RLS que aplican a `anon` llaman a app.current_tenant_id/current_user_role/is_staff/is_global_admin y las expresiones de una policy corren con los privilegios de quien consulta: sin USAGE, el sitio público entero devuelve "permission denied for schema app". Lo que sí se cerró es el EXECUTE: `anon` sólo puede ejecutar esas cuatro más unaccent_immutable, media_has_video, video_post_href y pair_blocked, que son el cuerpo de public.global_search y public.notification_counts (las únicas SECURITY INVOKER de public alcanzables sin sesión). Todo lo demás se revocó de `anon` Y de `PUBLIC` — de PUBLIC también, porque el grant implícito hacía que revocarle a `anon` fuera un no-op; era seguro porque las 72 afectadas tenían además grant DIRECTO a authenticated y service_role, así que ninguno de los dos perdió nada.';

commit;