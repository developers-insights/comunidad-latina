-- =============================================================================
-- 0045_notifications_categories.sql — Comunidad Latina
-- NOTIFICACIONES CATEGORIZADAS (feedback consolidado 2026-07-30 §2).
--
-- Hoy `notifications.kind` es text libre ("message", "contact_request",
-- "job_application", …) y la pantalla es una lista plana. La spec pide pestañas
-- con contadores, prioridad, preferencias por categoría, agrupación de
-- interacciones repetidas y "quitar de la bandeja" sin perder la actividad.
--
-- Qué se hace y por qué así:
--   1. `category` + `priority` como columnas con CHECK, NO derivadas de `kind`
--      en la app. Una pestaña que se calcula en el cliente no se puede indexar,
--      y el contador de no leídas por categoría es LA query que corre en cada
--      carga de la campanita.
--   2. `kind` NO se toca ni se deprecia: sigue siendo la etiqueta fina del
--      evento (y la clave de `dedupeUnread`). `category` es la agrupación
--      gruesa de la UI. Son dos ejes distintos; colapsarlos habría obligado a
--      reescribir los 7 emisores que ya existen.
--   3. `dismissed_at` = borrado LÓGICO. La policy de DELETE sigue existiendo,
--      pero quitar algo de la bandeja no debería destruir la constancia de que
--      pasó (y hoy borrar era la única salida).
--   4. `group_key` + índice parcial: "a 20 personas les gustó tu video" en una
--      fila, no 20.
--   5. `notification_prefs` — una fila por (tenant, persona, categoría).
--      seguridad/pagos/cuenta NO se pueden silenciar, y eso lo garantiza un
--      CHECK, no el hecho de que la UI no dibuje el interruptor.
--
-- BLINDAJE que faltaba: `notifications_update` (0011) autoriza al dueño a
-- actualizar SU fila — y una policy autoriza FILAS, no COLUMNAS. Sin la guarda
-- que se agrega abajo, cualquiera podía por PostgREST empujar su `expires_at`
-- al año 3000 y anular el TTL de 60 días (§5.4), o reescribirse el `category` y
-- desbalancear sus propios contadores. Después del INSERT lo único que se mueve
-- es `read_at` y `dismissed_at`.
-- =============================================================================


-- =============================================================================
-- 1 · notifications — categoría, prioridad, agrupación y borrado lógico
-- =============================================================================

alter table public.notifications
  add column category text not null default 'social'
    check (category in (
      'social', 'mensajes', 'trabajos', 'creator', 'marketplace', 'propiedades',
      'eventos', 'negocios', 'publicidad', 'pagos', 'seguridad', 'cuenta',
      'plataforma'
    )),
  add column priority text not null default 'normal'
    check (priority in ('low', 'normal', 'high', 'critical')),
  add column group_key text
    check (group_key is null or char_length(group_key) between 3 and 200),
  add column dismissed_at timestamptz;

comment on column public.notifications.category is
  'Agrupación GRUESA para las pestañas de /notificaciones (13 valores fijos). Convive con `kind`, que sigue siendo la etiqueta fina del evento y la clave de dedupeUnread — son dos ejes, no uno. La escribe el emisor (service_role); el dueño no puede cambiarla (app.notifications_freeze).';
comment on column public.notifications.priority is
  'low | normal | high | critical. Ordena el destaque visual y habilita "sólo importantes" en notification_prefs.frequency. NO cambia el canal ni la entrega: una crítica se ve igual de fuerte esté como esté la preferencia, porque las categorías críticas ni siquiera consultan preferencias.';
comment on column public.notifications.group_key is
  'CONTRATO: ''<kind>:<sujeto_kind>:<sujeto_id>'' — p. ej. ''reaction:post:019f39cf-…''. NULL = notificación individual (el caso normal, y el de todos los emisores existentes). Con valor, el emisor debe BUSCAR PRIMERO una fila viva con el mismo (tenant, profile, group_key) —la sirve notifications_group_live_idx— y ACTUALIZARLA (title/body/created_at) en vez de insertar otra. "Viva" = read_at is null and dismissed_at is null: una vez leída, la próxima interacción SÍ abre una fila nueva (si no, no te enterarías nunca más). El índice NO es unique a propósito: PostgREST no sabe emitir ON CONFLICT contra un índice parcial, y un unique acá convertiría cada carrera en una notificación perdida.';
