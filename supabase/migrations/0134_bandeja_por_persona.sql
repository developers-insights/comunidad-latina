-- =============================================================================
-- 0134_bandeja_por_persona.sql — Comunidad Latina
--
-- «YO TE QUIERO MENSAJEAR A TI: BUSCO MANUEL NAVARRO Y TE MANDO UN MENSAJE.»
--
-- Pedido del cliente en la call del 3/9 (23:50–29:30, punto 7 del feedback).
-- Hoy la única puerta a un chat es un AVISO: `request_contact(p_listing_id)`
-- (0014). Desde el perfil de una persona, el botón "Enviar mensaje"
-- (`src/components/auth/message-cta.tsx`) muestra un toast que dice «muy
-- pronto». Esta migración es lo que hace falta para que deje de ser un cartel:
--
--   1. `buscar_personas_de_la_comunidad()` — el buscador de la bandeja.
--   2. `solicitar_contacto_directo()`      — abre o crea el chat 1-a-1.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 1. NO HACE FALTA TOCAR EL ESQUEMA DE `conversations`
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `conversations.listing_id` YA es nullable desde la 0006, y la policy
-- `conversations_insert` lo contempla con todas las letras («esta policy cubre
-- conversaciones directas»). El módulo de Empleos ya crea conversaciones así
-- (`startCandidateConversationAction`, 0040). O sea: el chat directo existía en
-- la base y no tenía puerta en la app. Esta migración pone la puerta.
--
-- Y NO se agrega un índice único sobre (created_by, counterpart_id) para las
-- directas, aunque a primera vista sería el gemelo de
-- `conversations_listing_requester_uniq`. Dos razones:
--   · el flujo de Empleos viene creando estas filas desde hace meses, así que
--     un único sobre datos vivos puede hacer fallar la migración en producción
--     por una fila que ya existe;
--   · la idempotencia real la da la RPC, que busca antes de crear. Y si dos
--     pestañas ganan la carrera y nacen dos filas, YA NO SE VE: la bandeja
--     ahora agrupa por PERSONA, así que las dos caen en la misma fila.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 2. "IGNORAR" TIENE QUE SEGUIR SIGNIFICANDO ALGO
-- ═══════════════════════════════════════════════════════════════════════════
--
-- En el inbox, "Ignorar" pone la conversación en `blocked` y la fila
-- desaparece. Si el buscador de personas pudiera abrir un hilo NUEVO con
-- alguien que ya te ignoró, ese botón dejaría de valer nada: bastaría con
-- buscar el nombre otra vez. Por eso `solicitar_contacto_directo()` mira si
-- hay alguna conversación `blocked` entre los dos y, si la hay, contesta el
-- MISMO error que un bloqueo de perfil — sin decir cuál de las dos cosas pasó,
-- porque "te ignoré" no es información que tenga que viajar de vuelta.
--
-- Es la diferencia con `request_contact()`, que no hace este chequeo: allá la
-- puerta es un aviso publicado (hay que ir a buscarlo, es una acción con
-- contexto) y acá la puerta es un buscador de nombres.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1 · buscar_personas_de_la_comunidad — el buscador de la bandeja
--
-- Existe en vez de reusar `global_search()` (0044/0052) porque acá sólo se
-- buscan PERSONAS: esa función además escanea las seis verticales de
-- `listings` con dos tsquery, y la bandeja dispara una consulta por tecla.
-- Se copia su rama de personas —tenant del JWT, ILIKE con comodines
-- escapados, orden por trigrama y `app.pair_blocked` en las dos direcciones—
-- y se le suma lo único que allá no tiene sentido: sacarme a MÍ de la lista.
-- No podés escribirte a vos mismo, así que verte en los resultados de "a quién
-- le escribo" es un callejón.
--
-- SECURITY INVOKER, como `global_search`: la RLS de cada tabla sigue decidiendo.
-- El filtro de tenant lo pone la función porque `profiles_select` es
-- `using(true)` — el perfil es contenido público por SEO — y acá se busca
-- DENTRO de la comunidad.
-- ---------------------------------------------------------------------------
create or replace function public.buscar_personas_de_la_comunidad(
  q       text,
  limite  int default 8
)
returns table (
  id                uuid,
  display_name      text,
  avatar_url        text,
  area_label        text,
  identity_verified boolean
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_uid    uuid := auth.uid();
  v_limit  int  := least(greatest(coalesce(limite, 8), 1), 20);
  v_q      text;
  v_like   text;
begin
  v_q := btrim(coalesce(q, ''));
  -- Vacío y no error, igual que global_search: el buscador dispara solo
  -- mientras se escribe, y un 400 con dos letras se vería como "se rompió".
  if char_length(v_q) < 2 or v_tenant is null or v_uid is null then
    return;
  end if;
  v_q := left(v_q, 80);

  -- Comodines del usuario escapados: sin esto, buscar "100%" matchearía a
  -- toda la comunidad.
  v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  return query
  select p.id,
         p.display_name,
         p.avatar_url,
         p.area_label,
         p.identity_verified
    from public.profiles p
   where p.tenant_id = v_tenant
     and p.id <> v_uid
     and p.display_name ilike v_like escape '\'
     and not app.pair_blocked(v_uid, p.id)
   order by extensions.similarity(p.display_name, v_q) desc, p.display_name
   limit v_limit;
end;
$$;

comment on function public.buscar_personas_de_la_comunidad(text, int) is
  'Buscador de PERSONAS de la bandeja de Mensajes (0134). Es la rama de personas de global_search() (0044/0052) aislada —esa función además escanea las seis verticales de listings y acá se dispara una consulta por tecla— más el filtro que allá no aplica: saca a quien busca de sus propios resultados. Devuelve VACÍO, no error, con menos de 2 caracteres o sin sesión. Nunca devuelve a alguien con quien haya bloqueo en cualquier dirección: el buscador no puede ser la puerta de atrás que trae de vuelta a quien bloqueaste.';

revoke all    on function public.buscar_personas_de_la_comunidad(text, int) from public, anon;
grant execute on function public.buscar_personas_de_la_comunidad(text, int) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 2 · solicitar_contacto_directo — abrir o crear el chat 1-a-1
--
-- Idempotente y en este orden de preferencia:
--
--   (a) ¿Ya hay una conversación ACEPTADA entre los dos (por un aviso o
--       directa)? Se devuelve ESA. Es lo que espera cualquier persona: busco a
--       Ramón, toco "Enviar mensaje" y caigo en la charla que ya tenemos, no
--       en una segunda solicitud pendiente al lado de la que ya funciona.
--   (b) ¿Hay una directa pendiente? Se devuelve esa — no se apila otra.
--   (c) Si no hay ninguna: nace una directa `pending`, igual que cualquier
--       contacto protegido (§9.2). La contraparte acepta o ignora.
--
-- Lo que NO hace: crear si hay una `blocked` entre los dos (§2 de la cabecera).
-- ---------------------------------------------------------------------------
create or replace function public.solicitar_contacto_directo(p_profile_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, app
as $$
declare
  v_uid     uuid := auth.uid();
  v_tenant  uuid := app.current_tenant_id();
  v_conv_id uuid;
begin
  if v_uid is null or v_tenant is null then
    raise exception 'AUTH_REQUIRED: necesitás una cuenta para escribirle a alguien.';
  end if;

  if p_profile_id is null or p_profile_id = v_uid then
    raise exception 'CANNOT_CONTACT_SELF: no podés escribirte a vos mismo.';
  end if;

  -- Existencia y tenant en la MISMA condición: "no existe" y "es de otra
  -- comunidad" contestan lo mismo, para no filtrar por diferencia de errores
  -- quién hay del otro lado.
  if not exists (
    select 1 from public.profiles p
     where p.id = p_profile_id
       and p.tenant_id = v_tenant
  ) then
    raise exception 'PROFILE_NOT_FOUND: esa persona no está en tu comunidad.';
  end if;

  -- Bloqueo de perfil (0020), en cualquier dirección. MISMO mensaje en las dos
  -- para no filtrar quién bloqueó a quién.
  if app.pair_blocked(v_uid, p_profile_id) then
    raise exception 'USER_BLOCKED: el contacto con esta persona no está disponible.';
  end if;

  -- "Ignorar" tiene que seguir significando algo (§2). Mismo texto que arriba.
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

  -- (a) Una charla YA aceptada, en cualquier dirección y por cualquier motivo.
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

  -- (b) Una directa pendiente, en cualquier dirección.
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

  -- (c) Nace pendiente. El trigger app.enforce_account_active() (0021) sigue
  -- cubriendo el INSERT: una cuenta suspendida no abre conversaciones.
  insert into public.conversations (tenant_id, listing_id, created_by, counterpart_id, status)
  values (v_tenant, null, v_uid, p_profile_id, 'pending')
  returning id into v_conv_id;

  return v_conv_id;
end;
$$;

comment on function public.solicitar_contacto_directo(uuid) is
  'Contacto protegido PERSONA→PERSONA (0134), la puerta que le faltaba al buscador de la bandeja y al botón "Enviar mensaje" del perfil. Idempotente: devuelve la conversación aceptada que ya exista entre los dos (por un aviso o directa), si no la directa pendiente, y sólo si no hay ninguna crea una nueva en pending. NUNCA crea si hay bloqueo de perfil o si alguna conversación entre los dos quedó en blocked ("Ignorar" del inbox) — con el mismo mensaje para los dos casos, porque cuál de las dos pasó no es información que deba viajar de vuelta.';

revoke execute on function public.solicitar_contacto_directo(uuid) from public, anon;
grant  execute on function public.solicitar_contacto_directo(uuid) to authenticated, service_role;

commit;
