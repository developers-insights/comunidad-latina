-- 0070 — Envoltorios en `public` para dos funciones que viven en `app`.
--
-- Por qué existe esta migración:
--   `app.scan_content_asset` (0061) y `app.emit_social_notification` (0068) se
--   escribieron en el schema `app` a propósito: no quedan expuestas por PostgREST
--   y no generan advisory de "definer alcanzable". El costo de esa decisión
--   apareció al construir la capa de aplicación: PostgREST SOLO expone `public` y
--   `graphql_public`, así que llamarlas desde la app devuelve
--     406 PGRST106 — "Only the following schemas are exposed: public, graphql_public"
--   y el código quedó obligado a mantener un espejo en TypeScript de la lógica
--   que ya vive en SQL. Dos fuentes de verdad para "qué es un duplicado" es
--   exactamente el tipo de deuda que termina en un bug silencioso.
--
-- Qué hace:
--   Expone un envoltorio mínimo en `public` para cada una, con EXECUTE concedido
--   ÚNICAMENTE a `service_role`. La superficie pública no crece: `anon` y
--   `authenticated` no pueden ejecutarlas. El cuerpo real sigue siendo el de `app`
--   (SECURITY DEFINER), que no se toca.
--
-- Los envoltorios son SECURITY INVOKER a propósito: la función interna ya corre
-- como su dueño, así que declararlos definer sería privilegio de más y un
-- advisory nuevo sin ninguna ganancia.

-- ---------------------------------------------------------------------------
-- Content Integrity: escaneo de un asset contra el resto del tenant.
-- ---------------------------------------------------------------------------
create or replace function public.scan_content_asset(
  p_asset_id     uuid,
  p_max_distance integer
)
returns integer
language sql
security invoker
set search_path = ''
as $$
  select app.scan_content_asset(p_asset_id, p_max_distance);
$$;

comment on function public.scan_content_asset(uuid, integer) is
  'Envoltorio de app.scan_content_asset para que la aplicación pueda llamarla por PostgREST (que solo expone public). EXECUTE solo para service_role: el escaneo se dispara del lado del servidor, nunca desde el navegador.';

revoke all on function public.scan_content_asset(uuid, integer) from public;
revoke all on function public.scan_content_asset(uuid, integer) from anon;
revoke all on function public.scan_content_asset(uuid, integer) from authenticated;
grant execute on function public.scan_content_asset(uuid, integer) to service_role;

-- ---------------------------------------------------------------------------
-- Notificaciones sociales: emisión con agrupación, bloqueos y preferencias.
-- ---------------------------------------------------------------------------
create or replace function public.emit_social_notification(
  p_tenant       uuid,
  p_recipient    uuid,
  p_actor        uuid,
  p_kind         text,
  p_subject_kind text,
  p_subject_id   uuid,
  p_title        text,
  p_body         text,
  p_href         text
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select app.emit_social_notification(
    p_tenant, p_recipient, p_actor, p_kind,
    p_subject_kind, p_subject_id, p_title, p_body, p_href
  );
$$;

comment on function public.emit_social_notification(uuid, uuid, uuid, text, text, uuid, text, text, text) is
  'Envoltorio de app.emit_social_notification para que la aplicación pueda llamarla por PostgREST. EXECUTE solo para service_role: si `authenticated` pudiera llamarla, cualquiera podría fabricar notificaciones en el nombre de otro.';

revoke all on function public.emit_social_notification(uuid, uuid, uuid, text, text, uuid, text, text, text) from public;
revoke all on function public.emit_social_notification(uuid, uuid, uuid, text, text, uuid, text, text, text) from anon;
revoke all on function public.emit_social_notification(uuid, uuid, uuid, text, text, uuid, text, text, text) from authenticated;
grant execute on function public.emit_social_notification(uuid, uuid, uuid, text, text, uuid, text, text, text) to service_role;