comment on column public.notifications.dismissed_at is
  'Borrado LÓGICO desde la bandeja: la fila sigue existiendo (y sigue venciendo por TTL) pero la app la filtra. Se mantiene visible para la RLS a propósito — si la policy la escondiera, "deshacer" sería imposible. Todos los índices de bandeja son parciales sobre dismissed_at is null: la query correcta es la que usa el índice.';

-- ---------------------------------------------------------------------------
-- Backfill desde `kind`
--
-- El mapeo NO se inventó: sale de los 7 emisores reales del repo (grep de
-- createNotification en src/) y de los kinds que hoy existen en la base
-- (verificado: contact_request, job_application, message).
--
--   message              → mensajes    (chat)
--   contact_request      → mensajes    (crea una conversación: es el mismo hilo)
--   job_application      → trabajos    (te llegó una postulación)
--   job_application_update → trabajos  (movieron tu postulación)
--   post_promotion       → publicidad  (campaña de un post)
--   boost                → publicidad  (impulso de un aviso)
--   identity             → cuenta      (resultado de la verificación de identidad)
--   cualquier otro       → social      (el default de la columna)
--
-- `priority` NO se backfillea: el default 'normal' ya quedó aplicado en todas
-- las filas existentes por el ADD COLUMN, y ninguna notificación vieja es
-- crítica retroactivamente.
-- ---------------------------------------------------------------------------
update public.notifications
   set category = case kind
                    when 'message'                then 'mensajes'
                    when 'contact_request'        then 'mensajes'
                    when 'job_application'        then 'trabajos'
                    when 'job_application_update' then 'trabajos'
                    when 'post_promotion'         then 'publicidad'
                    when 'boost'                  then 'publicidad'
                    when 'identity'               then 'cuenta'
                    else 'social'
                  end;

-- ---------------------------------------------------------------------------
-- Índices: uno por query REAL de la pantalla, ni uno más.
--
-- Los dos de 0011 se re-crean porque su predicado quedó mintiendo: sin
-- `dismissed_at is null` seguirían apuntando filas que la bandeja ya no muestra.
-- ---------------------------------------------------------------------------

-- (a) Pestaña "Todas", con y sin el filtro "No leídas".
drop index public.notifications_profile_idx;
create index notifications_profile_idx
  on public.notifications (tenant_id, profile_id, created_at desc)
  where dismissed_at is null;

drop index public.notifications_inbox_idx;
create index notifications_inbox_idx
  on public.notifications (tenant_id, profile_id, created_at desc)
  where read_at is null and dismissed_at is null;

-- (b) Pestaña de UNA categoría (Social, Mensajes, Trabajos, …), ordenada por
--     fecha. Con `category` en el medio, este índice sirve la pestaña completa
--     y —filtrando read_at— también su versión "no leídas".
create index notifications_category_idx
  on public.notifications (tenant_id, profile_id, category, created_at desc)
  where dismissed_at is null;

-- (c) Los CONTADORES de las pestañas: count(*) group by category, sólo no
--     leídas. Es la query que corre en cada carga de la campanita, así que
--     tiene su propio índice parcial en vez de escanear también las leídas.
create index notifications_unread_by_category_idx
  on public.notifications (tenant_id, profile_id, category)
  where read_at is null and dismissed_at is null;

-- (d) Agrupación: encontrar la fila VIVA de un group_key para actualizarla.
create index notifications_group_live_idx
  on public.notifications (tenant_id, profile_id, group_key, created_at desc)
  where group_key is not null and read_at is null and dismissed_at is null;

