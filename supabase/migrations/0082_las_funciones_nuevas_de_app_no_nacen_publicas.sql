-- =============================================================================
-- 0082_las_funciones_nuevas_de_app_no_nacen_publicas.sql — Comunidad Latina
--
-- Cierra el cabo suelto que dejó la 0081, encontrado al VERIFICARLA en vez de
-- darla por buena.
--
-- LO QUE PASÓ
--   La 0081 revocó `execute` a `public` y `anon` sobre las 77 funciones de `app`
--   que no están en la lista blanca, y además hizo
--       alter default privileges in schema app revoke execute on functions from anon;
--   dando por cerrado el caso de las funciones FUTURAS. La prueba dijo otra cosa.
--   Creando una función nueva en `app` después de aplicar la 0081, su ACL quedó:
--
--       {=X/postgres, postgres=X/postgres, authenticated=X/postgres, service_role=X/postgres}
--
--   El `anon=X` explícito, efectivamente, ya no aparece: esa mitad funcionó. Pero
--   el `=X/postgres` del principio es el grant que Postgres le da a **PUBLIC** en
--   TODA función nueva, y `anon` lo hereda igual. O sea:
--   `has_function_privilege('anon', ...)` seguía dando `true`.
--
--   Es el mismo mecanismo que ya había hecho falta corregir en la 0081 para las
--   funciones existentes —revocarle a `anon` sin revocarle a `PUBLIC` es un
--   no-op— sólo que aplicado a las que todavía no existen.
--
-- EL ARREGLO
--   Sacarle también a `PUBLIC` el `execute` por defecto del schema. Los dos
--   consumidores legítimos (`authenticated` y `service_role`) ya tienen su propio
--   grant explícito en los default privileges desde la 0081, así que no dependen
--   del de PUBLIC y no pierden nada: una función nueva en `app` nace ejecutable
--   por ellos dos y por nadie más.
--
--   Con esto, la próxima migración que agregue una función en `app` ya no
--   reabre sola el agujero que la 0081 acaba de cerrar.
--
-- ALCANCE, dicho con precisión
--   `alter default privileges` sólo alcanza a los objetos que cree el MISMO rol
--   (acá `postgres`, que es el que corre las migraciones) en ESTE schema. No
--   toca ninguna función existente —de eso se ocupó la 0081— ni ningún otro
--   schema. En particular `public` NO se toca: ahí el grant a PUBLIC es parte de
--   cómo Supabase expone la API y cambiarlo rompería PostgREST.
--
-- ADITIVO Y REVERSIBLE: no se borra nada. Deshacerlo es
--   `alter default privileges in schema app grant execute on functions to public;`
-- =============================================================================

alter default privileges in schema app revoke execute on functions from public;

comment on schema app is
  'Motor interno: helpers de claims, reglas de negocio y funciones de trigger. PostgREST no lo expone (sólo public y graphql_public), así que nada de acá es alcanzable por REST — pero eso es una propiedad de la configuración, no un permiso, y por eso desde 0081 los permisos también lo dicen. `anon` conserva USAGE sobre el schema porque nueve policies de RLS que aplican a `anon` llaman a app.current_tenant_id/current_user_role/is_staff/is_global_admin y las expresiones de una policy corren con los privilegios de quien consulta: sin USAGE, el sitio público entero devuelve "permission denied for schema app". Lo que sí se cerró es el EXECUTE: `anon` sólo puede ejecutar esas cuatro más unaccent_immutable, media_has_video, video_post_href y pair_blocked, que son el cuerpo de public.global_search y public.notification_counts (las únicas SECURITY INVOKER de public alcanzables sin sesión). Todo lo demás se revocó de `anon` Y de `PUBLIC` — de PUBLIC también, porque el grant implícito hacía que revocarle a `anon` fuera un no-op; era seguro porque las 72 afectadas tenían además grant DIRECTO a authenticated y service_role, así que ninguno de los dos perdió nada. Desde 0082 los default privileges del schema le quitan `execute` a PUBLIC y a `anon`, de modo que una función NUEVA en `app` nace ejecutable sólo por `authenticated` y `service_role`: si una función nueva tiene que ser alcanzable sin sesión, hay que concederlo a mano y con motivo escrito.';
