-- =============================================================================
-- 0177_descartar_solicitud_sin_bloquear.sql — Comunidad Latina
--
-- "Eliminar" (campana) e "Ignorar" (Mensajes) dejaban la solicitud en
-- `blocked`: nadie volvía a escribir y quien pidió contacto no podía volver a
-- intentarlo NUNCA, ni por otro camino (0134 §2). Eso es un bloqueo con otro
-- nombre, y para bloquear ya existe "Bloquear" (user_blocks / pair_blocked).
--
-- Ahora descartar es como en Instagram:
--   · status `declined` + `declined_at`. Desaparece de la bandeja y de
--     Solicitudes de quien la recibió.
--   · Quien la pidió NO se entera: para esa persona sigue siendo una solicitud
--     enviada (la app pinta `declined` como `pending` del lado del creador) y
--     puede seguir escribiendo el mensaje de presentación, que no le llega a
--     nadie porque nada notifica sobre una `declined`.
--   · Volver a pedir contacto reabre la MISMA fila (pending) recién pasados
--     `app.dias_para_volver_a_pedir()` días desde el descarte. Antes de eso la
--     RPC devuelve el id sin tocar nada: no hay aviso nuevo y la respuesta es
--     idéntica a la de una solicitud pendiente, así que tampoco hay señal.
--   · Se reabre la misma fila y no se crea otra porque los índices únicos
--     (`conversations_listing_requester_uniq`, `conversations_directa_uniq`)
--     ya dicen "una solicitud por aviso / por par", y porque así el aviso de
--     la app (solicitud-server.ts) deduplica contra `declined_at` sin estado
--     nuevo: un aviso anterior al descarte no cuenta como "ya avisado".
--
-- Se descartó borrar la fila pending: el solicitante la vería desaparecer de
-- su bandeja (señal de rechazo), se perderían los mensajes, y al no quedar
-- memoria del descarte no habría ventana anti-spam posible.
--
-- Las `blocked` existentes NO se migran: una "Ignorar" vieja y un bloqueo de
-- perfil (block_user también escribe `blocked`) no se distinguen en la fila.
-- `blocked` conserva exactamente su significado previo.
--
-- De paso: `anon` no tiene nada que hacer en `notifications` (toda lectura es
-- con sesión y por `profile_id = auth.uid()`), así que se le revoca todo.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1 · Estado nuevo
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select conname
      from pg_constraint
     where conrelid = 'public.conversations'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table public.conversations drop constraint %I', r.conname);
  end loop;
end;
$$;

alter table public.conversations
  add constraint conversations_status_check
  check (status in ('pending', 'accepted', 'blocked', 'declined'));

alter table public.conversations
  add column if not exists declined_at timestamptz;

comment on column public.conversations.status is
  'pending → accepted (solo counterpart, via accept_conversation) | declined (descartada por la contraparte vía descartar_solicitud, 0177: no bloquea, el creador la sigue viendo como pendiente y puede volver a pedir pasada la ventana) | blocked (bloqueo de perfil o "Ignorar" anterior a la 0177: nadie escribe). El creador NO puede auto-aceptar.';

comment on column public.conversations.declined_at is
  'Último descarte (0177). Se conserva al reabrir: es la marca contra la que la app decide si un aviso de solicitud ya se mandó en ESTA ronda.';

-- ---------------------------------------------------------------------------
-- 2 · La ventana anti-spam, en un solo lugar
-- ---------------------------------------------------------------------------
create or replace function app.dias_para_volver_a_pedir()
returns integer
language sql
immutable
set search_path = ''
as $$ select 30 $$;

comment on function app.dias_para_volver_a_pedir() is
  'Días que tienen que pasar desde que alguien descartó tu solicitud para que volver a pedir contacto le llegue de nuevo (0177). Antes de eso el pedido se acepta en silencio y no notifica.';

create or replace function app.solicitud_puede_reabrirse(p_declined_at timestamptz)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(p_declined_at, '-infinity'::timestamptz)
         <= now() - make_interval(days => app.dias_para_volver_a_pedir())
$$;

