-- =============================================================================
-- 0055_metricas_admin.sql — Comunidad Latina
-- Tablero de métricas del panel admin (Semana 11): "cuánta gente entra,
-- publica y se contacta", con su evolución día a día.
--
-- QUÉ ES Y QUÉ NO ES
-- ------------------
-- Este archivo NO crea tablas ni guarda un solo dato nuevo: agrega lo que ya
-- existe. No hay tabla de "eventos de analytics" ni de sesiones, y no se crea
-- a propósito — §5.4 (anti-honeypot) manda minimizar, no acumular. Todo lo que
-- devuelve esta RPC son CONTEOS: nunca ids de personas, nunca nombres, nunca
-- una lista de quién hizo qué. Un tablero de conteos no necesita PII y por lo
-- tanto no la toca.
--
-- POR QUÉ UNA RPC Y NO QUERIES DESDE LA APP
-- -----------------------------------------
-- Contar "personas distintas" exige DISTINCT sobre doce orígenes. Traer esas
-- filas al server de Next para contarlas ahí sería mover miles de ids de
-- personas por la red para tirarlos después: caro y, sobre todo, exactamente
-- el tipo de dato que no queremos que salga de Postgres. La agregación vive en
-- SQL y del otro lado sólo cruzan números.
--
-- AUTORIZACIÓN
-- ------------
-- `security definer` corre con permisos del owner, así que la RLS de las doce
-- tablas NO aplica adentro: el chequeo de rol y el scope de tenant están
-- escritos en el cuerpo de la función y son la única barrera. No se confía en
-- que la UI haya filtrado antes — un member puede llamar la RPC directo por
-- PostgREST y tiene que rebotar ahí. Mismo idioma que admin_restrict_user
-- (0033): rol desde el JWT (app.current_user_role()), nunca profiles.role.
--
-- EL DÍA ES UTC, Y NO ES UN DESCUIDO
-- ----------------------------------
-- post_views.viewed_on y listing_views.viewed_on son `date` grabados con
-- current_date del servidor (UTC) — el instante exacto no se guarda, por
-- minimización (0038/0050). Ese día ya no se puede re-derivar a otro huso.
-- Para que las doce fuentes corten el día en el MISMO lugar, las que sí tienen
-- timestamptz también se llevan a día UTC. Alternativa descartada: cortar en
-- America/New_York las que se puede y dejar las vistas en UTC — daría un
-- tablero donde dos hechos simultáneos caen en días distintos. La pantalla
-- dice en voz alta que el día cierra a la medianoche UTC.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- 1 · Índices para el barrido (tenant, tiempo)
--
-- La RPC hace, por cada origen, UN barrido de rango sobre (tenant_id, tiempo).
-- Casi todos los índices que ya existían tienen otra columna en el medio
-- (author_id, post_id, job_id…) porque servían a la pantalla del dueño, no a
-- un corte temporal: sirven para "lo de esta persona", no para "lo de estos 30
-- días". Sin estos índices el tablero degrada a seq scan de la tabla entera.
--
-- `if not exists` en todos: la migración tiene que poder re-correrse.
-- Los dos de vistas incluyen viewer_id al final para que el count(distinct)
-- se resuelva index-only, sin ir al heap.
-- ---------------------------------------------------------------------------

create index if not exists post_views_tenant_day_idx
  on public.post_views (tenant_id, viewed_on, viewer_id);

create index if not exists listing_views_tenant_day_idx
  on public.listing_views (tenant_id, viewed_on, viewer_id);

create index if not exists posts_tenant_created_idx
  on public.posts (tenant_id, created_at);

create index if not exists reactions_tenant_created_idx
  on public.reactions (tenant_id, created_at);

create index if not exists comments_tenant_created_idx
  on public.comments (tenant_id, created_at);

create index if not exists listing_comments_tenant_created_idx
  on public.listing_comments (tenant_id, created_at);

create index if not exists saves_tenant_created_idx
  on public.saves (tenant_id, created_at);

