begin;

-- =============================================================================
-- 0151 · De qué te está hablando la notificación
-- =============================================================================
--
-- Dos reclamos del cliente, una sola causa: la fila de `notifications` guarda un
-- texto y un `href`, pero no QUÉ la originó.
--
--  1. «Las notificaciones cuando las apretás no funcionan, no sabés de qué
--     notificación te está hablando» — los dos emisores de vencimiento (0098)
--     escribían el href fijo '/publicaciones'. Veinte avisos distintos, un solo
--     destino.
--  2. «Los logitos de dónde vienen las publicaciones» — sin entidad no hay ni
--     miniatura ni vertical: el ícono sólo podía salir de `category`, y para
--     estos dos kinds la categoría es 'vencimientos' (un reloj para todo).
--
-- POR QUÉ COLUMNAS DENORMALIZADAS Y NO UN JOIN AL RENDER
-- ------------------------------------------------------
-- La entidad es POLIMÓRFICA (listing, post, perfil, conversación): no hay FK que
-- PostgREST pueda embeber, así que un join significaría una consulta por
-- entity_type en cada apertura de la campana. Peor: la RLS de `listings` esconde
-- lo que ya no está publicado, así que el aviso "tu publicación venció" perdería
-- la miniatura justo cuando más contexto hace falta.
--
-- Y hay una razón que no es de performance: una notificación es el REGISTRO DE UN
-- HECHO PASADO. `title` y `body` ya están congelados en la fila — nadie hace join
-- para el título. La miniatura sigue el mismo criterio: si mañana se borra la
-- foto o el aviso, la notificación vieja conserva lo que mostraba.
--
-- `image_url` guarda el valor CRUDO de `listings.photos` (path del bucket o URL
-- absoluta de seed), NO la URL pública resuelta: la base no tiene por qué saber
-- en qué proyecto de Supabase vive: eso lo arma `listingPhotoUrl()` en la app.
-- =============================================================================

alter table public.notifications
  add column if not exists entity_type text,
  add column if not exists entity_id   uuid,
  add column if not exists entity_kind text,
  add column if not exists image_url   text;

-- Enumeración cerrada, igual que `category` (0045): sumar un tipo de entidad es
-- un ALTER de este CHECK, y eso es deliberado — que cueste una migración obliga a
-- decidir el ícono y el destino del click en el mismo movimiento.
alter table public.notifications
  drop constraint if exists notifications_entity_type_check;
alter table public.notifications
  add constraint notifications_entity_type_check
  check (
    entity_type is null
    or entity_type in ('listing', 'post', 'profile', 'conversation', 'job_application')
  );

-- Un id sin tipo no se puede resolver y un tipo sin id no apunta a nada: las dos
-- mitades viajan juntas o no viaja ninguna.
alter table public.notifications
  drop constraint if exists notifications_entity_completa_check;
alter table public.notifications
  add constraint notifications_entity_completa_check
  check ((entity_type is null) = (entity_id is null));

-- `entity_kind` NO lleva enumeración: su vocabulario depende de `entity_type`
-- (para 'listing' es el vertical, y esa lista ya vive en `listings.kind`).
-- Duplicarla acá crearía una segunda fuente de verdad que se desincroniza sola.
-- El CHECK valida FORMA, que es lo único que este nivel puede afirmar.
alter table public.notifications
  drop constraint if exists notifications_entity_kind_check;
alter table public.notifications
  add constraint notifications_entity_kind_check
  check (entity_kind is null or entity_kind ~ '^[a-z][a-z0-9_]{0,31}$');

-- El valor termina en el `src` de una imagen. El freeze de abajo impide que el
-- dueño lo reescriba, pero un emisor con un bug no debería poder guardar un
-- esquema ejecutable ni un blob gigante.
alter table public.notifications
  drop constraint if exists notifications_image_url_check;
alter table public.notifications
  add constraint notifications_image_url_check
  check (
    image_url is null
    or (length(image_url) <= 2048 and image_url !~* '^\s*(javascript|data|vbscript):')
  );