-- ---------------------------------------------------------------------------
-- Blindaje: después del INSERT sólo se mueven read_at y dismissed_at
--
-- notifications_update (0011) le da al dueño UPDATE sobre su fila para marcarla
-- leída. Una policy autoriza FILAS, no COLUMNAS: sin esta guarda el dueño podía
--   * empujar `expires_at` y anular el TTL de 60 días (§5.4: el dato que se
--     borra rápido no es subpoenable después — un TTL que el usuario puede
--     correr no es un TTL);
--   * reescribir `category`/`priority` y desbalancear sus propios contadores;
--   * cambiar `href`/`title` de una notificación que emitió el sistema.
-- Nada de eso es un ataque a terceros, pero sí rompe garantías que otras partes
-- del sistema dan por ciertas.
--
-- CON bypass de service_role, y es necesario: el emisor agrupado (group_key)
-- actualiza title/body/created_at de una fila viva, y corre con admin client.
-- ---------------------------------------------------------------------------
create or replace function app.notifications_freeze()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.jwt() ->> 'role', 'service_role') = 'service_role' then
    return new;
  end if;
  if new.id           is distinct from old.id
     or new.tenant_id  is distinct from old.tenant_id
     or new.profile_id is distinct from old.profile_id
     or new.kind       is distinct from old.kind
     or new.title      is distinct from old.title
     or new.body       is distinct from old.body
     or new.href       is distinct from old.href
     or new.category   is distinct from old.category
     or new.priority   is distinct from old.priority
     or new.group_key  is distinct from old.group_key
     or new.created_at is distinct from old.created_at
     or new.expires_at is distinct from old.expires_at then
    raise exception 'PROTECTED_COLUMNS: de una notificación sólo podés cambiar read_at y dismissed_at';
  end if;
  return new;
end;
$$;

comment on function app.notifications_freeze() is
  'Congela todo el contenido de una notificación después del INSERT: el dueño sólo mueve read_at (leída/no leída) y dismissed_at (quitar de la bandeja). Cierra en particular la reescritura de expires_at, que anulaba el TTL de 60 días (§5.4). Bypass de service_role porque el emisor agrupado actualiza title/body/created_at de la fila viva de un group_key.';

create trigger notifications_freeze
before update on public.notifications
for each row execute function app.notifications_freeze();


-- =============================================================================
-- 2 · notification_prefs — qué recibo de cada categoría, y por dónde
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Una fila por (tenant, persona, categoría). AUSENCIA DE FILA = TODO PRENDIDO:
-- nadie nace con las notificaciones apagadas y no hay que sembrar 13 filas por
-- persona al registrarse.
--
-- `push` se guarda aunque todavía no exista Web Push (§2 FUERA DE ALCANCE: hace
-- falta VAPID + tabla de suscripciones). Guardarlo ahora es lo que hace que el
-- día que existan las claves sea cablear y no rediseñar la pantalla.
-- ---------------------------------------------------------------------------
create table public.notification_prefs (
  tenant_id  uuid not null references public.tenants(id),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  category   text not null
               check (category in (
                 'social', 'mensajes', 'trabajos', 'creator', 'marketplace',
                 'propiedades', 'eventos', 'negocios', 'publicidad', 'pagos',
                 'seguridad', 'cuenta', 'plataforma'
               )),
  in_app     boolean not null default true,
  email      boolean not null default true,
  push       boolean not null default false,
  frequency  text not null default 'all'
               check (frequency in ('all', 'important', 'digest', 'off')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Sin columna `id`: la PK ES la unicidad de la preferencia (mismo criterio
  -- que post_views 0038 y post_poll_votes 0041). `tenant_id` no entra en la PK
  -- porque una persona pertenece a UN tenant (profiles.tenant_id): agregarlo
  -- sugeriría que la misma persona puede tener preferencias distintas por
  -- comunidad, que es falso.
  constraint notification_prefs_one_per_category primary key (profile_id, category),

  -- LA REGLA DEL CLIENTE, EN LA BASE: seguridad, pagos y cuenta no se silencian.
  -- La spec dice "el interruptor no existe, no está deshabilitado con un
  -- cartel" — pero la UI no es una frontera: PostgREST acepta un PATCH directo.
  -- Se exige in_app y frequency='all'; `email` y `push` quedan libres porque
  -- elegir no recibir un mail no es silenciar la alerta, es elegir el canal.
  constraint notification_prefs_critical_always_on check (
    category not in ('seguridad', 'pagos', 'cuenta')
    or (in_app = true and frequency = 'all')
  )
);

comment on table public.notification_prefs is
  'Preferencias de notificación por (persona, categoría). LA AUSENCIA DE FILA SIGNIFICA TODO PRENDIDO (in_app, email, frequency=all): nadie nace silenciado y no se siembran 13 filas por registro. Las categorías críticas (seguridad, pagos, cuenta) no se pueden silenciar — lo garantiza notification_prefs_critical_always_on, y además el emisor NO debe consultar preferencias para esas tres: si alguien borrara su fila, el default sigue siendo recibirlas.';
comment on column public.notification_prefs.frequency is
  'all = todas · important = sólo priority in (high, critical) · digest = resumen diario por email (la preferencia se guarda; el cron que lo envía queda pendiente de Resend con dominio verificado, §2 FUERA DE ALCANCE) · off = ninguna. En categorías críticas sólo puede ser ''all''.';
comment on column public.notification_prefs.push is
  'Web Push. Default FALSE (a diferencia de in_app/email) porque todavía no hay claves VAPID ni tabla de suscripciones: prenderlo hoy no entrega nada. La columna existe para que activar push sea cablear y no rediseñar.';

-- La pantalla /ajustes/notificaciones lee las 13 filas de una persona de un
-- saque; la PK (profile_id, category) ya sirve ese scan. Sin índice extra:
-- ninguna query real busca por tenant sin persona.

create trigger notification_prefs_set_updated_at
before update on public.notification_prefs
for each row execute function extensions.moddatetime(updated_at);

alter table public.notification_prefs enable row level security;
alter table public.notification_prefs force row level security;

-- Tus preferencias son TUYAS: sin rama de staff ni de global_admin (mismo
-- criterio que notifications 0011, saves 0038 y post_poll_votes 0041). Que un
-- moderador pueda leer qué decidiste silenciar no le sirve para moderar nada.
create policy notification_prefs_select on public.notification_prefs
for select to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and profile_id = (select auth.uid())
);

