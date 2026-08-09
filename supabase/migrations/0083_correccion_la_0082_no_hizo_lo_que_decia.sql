-- =============================================================================
-- 0083_correccion_la_0082_no_hizo_lo_que_decia.sql — Comunidad Latina
--
-- La 0082 afirma en su `comment on schema app` que, desde ella, una función
-- NUEVA en `app` "nace ejecutable sólo por authenticated y service_role".
-- SE PROBÓ DESPUÉS DE APLICARLA, EN UNA TRANSACCIÓN APARTE, Y ES FALSO.
--
-- Esta migración no cambia permisos: cambia el comentario, porque un comentario
-- que miente sobre una propiedad de seguridad es peor que no tener comentario —
-- alguien lo va a leer y va a creerle. Mismo criterio que la 0076 con el
-- registro de sanciones.
--
-- LA MEDICIÓN. Creando `app._prueba(...)` como `postgres` después de aplicar
-- 0081 y 0082:
--   ACL resultante ....... {=X/postgres, postgres=X/postgres,
--                           authenticated=X/postgres, service_role=X/postgres}
--   has_function_privilege('anon', ..., 'EXECUTE') ............... true
-- El `=X/postgres` es PUBLIC, y `anon` lo hereda. O sea que el
-- `alter default privileges ... revoke execute on functions from public` de la
-- 0082 fue un NO-OP.
--
-- POR QUÉ. La aritmética del catálogo lo explica sin ambigüedad:
--   acldefault('f','postgres') = {=X/postgres, postgres=X/postgres}
--   pg_default_acl almacenado  = {authenticated=X/postgres, service_role=X/postgres}
--   ACL que recibe la función  = la UNIÓN de las dos
-- `pg_default_acl` acá se comporta de forma ADITIVA sobre el default incorporado
-- del motor: sirve para AGREGAR concesiones, no para quitar el `=X` que Postgres
-- le pone a PUBLIC en toda función nueva. Por eso "revocarle a PUBLIC" no tenía
-- nada que revocar: en el registro almacenado PUBLIC ya no figuraba.
--
-- La otra mitad, la de la 0081, SÍ funcionó y se deja: el
-- `revoke execute on functions from anon` sacó el grant explícito a `anon` del
-- default, y se ve en que el ACL de arriba no tiene `anon=X`. Reduce el ruido,
-- pero no alcanza, porque PUBLIC lo cubre igual.
--
-- QUÉ QUEDA VIGENTE
--   LO QUE SÍ ESTÁ CERRADO (0081, verificado ejecutando como `anon`, no leyendo
--   el catálogo): las 77 funciones existentes de `app` fuera de la lista blanca
--   ya no son ejecutables por `anon` —app.creator_activation_eligible y
--   app.next_gig_code fallan con 42501— y ni `authenticated` ni `service_role`
--   perdieron nada.
--
--   LO QUE **NO** SE PUEDE GARANTIZAR POR PERMISOS: que una función FUTURA en
--   `app` nazca cerrada. Nace con EXECUTE para PUBLIC, y por lo tanto alcanzable
--   por `anon`. Mientras PostgREST no exponga el schema `app` eso no es
--   explotable, igual que antes de la 0081 — pero es la misma deuda latente que
--   esa migración vino a saldar, así que hay que sostenerla a mano:
--
--   ⚠️ REGLA PARA TODA MIGRACIÓN QUE AGREGUE UNA FUNCIÓN EN `app`:
--      terminar con
--          revoke execute on function app.<nombre>(<args>) from public, anon;
--      salvo que el sitio público la necesite de verdad, y en ese caso escribir
--      el motivo. `revoke ... from anon` SOLO no sirve: PUBLIC la sigue
--      cubriendo. Las dos, o ninguna.
--
-- No se agrega un event trigger que lo haga automático: sería maquinaria nueva
-- corriendo en TODO DDL de la base para cerrar una deuda que hoy no es
-- explotable, y el riesgo de que un bug ahí rompa una migración es mayor que el
-- que se está evitando. Si algún día `app` queda expuesto por PostgREST, esa
-- decisión hay que revisarla.
-- =============================================================================

comment on schema app is
  'Motor interno: helpers de claims, reglas de negocio y funciones de trigger. PostgREST no lo expone (sólo public y graphql_public), así que nada de acá es alcanzable por REST — pero eso es una propiedad de la configuración, no un permiso, y por eso desde 0081 los permisos también lo dicen.

`anon` conserva USAGE sobre el schema, y no es un olvido: nueve policies de RLS que aplican al rol `anon` (listings, posts, comments, guides, boosts, post_promotions, gig_reviews, listing_comments, tenants) llaman a app.current_tenant_id/current_user_role/is_staff/is_global_admin, y las expresiones de una policy corren con los privilegios de QUIEN CONSULTA. Sin USAGE, el sitio público entero —y el middleware, que resuelve el Host contra `tenants` antes de que exista sesión— devuelve "permission denied for schema app".

Lo que sí se cerró (0081) es el EXECUTE. `anon` sólo puede ejecutar ocho funciones: las cuatro de claims que necesitan esas policies, más unaccent_immutable, media_has_video, video_post_href y pair_blocked, que son el cuerpo de public.global_search y public.notification_counts (las únicas SECURITY INVOKER de public alcanzables sin sesión). Las otras 77 se revocaron de `anon` Y de `PUBLIC`: de PUBLIC también porque el grant implícito hacía que revocarle sólo a `anon` fuera un no-op. Fue seguro porque las 72 que tenían grant a PUBLIC tenían ADEMÁS grant directo a authenticated y service_role, así que ninguno de los dos perdió nada — medido antes de tocar, y verificado después ejecutando los cuatro envoltorios de 0070/0071 como service_role.

⚠️ LO QUE NO ESTÁ GARANTIZADO. Una función NUEVA en `app` NACE con EXECUTE para PUBLIC, o sea alcanzable por `anon`. La 0082 intentó evitarlo con default privileges y NO funcionó (ver 0083): pg_default_acl es aditivo sobre el default incorporado del motor y no puede quitarle el =X a PUBLIC. Por lo tanto, toda migración que agregue una función acá tiene que terminar con `revoke execute on function app.<nombre>(<args>) from public, anon;` — las dos, porque revocarle sólo a `anon` no hace nada.';