comment on column public.notifications.entity_type is
  'Qué clase de cosa originó el aviso (0151). Con entity_id forma el par polimórfico que la UI usa para el ícono del módulo y el destino del click. Enumeración cerrada por CHECK.';
comment on column public.notifications.entity_id is
  'Id de la entidad que originó el aviso (0151). SIN foreign key a propósito: la notificación sobrevive al borrado de lo que la originó — es el registro de un hecho pasado, no una vista de la fila viva.';
comment on column public.notifications.entity_kind is
  'Sub-tipo de la entidad (0151). Para entity_type=''listing'' es el vertical (property, job, event…) y es lo que da el ícono del módulo: la categoría no alcanza, porque las catorce notificaciones de vencimiento caen todas en ''vencimientos''.';
comment on column public.notifications.image_url is
  'Miniatura DENORMALIZADA al momento de emitir (0151). Guarda el valor crudo de listings.photos (path del bucket o URL absoluta), no la URL pública resuelta: la base no conoce el proyecto de Supabase en el que corre. Denormalizada y no por join porque la entidad es polimórfica (no hay FK que embeber) y porque la RLS esconde lo que dejó de estar publicado.';

-- Los GRANT de esta tabla son a nivel TABLA, así que las cuatro columnas quedan
-- cubiertas solas. Se repiten igual porque una columna nueva sin GRANT deja a la
-- policy sin evaluarse y la app se vacía SIN error — ya pasó en este repo, y el
-- costo de re-afirmarlo es cero.
grant select on public.notifications to authenticated, service_role;
grant insert, update on public.notifications to service_role;

-- ---------------------------------------------------------------------------
-- El freeze enumera columnas: sin estas cuatro líneas el dueño podía reescribir
-- la miniatura y el destino de su propia notificación.
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
     or new.tenant_id   is distinct from old.tenant_id
     or new.profile_id  is distinct from old.profile_id
     or new.kind        is distinct from old.kind
     or new.title       is distinct from old.title
     or new.body        is distinct from old.body
     or new.href        is distinct from old.href
     or new.category    is distinct from old.category
     or new.priority    is distinct from old.priority
     or new.group_key   is distinct from old.group_key
     or new.created_at  is distinct from old.created_at
     or new.expires_at  is distinct from old.expires_at
     or new.entity_type is distinct from old.entity_type
     or new.entity_id   is distinct from old.entity_id
     or new.entity_kind is distinct from old.entity_kind
     or new.image_url   is distinct from old.image_url then
    raise exception 'PROTECTED_COLUMNS: de una notificación sólo podés cambiar read_at y dismissed_at';
  end if;
  return new;
end;
$$;

comment on function app.notifications_freeze() is
  'Congela todo el contenido de una notificación después del INSERT: el dueño sólo mueve read_at (leída/no leída) y dismissed_at (quitar de la bandeja). Cierra en particular la reescritura de expires_at, que anulaba el TTL de 60 días (§5.4), y desde 0151 la de entity_*/image_url, que terminan en el href y en el src de una imagen. Bypass de service_role porque el emisor agrupado actualiza title/body/created_at de la fila viva de un group_key.';

-- ---------------------------------------------------------------------------
-- La primera foto utilizable de un aviso
-- ---------------------------------------------------------------------------
create or replace function app.primera_foto(p_photos text[])
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select f
    from unnest(coalesce(p_photos, '{}'::text[])) as f
   where f is not null and btrim(f) <> ''
   limit 1
$$;

comment on function app.primera_foto(text[]) is
  'Primera foto no vacía de listings.photos, o null (0151). Espeja firstPhotoUrl() de src/components/listings/helpers.ts salvo por la resolución a URL pública, que sigue siendo del lado de la app.';

revoke all on function app.primera_foto(text[]) from public, anon;
grant execute on function app.primera_foto(text[]) to authenticated, service_role;

-- =============================================================================
-- Los dos emisores de vencimiento, ahora con destino propio
-- =============================================================================
-- Cambia el href (de '/publicaciones' fijo a la publicación concreta) y se suman
-- las cuatro columnas de entidad. Todo lo demás —la idempotencia por
-- expiry_warned_at, el respeto de notification_prefs, el texto— es literal de
-- 0098: esta migración arregla el DATO, no la lógica.

