-- =============================================================================
-- 0116_la_identidad_activa_manda.sql — Comunidad Latina
--
-- «cuando cambio a la cuenta de dueño no cambia todo. tiene que cambiar en todo
-- el programa completo, no solo en la foto del appbar: lo que publico, lo que
-- likeo, mi foto de perfil y mi nombre tendrían que ser los del dueño.»
-- (Manuel, 2026-08-26, mirando /perfil con el perfil "desarrollo" en uso.)
--
-- Tenía razón, y el motivo NO era de pintura. Era este, y se ve en una consulta:
--
--     select name, listing_id from business_accounts;
--     desarrollo               | null
--     Panadería La esperanza   | null
--     Barbería El Nítido       | 019f7d1d-…
--
-- ── POR QUÉ ESE `null` APAGABA LA FEATURE ENTERA ────────────────────────────
-- Desde la 0023, a nombre de quién sale una publicación se guarda en
-- `posts.entity_listing_id`, y la policy `posts_insert` exige que esa ficha sea
-- PROPIA y esté PUBLICADA. O sea: la cara pública de un negocio es su ficha del
-- directorio. Sin ficha, `identidades_disponibles()` devuelve `listing_id null`,
-- el composer no encuentra con qué firmar (ver src/lib/feed/autoria.ts) y cae al
-- perfil personal. La app hacía exactamente lo que estaba escrito: cambiaba el
-- avatar —lo único que no dependía de la ficha— y nada más.
--
-- Y la ficha no llegaba nunca por tres motivos encadenados:
--   · `crearCuentaDeNegocio` nunca creó una; la ofrecía como "siguiente paso"
--     con un link a /publicar?kind=business.
--   · Ese camino termina en `status='pending_review'` (§5.6: sin Vision
--     configurada, toda foto la mira una persona). En producción hoy eso
--     significa que la ficha se queda esperando moderación, y mientras tanto el
--     negocio sigue sin poder firmar.
--   · Y aunque se aprobara, NADIE escribía `business_accounts.listing_id`:
--     grepear el repo por esa columna devuelve cero escrituras.
--
-- Tres agujeros distintos con el mismo síntoma. Esta migración los tapa juntos.
--
-- ── 1. TODA CUENTA DE NEGOCIO NACE CON SU FICHA ─────────────────────────────
-- Y no es una ficha "de mentira" ni un segundo modelo de identidad —justo lo que
-- la 0103 pidió no hacer—: es LA ficha, la del directorio, la que ya tiene
-- página en /negocios/[id]. Se crea al dar de alta la cuenta, con el nombre y el
-- rubro que la persona acaba de escribir, SIN FOTOS.
--
-- Sin fotos es la parte que hace que esto sea seguro y no un bypass de
-- moderación: lo único que se publica es un nombre y un rubro de una lista
-- cerrada, y ese nombre pasa por `moderateText` en el alta (ver
-- negocios/cuenta/actions.ts). Ninguna imagen sin moderar llega al directorio
-- por acá — las fotos siguen entrando por /publicar y su cola, §5.6 intacto.
--
-- Si la persona YA tenía una ficha de negocio publicada hecha a mano, se REUSA
-- esa. Dos fichas para el mismo negocio serían dos caras para la misma
-- identidad, y la app tendría que elegir una: es exactamente la ambigüedad que
-- no queremos cuando lo que está en juego es con qué nombre se publica.
--
-- ── 2. LA FOTO DEL NEGOCIO SALE DE SU FICHA ─────────────────────────────────
-- La 0103 se negó a agregarle `avatar_url` a `business_accounts` con un
-- argumento correcto: «una columna que ningún formulario escribe es letra
-- muerta». Sigue valiendo. La foto del negocio es `listings.photos[1]`, que SÍ
-- tiene formulario (el de la ficha) y SÍ pasa por moderación de imagen. Por eso
-- `identidades_disponibles()` ahora devuelve también esa foto: para que el
-- avatar del header, el del composer y el de /perfil sean el negocio de verdad
-- y no una inicial en un círculo.
--
-- ── 3. COMENTAR TAMBIÉN ES HABLAR EN NOMBRE DEL NEGOCIO ─────────────────────
-- `comments.entity_listing_id`, misma columna, mismo nombre y —esto es lo
-- importante— MISMO PREDICADO que `posts_insert`, copiado y no aproximado: la
-- ficha tiene que ser del tenant, creada por quien comenta y estar publicada.
-- Una regla de autoría escrita distinto en dos tablas es una regla que va a
-- divergir; si mañana cambia, tiene que cambiar en los dos lugares con el mismo
-- texto delante.
--
-- El `comments_update` recibe el mismo predicado PERO SOLO EN LA RAMA DEL AUTOR.
-- La rama de staff queda como estaba: moderar un comentario firmado por un
-- negocio no puede exigirle al moderador que sea dueño de ese negocio.
--
-- ── LO QUE ESTA MIGRACIÓN NO HACE, A PROPÓSITO ──────────────────────────────
-- No le agrega identidad de entidad a `reactions`. No es un olvido: un "me
-- gusta" es el voto de UNA persona, y nadie en la app ve quién lo puso (sólo el
-- contador y tu propio estado). Dejar que el mismo ser humano vote una vez como
-- él y otra como su negocio infla los contadores sin agregar información — le
-- daría a cada dueño de negocio el doble de peso en el feed. El "me gusta"
-- sigue siendo tuyo aunque estés actuando como tu negocio.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. La ficha de una cuenta de negocio: asegurarla, una sola vez
--    `security definer` porque corre en dos contextos donde quien escribe no
--    necesariamente puede escribir `listings` con su propio JWT: el trigger de
--    alta y el relleno de abajo. `search_path=''` → todo calificado.
-- ---------------------------------------------------------------------------
create or replace function app.asegurar_ficha_de_negocio(p_business uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_cuenta  public.business_accounts%rowtype;
  v_listing uuid;
begin
  select * into v_cuenta from public.business_accounts where id = p_business;
  if not found then
    return null;
  end if;
  if v_cuenta.listing_id is not null then
    return v_cuenta.listing_id;
  end if;

  -- ¿Ya hizo una a mano? Se reusa (ver el encabezado: una identidad, una cara).
  select l.id into v_listing
  from public.listings l
  where l.tenant_id = v_cuenta.tenant_id
    and l.created_by = v_cuenta.owner_id
    and l.kind = 'business'
    and l.status = 'published'
  order by l.created_at
  limit 1;

  if v_listing is null then
    insert into public.listings (
      tenant_id, kind, title, status, created_by, attrs, source, published_at
    )
    values (
      v_cuenta.tenant_id,
      'business',
      v_cuenta.name,
      'published',
      v_cuenta.owner_id,
      case
        when v_cuenta.category is null then '{}'::jsonb
        else jsonb_build_object('category', v_cuenta.category)
      end,
      'user',
      now()
    )
    returning id into v_listing;
  end if;

  update public.business_accounts
     set listing_id = v_listing
   where id = p_business
     and listing_id is null;

  return v_listing;
end;
$fn$;

comment on function app.asegurar_ficha_de_negocio(uuid) is
  'Devuelve la ficha del directorio con la que este negocio firma sus publicaciones, creándola si no existe. Idempotente: si la cuenta ya tiene listing_id, no toca nada. Sin fotos a propósito — lo único que publica es el nombre y el rubro, ya moderados en el alta (0116).';

-- ---------------------------------------------------------------------------
-- 2. El alta de una cuenta de negocio la crea sola
--    AFTER INSERT y no BEFORE: el UPDATE de vuelta necesita que la fila exista.
-- ---------------------------------------------------------------------------
create or replace function app.business_accounts_ficha_al_alta()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  perform app.asegurar_ficha_de_negocio(new.id);
  return null;
end;
$fn$;

drop trigger if exists business_accounts_ficha_al_alta on public.business_accounts;
create trigger business_accounts_ficha_al_alta
after insert on public.business_accounts
for each row execute function app.business_accounts_ficha_al_alta();

comment on trigger business_accounts_ficha_al_alta on public.business_accounts is
  'Toda cuenta de negocio nace con su ficha publicada. Sin esto el negocio existe en el cambiador de perfil pero no puede firmar nada: la autoría de entidad cuelga de posts.entity_listing_id (0023) y ese id sale de acá.';

-- ---------------------------------------------------------------------------
-- 3. Las cuentas que ya existían, al día
--    Son las que hoy tienen el interruptor de perfil sin nada del otro lado.
-- ---------------------------------------------------------------------------
do $bf$
declare
  v_id uuid;
begin
  for v_id in
    select id from public.business_accounts where listing_id is null
  loop
    perform app.asegurar_ficha_de_negocio(v_id);
  end loop;
end;
$bf$;

-- ---------------------------------------------------------------------------
-- 4. La lista de identidades ahora trae la CARA, no sólo el nombre
--    `drop` + `create` porque cambia el tipo de retorno (columna nueva).
-- ---------------------------------------------------------------------------
drop function if exists public.identidades_disponibles();

create function public.identidades_disponibles()
returns table (
  business_id    uuid,
  nombre         text,
  categoria      text,
  listing_id     uuid,
  foto           text,
  rol            text,
  es_propietario boolean
)
language sql
stable
security definer
set search_path = ''
as $fn$
  select
    ba.id,
    ba.name,
    ba.category,
    ba.listing_id,
    (select l.photos[1] from public.listings l where l.id = ba.listing_id),
    bm.role,
    ba.owner_id = (select auth.uid())
  from public.business_members bm
  join public.business_accounts ba on ba.id = bm.business_id
  where bm.profile_id = (select auth.uid())
    and bm.status = 'active'
    and ba.tenant_id = (select app.current_tenant_id())
  order by (ba.owner_id = (select auth.uid())) desc, ba.name;
$fn$;

comment on function public.identidades_disponibles() is
  'Negocios con los que quien pregunta puede actuar AHORA, con su ficha y su foto. Columnas de IDENTIDAD únicamente: los ids de Stripe de business_accounts NO salen de acá (0103). La foto es listings.photos[1] — path del bucket público listing-photos, la resuelve el cliente (0116).';

-- `create function` la deja ejecutable por PUBLIC, o sea también por `anon`.
-- Recrearla borró el REVOKE que dejó la 0103 (migración
-- `0103_cuenta_de_negocio_revoke_anon`), así que va de nuevo y JUNTO al create:
-- separar los dos es exactamente cómo se perdió la primera vez. Sin sesión la
-- función no devuelve nada igual —filtra por `auth.uid()`—, pero una RPC de
-- identidad colgada del endpoint público es superficie que no tiene por qué
-- existir.
revoke all on function public.identidades_disponibles() from public, anon;
grant execute on function public.identidades_disponibles() to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Comentar como el negocio
-- ---------------------------------------------------------------------------
alter table public.comments
  add column if not exists entity_listing_id uuid
    references public.listings(id) on delete set null;

comment on column public.comments.entity_listing_id is
  'Ficha con la que se firmó el comentario, o NULL = lo dijo la persona. Espejo exacto de posts.entity_listing_id (0023), con el MISMO predicado en la policy: la ficha tiene que ser del tenant, creada por quien comenta y estar publicada. on delete set null porque borrar la ficha no puede borrar la conversación: el comentario sobrevive atribuido a su autor persona.';

create index if not exists comments_entity_idx
  on public.comments (tenant_id, entity_listing_id, created_at desc)
  where entity_listing_id is not null;

drop policy if exists comments_insert on public.comments;
create policy comments_insert on public.comments
for insert to authenticated
with check (
  tenant_id = (select app.current_tenant_id())
  and author_id = (select auth.uid())
  and status = 'published'
  and exists (
    select 1
    from public.posts p
    where p.id = comments.post_id
      and p.tenant_id = comments.tenant_id
      and p.status = 'published'
      and p.comments_locked_at is null
  )
  -- El predicado de `posts_insert`, copiado literal. Ver el encabezado.
  and (
    comments.entity_listing_id is null
    or exists (
      select 1
      from public.listings l
      where l.id = comments.entity_listing_id
        and l.tenant_id = comments.tenant_id
        and l.created_by = (select auth.uid())
        and l.status = 'published'
    )
  )
);

drop policy if exists comments_update on public.comments;
create policy comments_update on public.comments
for update to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and (
    (author_id = (select auth.uid()) and status <> 'removed')
    or (select app.is_staff())
  )
)
with check (
  tenant_id = (select app.current_tenant_id())
  and (
    (
      author_id = (select auth.uid())
      and status = 'published'
      -- Sólo la rama del AUTOR lleva el predicado de firma: pedirle a un
      -- moderador que sea dueño de la ficha le impediría moderar el comentario.
      and (
        comments.entity_listing_id is null
        or exists (
          select 1
          from public.listings l
          where l.id = comments.entity_listing_id
            and l.tenant_id = comments.tenant_id
            and l.created_by = (select auth.uid())
            and l.status = 'published'
        )
      )
    )
    or (select app.is_staff())
  )
);

commit;