create index if not exists post_poll_votes_tenant_created_idx
  on public.post_poll_votes (tenant_id, created_at);

create index if not exists conversations_tenant_created_idx
  on public.conversations (tenant_id, created_at);

create index if not exists messages_tenant_created_idx
  on public.messages (tenant_id, created_at);

create index if not exists job_applications_tenant_created_idx
  on public.job_applications (tenant_id, created_at);

comment on index public.post_views_tenant_day_idx is
  'Barrido por (tenant, día) del tablero de métricas (0055). Cubre viewer_id para que count(distinct) salga index-only. El índice viejo post_views_post_idx tiene post_id en el medio: sirve al conteo de UN post, no al corte por fecha.';
comment on index public.conversations_tenant_created_idx is
  'Barrido por (tenant, fecha) del tablero de métricas (0055) — "cuánta gente se contacta". Los índices viejos llevan created_by/counterpart_id en el medio: sirven a la bandeja de una persona, no al corte temporal.';


-- ---------------------------------------------------------------------------
-- 2 · admin_metrics_overview — los tres números y su serie diaria
--
-- Devuelve jsonb (no `returns table`) porque son tres cosas de forma distinta
-- en una sola ida: totales de la ventana, totales de la ventana anterior para
-- comparar, y la serie día por día. Partirlo en tres RPC serían tres barridos
-- de las mismas doce tablas.
--
-- p_tenant_id null + global_admin = todas las comunidades sumadas.
-- p_tenant_id null + domain_admin = su propia comunidad (nunca "todas").
-- ---------------------------------------------------------------------------