create policy notification_prefs_insert on public.notification_prefs
for insert to authenticated
with check (
  tenant_id = (select app.current_tenant_id())
  and profile_id = (select auth.uid())
);

create policy notification_prefs_update on public.notification_prefs
for update to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and profile_id = (select auth.uid())
)
with check (
  tenant_id = (select app.current_tenant_id())
  and profile_id = (select auth.uid())
);

-- Borrar la fila = volver al default (todo prendido). Es una salida legítima y
-- no puede usarse para silenciar nada: el default es recibir.
create policy notification_prefs_delete on public.notification_prefs
for delete to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and profile_id = (select auth.uid())
);


-- =============================================================================
-- 3 · public.notification_counts — los contadores de las pestañas, en una query
-- =============================================================================

-- ---------------------------------------------------------------------------
-- La pantalla necesita el número de las 7 pestañas visibles MÁS el de "Más"
-- (que es la suma de las otras 6 categorías). Con 13 counts sueltos serían 13
-- round-trips; con esta RPC es uno.
--
-- SECURITY INVOKER: no hay nada que la RLS de notifications no resuelva ya
-- (dueño + tenant + no vencidas). Igual se repiten los filtros de forma
-- explícita — regla de la casa de 0014: una RPC nunca confía en que "el filtro
-- ya lo puso otro".
--
-- Devuelve SÓLO categorías con al menos una no leída. La app trata la ausencia
-- como 0: mandar 13 ceros en cada carga es tráfico que no dice nada.
-- ---------------------------------------------------------------------------
create or replace function public.notification_counts()
returns table (category text, unread int)
language sql
stable
security invoker
set search_path = ''
as $$
  select n.category, count(*)::int
    from public.notifications n
   where n.tenant_id = app.current_tenant_id()
     and n.profile_id = auth.uid()
     and n.read_at is null
     and n.dismissed_at is null
     and n.expires_at > now()
   group by n.category;
$$;

comment on function public.notification_counts() is
  'No leídas por categoría para las pestañas de /notificaciones, en una sola query. SECURITY INVOKER (la RLS de notifications ya es dueño+tenant; los filtros se repiten explícitos igual). Excluye descartadas (dismissed_at) y vencidas (expires_at). Sólo devuelve categorías con count > 0: la app trata la ausencia como 0.';

revoke execute on function public.notification_counts() from public;
grant execute on function public.notification_counts() to authenticated, service_role;