grant execute on function app.dias_para_volver_a_pedir() to authenticated, service_role;
grant execute on function app.solicitud_puede_reabrirse(timestamptz) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3 · descartar_solicitud — la única puerta de "Eliminar" / "Ignorar"
--
-- Devuelve el estado final en vez de lanzar cuando ya estaba resuelta: la app
-- distingue "lo descarté ahora" de "ya la habías aceptado en otro dispositivo"
-- sin una segunda lectura. `for update` evita pisar un accept concurrente.
-- ---------------------------------------------------------------------------
create or replace function public.descartar_solicitud(p_conversation_id uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_tenant uuid := app.current_tenant_id();
  v_conv   record;
begin
  if v_uid is null or v_tenant is null then
    raise exception 'AUTH_REQUIRED: necesitás una cuenta.';
  end if;

  select c.id, c.tenant_id, c.counterpart_id, c.status
    into v_conv
    from public.conversations c
   where c.id = p_conversation_id
   for update;

  -- Mismo error para "no existe", "otra comunidad" y "no es tuya": no se
  -- filtra la existencia de solicitudes ajenas.
  if not found
     or v_conv.tenant_id is distinct from v_tenant
     or v_conv.counterpart_id is distinct from v_uid then
    raise exception 'CONVERSATION_NOT_FOUND: la solicitud no está disponible.';
  end if;

  if v_conv.status <> 'pending' then
    return v_conv.status;
  end if;

  update public.conversations
     set status = 'declined',
         declined_at = now()
   where id = v_conv.id;

  return 'declined';
end;
$$;

comment on function public.descartar_solicitud(uuid) is
  'Descarta una solicitud de contacto recibida (0177): pending → declined. NO bloquea: la persona puede volver a pedir contacto pasados app.dias_para_volver_a_pedir() días y nunca se entera del descarte. Sólo la contraparte. Idempotente: si ya no estaba pendiente devuelve el estado actual sin tocarlo.';

revoke execute on function public.descartar_solicitud(uuid) from public, anon;
grant  execute on function public.descartar_solicitud(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4 · request_contact — re-creada COMPLETA (base: 0020) + reabrir descartada
-- ---------------------------------------------------------------------------
create or replace function public.request_contact(p_listing_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, app
as $$
declare
  v_uid       uuid := auth.uid();
  v_tenant    uuid := app.current_tenant_id();
  v_listing   record;
  v_conv      record;
  v_conv_id   uuid;
begin
  if v_uid is null or v_tenant is null then
    raise exception 'AUTH_REQUIRED: necesitás una cuenta para contactar.';
  end if;

  select l.id, l.tenant_id, l.created_by, l.status
    into v_listing
    from public.listings l
   where l.id = p_listing_id;

  if not found or v_listing.tenant_id is distinct from v_tenant then
    raise exception 'LISTING_NOT_FOUND: el aviso no está disponible en tu comunidad.';
  end if;

  if v_listing.status <> 'published' then
    raise exception 'LISTING_NOT_AVAILABLE: el aviso ya no está publicado.';
  end if;

  if v_listing.created_by is null then
    raise exception 'LISTING_HAS_NO_ACCOUNT: quien publicó este aviso todavía no tiene cuenta en la comunidad, así que el chat no está disponible.';
  end if;

  if v_listing.created_by = v_uid then
    raise exception 'CANNOT_CONTACT_SELF: es tu propio aviso.';
  end if;

  if app.pair_blocked(v_uid, v_listing.created_by) then
    raise exception 'USER_BLOCKED: el contacto con esta persona no está disponible.';
  end if;

  select c.id, c.status, c.declined_at
    into v_conv
    from public.conversations c
   where c.listing_id = p_listing_id
     and c.created_by = v_uid;

  if found then
    if v_conv.status = 'declined' and app.solicitud_puede_reabrirse(v_conv.declined_at) then
      update public.conversations
         set status = 'pending'
       where id = v_conv.id
         and status = 'declined';
    end if;
    return v_conv.id;
  end if;

  begin
    insert into public.conversations (tenant_id, listing_id, created_by, counterpart_id, status)
    values (v_tenant, p_listing_id, v_uid, v_listing.created_by, 'pending')
    returning id into v_conv_id;
  exception
    when unique_violation then
      select c.id into v_conv_id
        from public.conversations c
       where c.listing_id = p_listing_id
         and c.created_by = v_uid;
  end;

  return v_conv_id;
end;
$$;

comment on function public.request_contact(uuid) is
  'Contacto protegido: crea (o devuelve) la conversación pending entre auth.uid() y el creador del listing published del MISMO tenant. Seed sin cuenta → LISTING_HAS_NO_ACCOUNT. Con bloqueo global (0020) → USER_BLOCKED, mismo mensaje en ambas direcciones. Si la contraparte la había descartado (0177) la reabre a pending sólo pasada la ventana app.dias_para_volver_a_pedir(); antes devuelve el mismo id sin tocar nada.';

revoke execute on function public.request_contact(uuid) from public, anon;
grant execute on function public.request_contact(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5 · solicitar_contacto_directo — re-creada COMPLETA (base: 0134 + 0135)
--
-- `blocked` sigue cortando (bloqueo de perfil y los "Ignorar" viejos); una
-- `declined` ya no: se trata como la pendiente que el creador cree que es.
-- ---------------------------------------------------------------------------
create or replace function public.solicitar_contacto_directo(p_profile_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_tenant  uuid := app.current_tenant_id();
  v_conv_id uuid;
  v_conv    record;
begin
  if v_uid is null or v_tenant is null then
    raise exception 'AUTH_REQUIRED: necesitás una cuenta para escribirle a alguien.';
  end if;

  if p_profile_id is null or p_profile_id = v_uid then
    raise exception 'CANNOT_CONTACT_SELF: no podés escribirte a vos mismo.';
  end if;

  if not exists (
    select 1 from public.profiles p
     where p.id = p_profile_id
       and p.tenant_id = v_tenant
  ) then
    raise exception 'PROFILE_NOT_FOUND: esa persona no está en tu comunidad.';
  end if;

  if app.pair_blocked(v_uid, p_profile_id) then
    raise exception 'USER_BLOCKED: el contacto con esta persona no está disponible.';
  end if;

  if exists (
    select 1 from public.conversations c
     where c.tenant_id = v_tenant
       and c.status = 'blocked'
       and (
         (c.created_by = v_uid and c.counterpart_id = p_profile_id)
         or (c.created_by = p_profile_id and c.counterpart_id = v_uid)
       )
  ) then
    raise exception 'USER_BLOCKED: el contacto con esta persona no está disponible.';
  end if;

  select c.id into v_conv_id
    from public.conversations c
   where c.tenant_id = v_tenant
     and c.status = 'accepted'
     and (
       (c.created_by = v_uid and c.counterpart_id = p_profile_id)
       or (c.created_by = p_profile_id and c.counterpart_id = v_uid)
     )
   order by c.created_at desc
   limit 1;

  if v_conv_id is not null then
    return v_conv_id;
  end if;

  select c.id into v_conv_id
    from public.conversations c
   where c.tenant_id = v_tenant
     and c.listing_id is null
     and c.status = 'pending'
     and (
       (c.created_by = v_uid and c.counterpart_id = p_profile_id)
       or (c.created_by = p_profile_id and c.counterpart_id = v_uid)
     )
   order by c.created_at desc
   limit 1;

  if v_conv_id is not null then
    return v_conv_id;
  end if;

  -- Mi directa descartada: el índice conversations_directa_uniq no deja crear
  -- otra, y para mí sigue "enviada". Se reabre sólo pasada la ventana.
  select c.id, c.declined_at
    into v_conv
    from public.conversations c
   where c.tenant_id = v_tenant
     and c.listing_id is null
     and c.status = 'declined'
     and c.created_by = v_uid
     and c.counterpart_id = p_profile_id;

  if found then
    if app.solicitud_puede_reabrirse(v_conv.declined_at) then
      update public.conversations
         set status = 'pending'
       where id = v_conv.id
         and status = 'declined';
    end if;
    return v_conv.id;
  end if;

  insert into public.conversations (tenant_id, listing_id, created_by, counterpart_id, status)
  values (v_tenant, null, v_uid, p_profile_id, 'pending')
  returning id into v_conv_id;

  return v_conv_id;
end;
$$;

comment on function public.solicitar_contacto_directo(uuid) is
  'Contacto protegido PERSONA→PERSONA (0134, 0177). Idempotente: devuelve la conversación aceptada entre los dos, si no la directa pendiente, si no MI directa descartada (reabierta a pending sólo pasada app.dias_para_volver_a_pedir()), y sólo si no hay ninguna crea una nueva en pending. NUNCA crea si hay bloqueo de perfil o una conversación blocked entre los dos, con el mismo mensaje para ambos casos.';

revoke execute on function public.solicitar_contacto_directo(uuid) from public, anon;
grant  execute on function public.solicitar_contacto_directo(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6 · contactar_aviso_de_ayuda — re-creada COMPLETA (base: 0120)
-- ---------------------------------------------------------------------------
create or replace function public.contactar_aviso_de_ayuda(p_notice uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, app
as $$
declare
  v_uid    uuid := auth.uid();
  v_tenant uuid := app.current_tenant_id();
  v_notice record;
  v_prev   record;
  v_conv   uuid;
begin
  if v_uid is null or v_tenant is null then
    raise exception 'AUTH_REQUIRED: necesitás tu cuenta para escribirle.';
  end if;

  select n.id, n.tenant_id, n.created_by, n.status
    into v_notice
    from public.community_help_notices n
   where n.id = p_notice;

  if not found
     or v_notice.tenant_id is distinct from v_tenant
     or v_notice.status <> 'approved' then
    raise exception 'NOTICE_NOT_FOUND: ese aviso no está disponible en tu comunidad.';
  end if;

  if v_notice.created_by = v_uid then
    raise exception 'CANNOT_CONTACT_SELF: es tu propio aviso.';
  end if;

  if app.pair_blocked(v_uid, v_notice.created_by) then
    raise exception 'USER_BLOCKED: el contacto con esta persona no está disponible.';
  end if;

  select c.id, c.status, c.declined_at
    into v_prev
    from public.conversations c
   where c.listing_id is null
     and c.created_by = v_uid
     and c.counterpart_id = v_notice.created_by;

  if found then
    if v_prev.status = 'declined' and app.solicitud_puede_reabrirse(v_prev.declined_at) then
      update public.conversations
         set status = 'pending'
       where id = v_prev.id
         and status = 'declined';
    end if;
    return v_prev.id;
  end if;

  begin
    insert into public.conversations (tenant_id, listing_id, created_by, counterpart_id, status)
    values (v_tenant, null, v_uid, v_notice.created_by, 'pending')
    returning id into v_conv;
  exception
    when unique_violation then
      select c.id into v_conv
        from public.conversations c
       where c.listing_id is null
         and c.created_by = v_uid
         and c.counterpart_id = v_notice.created_by;
  end;

  return v_conv;
end;
$$;

comment on function public.contactar_aviso_de_ayuda(uuid) is
  'Contacto protegido desde el tablón de ayuda mutua (0120): crea (o devuelve) la conversación pending y SIN aviso entre auth.uid() y quien publicó un aviso approved de la misma comunidad. Calco de request_contact — mismas verificaciones, mismos nombres de error, misma idempotencia, y desde la 0177 la misma reapertura de una solicitud descartada pasada la ventana.';

revoke execute on function public.contactar_aviso_de_ayuda(uuid) from public, anon;
grant execute on function public.contactar_aviso_de_ayuda(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7 · messages_insert — el creador sigue pudiendo escribir en su `declined`
--
-- Si no pudiera, el mensaje de presentación rebotaría justo después de un
-- descarte y ese error sería la señal de rechazo que se quiere evitar.
-- ---------------------------------------------------------------------------
drop policy if exists messages_insert on public.messages;

create policy messages_insert on public.messages
for insert to authenticated
with check (
  tenant_id = (select app.current_tenant_id())
  and sender_id = (select auth.uid())
  and exists (
    select 1 from public.conversations c
    where c.id = messages.conversation_id
      and c.tenant_id = messages.tenant_id
      and (
        (c.status = 'accepted' and (c.created_by = (select auth.uid()) or c.counterpart_id = (select auth.uid())))
        or (c.status in ('pending', 'declined') and c.created_by = (select auth.uid()))
      )
  )
);

-- ---------------------------------------------------------------------------
-- 8 · notifications sin anon
-- ---------------------------------------------------------------------------
revoke all on public.notifications from anon;

commit;