create or replace function app.avisar_vencimientos(p_lote int default 5000)
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_avisadas int;
begin
  with por_vencer as (
    select l.id
      from public.listings l
     where l.status           = 'published'
       and l.expiry_warned_at is null
       and l.expiry_warn_at   is not null
       and l.expiry_warn_at  <= now()
       and l.expires_at       > now()
     order by l.expiry_warn_at
     limit p_lote
  ),
  marcadas as (
    update public.listings l
       set expiry_warned_at = now()
      from por_vencer p
     where l.id = p.id
    returning l.id, l.tenant_id, l.created_by, l.title, l.expires_at, l.kind, l.photos
  )
  insert into public.notifications (
    tenant_id, profile_id, kind, title, body, href, category, priority,
    entity_type, entity_id, entity_kind, image_url
  )
  select
    m.tenant_id,
    m.created_by,
    'listing_expiring',
    'Tu publicación vence pronto',
    left(m.title, 80)
      || ' deja de mostrarse en '
      || greatest(1, ceil(extract(epoch from (m.expires_at - now())) / 86400))::int
      || case
           when greatest(1, ceil(extract(epoch from (m.expires_at - now())) / 86400))::int = 1
           then ' día. Renovala y sigue activa.'
           else ' días. Renovala y sigue activa.'
         end,
    -- Mis publicaciones y no el detalle público: lo que hay que hacer con este
    -- aviso es RENOVAR, y el botón de renovar vive sólo acá. El parámetro deja
    -- la fila destacada y primera en la lista.
    '/publicaciones?aviso=' || m.id::text,
    'vencimientos',
    'high',
    'listing',
    m.id,
    m.kind,
    app.primera_foto(m.photos)
    from marcadas m
   where m.created_by is not null
     and not exists (
       select 1
         from public.notification_prefs np
        where np.profile_id = m.created_by
          and np.category   = 'vencimientos'
          and (np.in_app = false or np.frequency = 'off')
     );

  get diagnostics v_avisadas = row_count;
  return v_avisadas;
end;
$$;

comment on function app.avisar_vencimientos(int) is
  'Aviso previo de vencimiento (0098, href por publicación desde 0151): notifica a los dueños de los avisos que entran en la ventana de aviso de su comunidad y los marca con expiry_warned_at en la MISMA sentencia. Esa marca es la garantía de idempotencia: una segunda corrida no encuentra las filas porque ya salieron del índice parcial. Cada notificación lleva su propio destino (/publicaciones?aviso=<id>) y la entidad que la originó, para que la bandeja pueda mostrar la miniatura y el ícono del módulo. Devuelve cuántas notificaciones emitió (puede ser menor que las filas marcadas: no se notifica a avisos sin dueño ni a quien silenció la categoría).';

