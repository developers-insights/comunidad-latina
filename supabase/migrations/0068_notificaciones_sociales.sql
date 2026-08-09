-- =============================================================================
-- 0068_notificaciones_sociales.sql — Comunidad Latina
--
-- Notificaciones de "me gusta" y comentarios, que estaban declaradas como
-- pendientes. El código que las EMITE lo escribe otro agente; acá va lo que
-- tiene que existir en la base para que se puedan emitir bien.
--
-- -----------------------------------------------------------------------------
-- QUÉ **NO** HIZO FALTA AGREGAR (y por qué se revisó igual)
-- -----------------------------------------------------------------------------
-- Se verificó contra el esquema real antes de tocar nada:
--   * `notifications.category` ya tiene 'social' en su CHECK (0045), y de hecho
--     es la categoría que ya usa `follow` — el mismo tipo de evento social.
--     Reaction y comment entran ahí sin cambiar el CHECK.
--   * `notifications.kind` es TEXTO LIBRE por diseño de 0045 ("kind sigue
--     siendo la etiqueta fina del evento"): no tiene CHECK, así que 'reaction'
--     y 'comment' no requieren migración.
--   * `notification_prefs.category` tiene el mismo dominio de 13 valores, con
--     'social' incluido.
-- O sea que NO se agregaron categorías ni valores de CHECK, porque no faltaba
-- ninguno. Agregar una categoría 'likes' aparte habría partido en dos la
-- pestaña "social" que el usuario ya conoce.
--
-- -----------------------------------------------------------------------------
-- LO QUE SÍ FALTABA: que emitirlas bien no dependa de recordar cuatro reglas
-- -----------------------------------------------------------------------------
-- Una notificación de "me gusta" bien hecha tiene que, TODAS las veces:
--   1. no notificarte tus propias acciones;
--   2. no notificar entre personas que se bloquearon;
--   3. respetar notification_prefs (y respetar que la AUSENCIA de fila
--      significa "todo prendido", no "todo apagado");
--   4. agrupar por group_key con el protocolo exacto de 0045 — buscar una fila
--      VIVA con el mismo (tenant, profile, group_key) y ACTUALIZARLA, en vez de
--      insertar otra.
-- La regla 4 es la que se implementa mal: 0045 documenta que el índice NO es
-- único a propósito (PostgREST no sabe hacer ON CONFLICT contra un índice
-- parcial), así que el "buscá y actualizá" hay que escribirlo a mano. Ponerlo
-- una vez en la base es la diferencia entre "50 likes = 1 notificación" y
-- "50 likes = 50 notificaciones".
-- =============================================================================

begin;

create or replace function app.emit_social_notification(
  p_tenant       uuid,
  p_recipient    uuid,
  p_actor        uuid,
  p_kind         text,
  p_subject_kind text,
  p_subject_id   uuid,
  p_title        text,
  p_body         text default null,
  p_href         text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group text;
  v_id    uuid;
  v_pref  record;
begin
  -- 1. No te notificás a vos mismo.
  if p_recipient is null or p_recipient = p_actor then
    return null;
  end if;

  -- 2. Nada entre personas que se bloquearon (en cualquiera de las dos
  --    direcciones — app.pair_blocked ya resuelve la simetría, 0020).
  if p_actor is not null and app.pair_blocked(p_recipient, p_actor) then
    return null;
  end if;

  -- 3. Preferencias. La AUSENCIA DE FILA significa TODO PRENDIDO (0045): por
  --    eso sólo se corta si hay fila Y dice que no.
  select in_app, frequency into v_pref
    from public.notification_prefs
   where profile_id = p_recipient and category = 'social';

  if found and (v_pref.in_app = false or v_pref.frequency = 'off') then
    return null;
  end if;

  -- 4. Agrupación con el protocolo de 0045.
  v_group := p_kind || ':' || p_subject_kind || ':' || p_subject_id::text;

  update public.notifications
     set title      = p_title,
         body       = p_body,
         created_at = now()
   where tenant_id  = p_tenant
     and profile_id = p_recipient
     and group_key  = v_group
     and read_at      is null
     and dismissed_at is null
   returning id into v_id;

  if v_id is not null then
    return v_id;
  end if;

  insert into public.notifications
    (tenant_id, profile_id, kind, title, body, href, category, priority, group_key)
  values
    (p_tenant, p_recipient, p_kind, p_title, p_body, p_href, 'social', 'normal', v_group)
  returning id into v_id;

  return v_id;
end;
$$;

comment on function app.emit_social_notification(uuid, uuid, uuid, text, text, uuid, text, text, text) is
  'Emite una notificación social (reaction, comment, follow) aplicando de una sola vez las cuatro reglas que es fácil olvidar: no auto-notificar, respetar bloqueos (app.pair_blocked), respetar notification_prefs entendiendo que la ausencia de fila significa TODO PRENDIDO, y agrupar con el protocolo de group_key de 0045 (buscar la fila VIVA y actualizarla en vez de insertar otra — el índice no es único a propósito, así que ON CONFLICT no sirve). Devuelve el id de la notificación, o NULL si se decidió no emitir. `kind` sugerido: reaction | comment. Categoría siempre `social`, igual que follow. EXECUTE sólo para service_role: la emite el servidor, nunca el cliente.';

revoke execute on function app.emit_social_notification(uuid, uuid, uuid, text, text, uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function app.emit_social_notification(uuid, uuid, uuid, text, text, uuid, text, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- Índice de apoyo del "buscá la fila viva"
-- ---------------------------------------------------------------------------
-- 0045 creó notifications_group_live_idx para exactamente esta consulta. Se
-- verifica que exista en vez de asumirlo: si alguna vez se cayó, el UPDATE de
-- arriba pasa a hacer seq scan de notifications en cada like de la plataforma.
do $$
begin
  if to_regclass('public.notifications_group_live_idx') is null then
    create index notifications_group_live_idx
      on public.notifications (tenant_id, profile_id, group_key)
      where group_key is not null and read_at is null and dismissed_at is null;
  end if;
end $$;

commit;