create or replace function public.admin_metrics_overview(
  p_tenant_id uuid default null,
  p_days      int  default 30
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := auth.uid();
  v_role      text := app.current_user_role();
  v_jwt_tid   uuid := app.current_tenant_id();
  v_tenant    uuid;
  v_to        date;
  v_from      date;
  v_prev_from date;
  -- Bordes en timestamptz: el filtro sobre created_at tiene que ser sargable
  -- (columna desnuda contra constante). Comparar
  -- `(created_at at time zone 'UTC')::date` mataría los índices de arriba.
  v_lo_ts     timestamptz;
  v_hi_ts     timestamptz;
  v_result    jsonb;
begin
  -- --- Autorización (la RLS no corre acá: esto ES el control de acceso) -----
  if v_uid is null then
    raise exception 'AUTH_REQUIRED: necesitás una cuenta.'
      using errcode = '42501';
  end if;

  -- moderator NO entra: modera contenido, no mira los números del negocio.
  if v_role not in ('domain_admin', 'global_admin') then
    raise exception 'FORBIDDEN: necesitás permisos de administración.'
      using errcode = '42501';
  end if;

  if p_days not in (7, 30, 90) then
    raise exception 'INVALID_RANGE: la ventana es de 7, 30 o 90 días.'
      using errcode = '22023';
  end if;

  -- --- Scope de tenant ------------------------------------------------------
  -- El domain_admin queda clavado al tenant de SU JWT. Pedir otro no devuelve
  -- vacío: revienta. Un 403 explícito es más honesto que un cero que se puede
  -- confundir con "esa comunidad no tiene actividad".
  if v_role = 'global_admin' then
    v_tenant := p_tenant_id;              -- null = todas las comunidades
  else
    if v_jwt_tid is null then
      raise exception 'FORBIDDEN: tu cuenta no tiene comunidad asignada.'
        using errcode = '42501';
    end if;
    if p_tenant_id is not null and p_tenant_id <> v_jwt_tid then
      raise exception 'FORBIDDEN: solo podés ver los números de tu comunidad.'
        using errcode = '42501';
    end if;
    v_tenant := v_jwt_tid;
  end if;

  -- --- Ventanas -------------------------------------------------------------
  -- La ventana INCLUYE hoy (que va a estar incompleto: son las horas que van
  -- del día, no un día entero — la pantalla lo aclara).
  v_to        := (now() at time zone 'UTC')::date;
  v_from      := v_to - (p_days - 1);
  v_prev_from := v_from - p_days;          -- ventana anterior, mismo largo
  v_lo_ts     := (v_prev_from::timestamp) at time zone 'UTC';
  v_hi_ts     := ((v_to + 1)::timestamp) at time zone 'UTC';

  with
  -- =========================================================================
  -- ev — un renglón por HECHO: (día UTC, persona, tipo)
  --
  -- Se barre una sola vez el rango ventana+ventana-anterior y de acá salen
  -- las tres métricas, sus totales, los del período previo y la serie.
  --
  -- kind:
  --   'activity' → sólo prueba que la persona estuvo (no se cuenta volumen)
  --   'publish'  → publicación (cuenta personas Y volumen)
  --   'contact'  → contacto iniciado (cuenta personas Y volumen)
  -- Los 'publish' y 'contact' también son actividad: al contar "entra" se
  -- toman los tres kinds.
  -- =========================================================================
  ev as (
    -- ---- Rastro de uso: abrió un video del feed ----------------------------
    select pv.viewed_on as d, pv.viewer_id as person, 'activity'::text as kind
      from public.post_views pv
     where (v_tenant is null or pv.tenant_id = v_tenant)
       and pv.viewed_on between v_prev_from and v_to

    union all
    -- ---- Rastro de uso: abrió el detalle de un aviso -----------------------
    select lv.viewed_on, lv.viewer_id, 'activity'
      from public.listing_views lv
     where (v_tenant is null or lv.tenant_id = v_tenant)
       and lv.viewed_on between v_prev_from and v_to

    union all
    -- ---- Participación: reaccionó -----------------------------------------
    select (r.created_at at time zone 'UTC')::date, r.profile_id, 'activity'
      from public.reactions r
     where (v_tenant is null or r.tenant_id = v_tenant)
       and r.created_at >= v_lo_ts and r.created_at < v_hi_ts

    union all
    -- ---- Participación: comentó un post -----------------------------------
    select (c.created_at at time zone 'UTC')::date, c.author_id, 'activity'
      from public.comments c
     where (v_tenant is null or c.tenant_id = v_tenant)
       and c.created_at >= v_lo_ts and c.created_at < v_hi_ts

    union all
    -- ---- Participación: comentó un aviso ----------------------------------
    select (lc.created_at at time zone 'UTC')::date, lc.author_id, 'activity'
      from public.listing_comments lc
     where (v_tenant is null or lc.tenant_id = v_tenant)
       and lc.created_at >= v_lo_ts and lc.created_at < v_hi_ts

    union all
    -- ---- Participación: guardó algo ---------------------------------------
    select (s.created_at at time zone 'UTC')::date, s.profile_id, 'activity'
      from public.saves s
     where (v_tenant is null or s.tenant_id = v_tenant)
       and s.created_at >= v_lo_ts and s.created_at < v_hi_ts

    union all
    -- ---- Participación: votó una encuesta ---------------------------------
    -- El voto es secreto (0041): acá sólo se usa que HUBO voto de esa persona
    -- ese día. `choice` no se lee ni se devuelve.
    select (v.created_at at time zone 'UTC')::date, v.voter_id, 'activity'
      from public.post_poll_votes v
     where (v_tenant is null or v.tenant_id = v_tenant)
       and v.created_at >= v_lo_ts and v.created_at < v_hi_ts

    union all
    -- ---- Participación: se postuló a un empleo ----------------------------
    -- Cuenta como actividad, NO como "contacto": Empleos tiene su propio
    -- embudo y su propio panel. Mezclarlo inflaría "se contacta" con un
    -- número que se mide en otra pantalla.
    select (ja.created_at at time zone 'UTC')::date, ja.applicant_id, 'activity'
      from public.job_applications ja
     where (v_tenant is null or ja.tenant_id = v_tenant)
       and ja.created_at >= v_lo_ts and ja.created_at < v_hi_ts

    union all
    -- ---- Participación: escribió en una conversación -----------------------
    -- OJO §5.4: messages tiene TTL de 90 días y pg_cron los purga (0013). Los
    -- mensajes viejos DESAPARECEN, así que este origen sólo aporta señal
    -- dentro de la ventana viva. Se asume: retener para que un gráfico quede
    -- lindo sería exactamente lo que el producto promete no hacer. `body`
    -- jamás se toca — sólo sender_id y la fecha.
    select (m.created_at at time zone 'UTC')::date, m.sender_id, 'activity'
      from public.messages m
     where (v_tenant is null or m.tenant_id = v_tenant)
       and m.created_at >= v_lo_ts and m.created_at < v_hi_ts

    union all
    -- ---- PUBLICA: escribió en el feed -------------------------------------
    -- Todos los status. Un post que moderación bajó DESPUÉS igual fue
    -- publicado ese día: si filtráramos por status='published', el número del
    -- mes pasado cambiaría cada vez que se modera algo hoy, y una métrica que
    -- se reescribe hacia atrás no se puede discutir en una reunión.
    select (p.created_at at time zone 'UTC')::date, p.author_id, 'publish'
      from public.posts p
     where (v_tenant is null or p.tenant_id = v_tenant)
       and p.created_at >= v_lo_ts and p.created_at < v_hi_ts

    union all
    -- ---- PUBLICA: cargó un aviso ------------------------------------------
    -- `status <> 'draft'`: el alta crea el aviso en draft y recién al terminar
    -- el formulario pasa a pending_review/published — un draft abandonado es
    -- un formulario a medias, no una publicación.
    -- `source = 'user'`: los avisos sembrados por el equipo (seed/API) no son
    -- gente de la comunidad publicando. Son 23 de 59 hoy: contarlos duplicaría
    -- el número por la mitad.
    select (l.created_at at time zone 'UTC')::date, l.created_by, 'publish'
      from public.listings l
     where (v_tenant is null or l.tenant_id = v_tenant)
       and l.created_at >= v_lo_ts and l.created_at < v_hi_ts
       and l.status <> 'draft'
       and l.source = 'user'
       and l.created_by is not null

    union all
    -- ---- CONTACTA: pidió contacto (abrió una conversación) ------------------
    -- Se cuenta a QUIEN INICIA (created_by), que es el hecho que mide interés.
    -- RETENCIÓN §5.4: pg_cron borra conversaciones de +90 días sin mensajes
    -- vivos (0013), así que la ventana de 90 días es también el límite real de
    -- lo que se puede mirar hacia atrás.
    select (cv.created_at at time zone 'UTC')::date, cv.created_by, 'contact'
      from public.conversations cv
     where (v_tenant is null or cv.tenant_id = v_tenant)
       and cv.created_at >= v_lo_ts and cv.created_at < v_hi_ts
  ),

  -- Sólo la ventana actual.
  cur as (select * from ev where d >= v_from),
  -- Sólo la ventana anterior, del mismo largo.
  prev as (select * from ev where d < v_from),

  -- Esqueleto de días de la ventana (incluye los vacíos).
  cal as (
    select gs::date as d
      from generate_series(v_from, v_to, interval '1 day') gs
  ),

  -- Totales de cada ventana en UNA pasada por CTE (no tres).
  tot as (
    select count(distinct person)                                as active,
           count(distinct person) filter (where kind = 'publish') as publishers,
           count(distinct person) filter (where kind = 'contact') as contacters,
           count(*) filter (where kind = 'publish')               as publications,
           count(*) filter (where kind = 'contact')               as contacts
      from cur
  ),
  tot_prev as (
    select count(distinct person)                                as active,
           count(distinct person) filter (where kind = 'publish') as publishers,
           count(distinct person) filter (where kind = 'contact') as contacters
      from prev
  ),

  -- Una sola pasada agrupada. Antes esto eran tres subqueries correlacionadas
  -- por día: con 90 días, 270 barridos del mismo CTE para el mismo resultado.
  por_dia as (
    select d,
           count(distinct person)                                as active,
           count(distinct person) filter (where kind = 'publish') as publishers,
           count(distinct person) filter (where kind = 'contact') as contacters
      from cur
     group by d
  ),

  -- El left join contra el calendario es lo que convierte "no hay filas" en un
  -- CERO EXPLÍCITO. Un día sin actividad tiene que dibujarse como cero, no
  -- desaparecer: si desaparece, el gráfico une el día 3 con el día 8 en línea
  -- recta y el hueco se lee como continuidad.
  serie as (
    select cal.d,
           coalesce(pd.active, 0)     as active,
           coalesce(pd.publishers, 0) as publishers,
           coalesce(pd.contacters, 0) as contacters
      from cal
      left join por_dia pd on pd.d = cal.d
  ),

  -- Contactos que la otra parte ACEPTÓ. Se mira el estado de hoy de las
  -- conversaciones abiertas en la ventana: no hay historial de transiciones,
  -- así que esto es "de los contactos de este período, cuántos prosperaron
  -- hasta ahora" — no "cuántos se aceptaron en este período".
  aceptados as (
    select count(*) as n
      from public.conversations cv
     where (v_tenant is null or cv.tenant_id = v_tenant)
       and cv.created_at >= (v_from::timestamp) at time zone 'UTC'
       and cv.created_at < v_hi_ts
       and cv.status = 'accepted'
  ),

  -- Cuentas nuevas: aparte a propósito. "Entra" es gente usando la app;
  -- "se suma" es gente creando cuenta. Confundirlas es el error clásico de
  -- estos tableros, así que van como dos números distintos.
  nuevos as (
    select
      count(*) filter (
        where pr.created_at >= (v_from::timestamp) at time zone 'UTC'
      ) as n_cur,
      count(*) filter (
        where pr.created_at < (v_from::timestamp) at time zone 'UTC'
      ) as n_prev
      from public.profiles pr
     where (v_tenant is null or pr.tenant_id = v_tenant)
       and pr.created_at >= v_lo_ts and pr.created_at < v_hi_ts
  )

  select jsonb_build_object(
    'tenant_id',    v_tenant,
    'days',         p_days,
    'from',         v_from,
    'to',           v_to,
    'generated_at', now(),
    'totals', jsonb_build_object(
      'active',            (select active from tot),
      'publishers',        (select publishers from tot),
      'contacters',        (select contacters from tot),
      'publications',      (select publications from tot),
      'contacts',          (select contacts from tot),
      'accepted_contacts', (select n from aceptados),
      'new_members',       (select n_cur from nuevos)
    ),
    'previous', jsonb_build_object(
      'active',      (select active from tot_prev),
      'publishers',  (select publishers from tot_prev),
      'contacters',  (select contacters from tot_prev),
      'new_members', (select n_prev from nuevos)
    ),
    'series', coalesce(
      (select jsonb_agg(
                jsonb_build_object(
                  'day',        s.d,
                  'active',     s.active,
                  'publishers', s.publishers,
                  'contacters', s.contacters
                ) order by s.d)
         from serie s),
      '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;

comment on function public.admin_metrics_overview(uuid, int) is
  'Tablero de métricas del panel admin (0055): personas activas / que publican / que contactan, con totales, período anterior y serie diaria. SÓLO CONTEOS — nunca ids ni nombres de personas (§5.4). Rol domain_admin+ verificado ADENTRO (security definer ⇒ la RLS no corre); domain_admin queda clavado a su tenant, global_admin puede pasar cualquiera o null = todas. Días cortados en UTC porque post_views/listing_views guardan `date`, no timestamp.';

-- El default de PostgREST es que cualquiera con token pueda ejecutar. Se
-- revoca de public/anon y se otorga sólo a authenticated: el gate de rol vive
-- adentro, pero un anónimo ni siquiera llega a él.
revoke execute on function public.admin_metrics_overview(uuid, int) from public, anon;
grant execute on function public.admin_metrics_overview(uuid, int) to authenticated, service_role;