create or replace function app.vencer_publicaciones(p_lote int default 5000)
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_vencidas int;
begin
  -- (a) Lo pago no se apaga: se le extiende el ciclo.
  --
  -- ⚠️ El cálculo va en una SUBCONSULTA con LATERAL y no directo en el FROM del
  -- UPDATE: Postgres no deja referenciar la tabla que se está actualizando desde
  -- los argumentos de una función del from_list ("invalid reference to
  -- FROM-clause entry"). El join por id es la forma canónica de rodearlo.
  update public.listings l
     set expires_at       = d.expires_at,
         expiry_warn_at   = d.expiry_warn_at,
         expiry_warned_at = null
    from (
      select x.id, f.expires_at, f.expiry_warn_at
        from public.listings x
        cross join lateral app.listing_expiry_dates(x.tenant_id, x.kind) f
       where x.status      = 'published'
         and x.expires_at is not null
         and x.expires_at <= now()
         and (
           x.tier = 'premium'
           or exists (
             select 1
               from public.boosts b
              where b.listing_id = x.id
                and b.status     = 'active'
                and b.ends_at    > now()
           )
         )
    ) d
   where l.id = d.id;

  -- (b) El resto vence.
  with vencibles as (
    select l.id
      from public.listings l
     where l.status      = 'published'
       and l.expires_at is not null
       and l.expires_at <= now()
     order by l.expires_at
     limit p_lote
  ),
  vencidas as (
    update public.listings l
       set status     = 'expired',
           expired_at = now()
      from vencibles v
     where l.id = v.id
    returning l.id, l.tenant_id, l.created_by, l.title, l.kind, l.photos
  )
  insert into public.notifications (
    tenant_id, profile_id, kind, title, body, href, category, priority,
    entity_type, entity_id, entity_kind, image_url
  )
  select
    v.tenant_id,
    v.created_by,
    'listing_expired',
    'Tu publicación dejó de mostrarse',
    left(v.title, 80)
      || ' cumplió su tiempo en la comunidad. No se borró nada: renovala y vuelve a estar visible.',
    -- El detalle público de una publicación vencida no se ve; y lo que hay que
    -- hacer con este aviso es renovarla, que sólo se puede desde acá.
    '/publicaciones?aviso=' || v.id::text,
    'vencimientos',
    'normal',
    'listing',
    v.id,
    v.kind,
    app.primera_foto(v.photos)
    from vencidas v
   where v.created_by is not null
     and not exists (
       select 1
         from public.notification_prefs np
        where np.profile_id = v.created_by
          and np.category   = 'vencimientos'
          and (np.in_app = false
               or np.frequency = 'off'
               -- 'important' entrega sólo high/critical, y este aviso es normal.
               -- Se espeja shouldDeliverInApp() de src/lib/notifications/prefs.ts.
               or np.frequency = 'important')
     );

  get diagnostics v_vencidas = row_count;
  return v_vencidas;
end;
$$;

comment on function app.vencer_publicaciones(int) is
  'Vencimiento nocturno de publicaciones (0098, href por publicación desde 0151). Lo que está PAGO (tier premium vigente o boost activo) no se apaga: se le extiende el ciclo, para que cuando el pago se corte el aviso arranque una ventana nueva y completa en vez de morir esa noche. El resto pasa a status=expired —jamás delete: no se pierde ni una foto, ni un comentario, ni una reseña— y su dueño recibe el aviso, con destino propio y la entidad que lo originó. Idempotente: los updates exigen status=published y el vencimiento lo saca de ahí.';

-- =============================================================================
-- Las notificaciones VIEJAS
-- =============================================================================
-- 54 filas en producción con href '/publicaciones' y sin entidad. Dejarlas así
-- sería arreglar el reclamo sólo para lo que venga: la bandeja que el cliente
-- mira HOY seguiría teniendo veinte avisos que van todos al mismo lado.
--
-- Se pueden recuperar porque el body de 0098 arranca literalmente con
-- `left(title, 80)`. El match es CONSERVADOR en tres frentes:
--   · starts_with() y no LIKE — un título con % o _ rompería el patrón;
--   · sólo publicaciones del MISMO dueño y el MISMO tenant;
--   · sólo si el candidato es ÚNICO. Con dos publicaciones tituladas "Casa" y
--     "Casa grande", el aviso de la segunda matchea contra las dos y se descarta:
--     un destino equivocado es peor que el genérico, porque miente.
-- Lo que no matchea se queda con '/publicaciones': un destino menos útil, pero
-- nunca roto. No se borra ni se oculta nada.
with candidato as (
  select n.id                            as notif_id,
         l.id                            as listing_id,
         l.kind                          as listing_kind,
         app.primera_foto(l.photos)      as foto,
         count(*) over (partition by n.id) as cuantos
    from public.notifications n
    join public.listings l
      on l.tenant_id  = n.tenant_id
     and l.created_by = n.profile_id
     and btrim(l.title) <> ''
     and starts_with(n.body, left(l.title, 80))
   where n.kind in ('listing_expiring', 'listing_expired')
     and n.entity_id is null
     and n.body is not null
)
update public.notifications n
   set entity_type = 'listing',
       entity_id   = c.listing_id,
       entity_kind = c.listing_kind,
       image_url   = c.foto,
       href        = '/publicaciones?aviso=' || c.listing_id::text
  from candidato c
 where n.id = c.notif_id
   and c.cuantos = 1;

commit;
