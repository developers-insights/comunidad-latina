-- =============================================================================
-- 0119_feed_siguiendo.sql — Comunidad Latina
--
-- El feed tiene UNA sola vista, "Para ti", y "Para ti" es un algoritmo: mezcla
-- lo que seguís con lo premium, lo impulsado y lo promocionado. Está bien que
-- exista —es el motor de descubrimiento y es donde vive la monetización— pero
-- deja sin respuesta la pregunta más simple que le hace alguien a una red:
--
--     «quiero ver lo de la gente que sigo, y NADA más»
--
-- Hoy no hay forma. Alguien que sigue a doce vecinos y a tres negocios los ve
-- mezclados con avisos premium que no pidió, y si el que sigue publica poco,
-- directamente no lo ve. Seguir a alguien deja de significar algo, y la
-- pregunta natural —"¿para qué toqué Seguir?"— no tiene buena respuesta.
--
-- Esta migración pone las dos funciones que sirven la pestaña "Siguiendo".
-- Son las hermanas EXACTAS de `feed_posts_page` y `feed_listings_page` (0115):
-- mismo `returns table`, mismo keyset, misma clase de seguridad. Lo único que
-- cambia es a quién dejan pasar.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 1. QUÉ ENTRA EN "SIGUIENDO"
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Publicaciones (`posts`):
--   · de un PERFIL que seguís           (follows.target_kind = 'profile')
--   · de una FICHA que seguís           (follows.target_kind = 'listing')
--   · tuyas propias
--
-- Avisos (`listings`):
--   · publicados por un PERFIL que seguís
--   · el aviso mismo, si lo seguís
--
-- Ese segundo carril es lo que hace que la pestaña no sea sólo "el muro de mis
-- amigos": si seguís a alguien y esa persona publica un evento, una vacante o
-- un departamento, te aparece. Seguir a una persona es querer enterarte de lo
-- que hace, y en esta app la mitad de lo que hace la gente son avisos.
--
-- ── POR QUÉ EL POST DE UNA ENTIDAD ENTRA POR SEGUIR A SU DUEÑO ──────────────
-- Es un DESVÍO deliberado de la regla de alcance de la 0023, y conviene
-- entender por qué no la contradice. Esa regla —"lo orgánico de una entidad
-- llega SOLO a sus seguidores"— existe para que el feed de descubrimiento no se
-- llene de contenido comercial que nadie pidió. En "Siguiendo" NO hay nada que
-- proteger de eso: la persona pidió explícitamente ver lo de quienes sigue, y
-- filtrarle el post del negocio de alguien a quien decidió seguir sería
-- esconderle justamente lo que fue a buscar. La regla de la 0023 sigue rigiendo
-- entera en "Para ti", que es la pestaña para la que se escribió.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 2. QUÉ **NO** ENTRA, Y ESO ES LA MITAD DEL VALOR DE LA PESTAÑA
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ── NADA PAGO ENTRA POR SER PAGO ────────────────────────────────────────────
-- No hay rama de `post_promotions` ni de `tier = 'premium'`. Lo pagado vive en
-- "Para ti", que es el inventario que se vende; "Siguiendo" es 100% orgánico.
--
-- Ojo con la lectura al revés, que es la que rompería la pestaña: NO se
-- excluye lo promocionado de quien seguís. Si seguís a un negocio y ese negocio
-- promociona un post, lo ves — porque lo seguís, no porque haya pagado. Lo que
-- no existe acá es la puerta de entrada POR haber pagado. La distinción no es
-- retórica: la primera lectura es "la publicidad no invade lo que pediste"; la
-- segunda sería "te escondemos lo de la gente que seguís cuando paga", que es
-- castigar al anunciante por anunciar y además romper el follow.
--
-- ── SIN ZONA ────────────────────────────────────────────────────────────────
-- No recibe `p_area_labels` y no es un olvido. "Tu zona" (0115) es una
-- herramienta de DESCUBRIMIENTO: recorta lo desconocido a lo que te queda
-- cerca. Un seguimiento es una decisión ya tomada, y la geografía no la
-- reemplaza — si seguís a tu prima que se mudó a otro barrio, la seguís igual.
-- Cruzar las dos cosas tendría además una falla fea y silenciosa: alguien con
-- una zona elegida abriría "Siguiendo" y lo vería medio vacío, sin ninguna
-- pista de por qué faltan la mitad de los que sigue.
--
-- ── SIN `p_entity_kind` ─────────────────────────────────────────────────────
-- Ese parámetro de `feed_posts_page` no es del feed: lo usan las pestañas
-- "Publicaciones" de Negocios y de Profesionales. "Siguiendo" no tiene esa
-- variante.
--
-- ── LOS BLOQUEOS SÍ, SIEMPRE ────────────────────────────────────────────────
-- `user_blocks` (0020) se respeta igual que en 0115. Un follow viejo no
-- sobrevive a un bloqueo nuevo, y quien bloqueó no tiene por qué acordarse de
-- dejar de seguir para dejar de ver.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 3. SIN SESIÓN NO HAY "SIGUIENDO" — Y POR ESO LOS GRANTS SON DISTINTOS
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Las dos de la 0115 tienen `grant execute ... to anon`: el sitio público se
-- sirve de ellas para SEO y para el visitante sin cuenta. Éstas NO. La pestaña
-- se define por `auth.uid()`, y sin sesión el filtro entero colapsa a "nada":
-- devolvería una página vacía, que es indistinguible de un error.
--
-- ⚠️ Y NO ALCANZA CON "NO DARLE EL GRANT A ANON". Toda función nueva nace con
-- EXECUTE para PUBLIC, y `anon` lo hereda — la 0083 lo midió y lo dejó escrito
-- después de que la 0082 afirmara lo contrario. Omitir el grant no cierra
-- nada; hay que REVOCAR de `public` Y de `anon`, las dos. Es la parte de este
-- archivo que más fácil se copia mal.
--
-- ── SEGURIDAD: INVOKER, IGUAL QUE LA 0113 Y LA 0115 ─────────────────────────
-- `security invoker`: la RLS del que llama sigue mandando. `posts_select` y
-- `listings_select` (0091) siguen decidiendo QUÉ FILA se puede leer;
-- `p_tenant_id` acota la consulta, no aísla nada — un id de otra comunidad no
-- devuelve más de lo que la policy ya dejaba ver. Mover un filtro de la app a
-- la base no mueve la frontera de seguridad, y esa frontera no se toca acá.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 4. ÍNDICES: NINGUNO NUEVO, Y ESO SE VERIFICÓ
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Los cuatro EXISTS son correlacionados y de igualdad pura sobre columnas que
-- ya están indexadas:
--
--   follows      · unique (follower_id, target_kind, target_id)  — 0023
--                  Las tres columnas del EXISTS, en ese orden. Es el índice
--                  perfecto: una probe por fila candidata, y no se degrada
--                  aunque alguien siga a miles.
--                  `follows_follower_idx (tenant_id, follower_id, target_kind)`
--                  cubre el prefijo también; no hace falta ninguno más.
--   user_blocks  · el mismo EXISTS que ya usan las dos funciones de la 0115.
--   posts        · `posts_feed_idx (tenant_id, created_at desc, id desc)
--                  where status='published'` sirve el ORDER BY + keyset tal cual.
--   listings     · `listings_tenant_created_idx (tenant_id, created_at desc,
--                  id desc)` ídem.
--
-- EXISTS y no `in (subconsulta)` a propósito: el `in` materializa el conjunto
-- entero de seguidos una vez por consulta y lo hashea — con doce follows da
-- igual, con miles es trabajo que se paga aunque la página traiga nueve filas.
-- El EXISTS correlacionado se resuelve con un index scan por fila y corta con
-- el LIMIT.
--
-- LÍMITE CONOCIDO, escrito para que no sorprenda: el plan natural recorre
-- `posts_feed_idx` en orden y descarta lo que no seguís. Si alguien sigue a
-- MUY poca gente en una comunidad con muchísimas publicaciones, ese recorrido
-- se hace largo antes de juntar nueve filas. No se optimiza hoy porque sería
-- adivinar (la comunidad más grande tiene decenas de publicaciones), y porque
-- la salida ya está disponible sin migración: el planificador puede arrancar
-- desde `follows` y entrar a `posts` por `posts_author_idx (tenant_id,
-- author_id, created_at desc)` / `posts_entity_listing_idx`, que existen desde
-- la 0007 y la 0056. Índices nuevos "por las dudas" son costo de escritura
-- garantizado a cambio de un beneficio hipotético.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Publicaciones de quienes seguís
-- ---------------------------------------------------------------------------
-- El `returns table` es CARÁCTER POR CARÁCTER el de `feed_posts_page` (0115),
-- y no por prolijidad: la app mapea las dos con el mismo `as PostRow[]`
-- (`src/app/(app)/feed/feed-rpc.ts`). Una columna de más, de menos o en otro
-- orden obliga a un segundo mapper y a un segundo tipo que se van a
-- desincronizar. Si algún día se le agrega una columna a una, va en las dos.
create or replace function public.feed_siguiendo_posts_page(
  p_tenant_id         uuid,
  p_cursor_created_at timestamptz default null,
  p_cursor_id         uuid        default null,
  p_limit             int         default 9
)
returns table (
  id                      uuid,
  body                    text,
  kind                    text,
  media                   text[],
  status                  text,
  like_count              int,
  comment_count           int,
  view_count              int,
  created_at              timestamptz,
  author_id               uuid,
  entity_listing_id       uuid,
  video_type              text,
  duration_seconds        int,
  is_paid_ad              boolean,
  eligible_for_short_feed boolean,
  video_category          text,
  pinned_at               timestamptz,
  hidden_at               timestamptz,
  comments_locked_at      timestamptz,
  media_filters           jsonb
)
language sql
stable
security invoker
set search_path = ''
as $$
  select p.id, p.body, p.kind, p.media, p.status, p.like_count, p.comment_count,
         p.view_count, p.created_at, p.author_id, p.entity_listing_id,
         p.video_type, p.duration_seconds, p.is_paid_ad,
         p.eligible_for_short_feed, p.video_category,
         p.pinned_at, p.hidden_at, p.comments_locked_at, p.media_filters
    from public.posts p
   where p.tenant_id = p_tenant_id
     and p.status = 'published'
     and p.hidden_at is null                      -- 0097: lo que el autor ocultó
     -- SEGUIDOS. Sin rama de post_promotions: en "Siguiendo" nada entra por
     -- estar pago. Lo promocionado de quien seguís SÍ se ve —entra por la
     -- primera rama, como todo lo suyo—, que es distinto de dejarlo entrar por
     -- haber pagado.
     and (
          -- El autor es alguien que seguís. Cubre también sus posts de ficha:
          -- seguir a una persona es querer enterarte de lo que hace, y en
          -- "Siguiendo" no hay descubrimiento que proteger (ver cabecera).
          exists (select 1 from public.follows f
                   where f.follower_id = (select auth.uid())
                     and f.tenant_id   = p.tenant_id
                     and f.target_kind = 'profile'
                     and f.target_id   = p.author_id)
          -- La ficha que publicó es una que seguís (0023).
       or exists (select 1 from public.follows f
                   where f.follower_id = (select auth.uid())
                     and f.tenant_id   = p.tenant_id
                     and f.target_kind = 'listing'
                     and f.target_id   = p.entity_listing_id)
          -- Lo tuyo. Nadie se sigue a sí mismo, y sin esta rama tu propia
          -- publicación no aparecería en la única pestaña donde estás seguro
          -- de que tendría que estar (mismo motivo que en feed_posts_page).
       or p.author_id = (select auth.uid())
     )
     -- BLOQUEOS (0020). El `is null` preserva al autor anónimo (cuenta borrada).
     and (
          p.author_id is null
       or not exists (select 1 from public.user_blocks b
                       where b.blocker_id = (select auth.uid())
                         and b.blocked_id = p.author_id)
     )
     -- KEYSET: comparación de fila, sirve posts_feed_idx tal cual.
     and (p_cursor_created_at is null
          or (p.created_at, p.id) < (p_cursor_created_at, p_cursor_id))
   order by p.created_at desc, p.id desc
   limit least(greatest(coalesce(p_limit, 9), 1), 50);
$$;

comment on function public.feed_siguiendo_posts_page(uuid, timestamptz, uuid, int) is
  'Una página de posts de la pestaña "Siguiendo" (0119): sólo lo de los perfiles y las fichas que seguís, más lo propio. Hermana de feed_posts_page (0115) con el MISMO returns table para que la app reuse el mapper. Sin promociones pagas —lo pagado vive en "Para ti"; lo promocionado de quien seguís igual se ve, porque entra por el follow y no por el pago— y sin zona: "Tu zona" recorta el descubrimiento, y un seguimiento es una decisión ya tomada. A diferencia de feed_posts_page, el post de una ficha entra también por seguir a su AUTOR: la regla de alcance de 0023 protege al feed de descubrimiento, y acá no hay descubrimiento que proteger. security invoker — posts_select (0091) sigue decidiendo qué fila se puede leer; p_tenant_id acota, no aísla. Sin sesión no devuelve nada, por eso no se le da execute a anon.';

-- ---------------------------------------------------------------------------
-- 2. Avisos de quienes seguís
-- ---------------------------------------------------------------------------
-- Mismo `returns table` que `feed_listings_page` (0115), por lo mismo: la app
-- las mapea a las dos con `as ListingRow[]`.
--
-- Acá NO hay rama de `tier = 'premium'` (que en "Para ti" es la regla de
-- distribución de la monetización §3) ni de aviso propio. Un aviso tuyo vive en
-- "Mis publicaciones", que es una pantalla entera dedicada a eso; un post, en
-- cambio, es un evento en el tiempo y verlo salir es la confirmación de que
-- salió. La asimetría con la función de arriba es deliberada.
create or replace function public.feed_siguiendo_listings_page(
  p_tenant_id         uuid,
  p_cursor_created_at timestamptz default null,
  p_cursor_id         uuid        default null,
  p_limit             int         default 9
)
returns table (
  id             uuid,
  kind           text,
  title          text,
  description    text,
  price_amount   numeric,
  price_currency text,
  price_period   text,
  area_label     text,
  photos         text[],
  created_by     uuid,
  publisher_name text,
  created_at     timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select l.id, l.kind, l.title, l.description, l.price_amount, l.price_currency,
         l.price_period, l.area_label, l.photos, l.created_by,
         l.publisher_name, l.created_at
    from public.listings l
   where l.tenant_id = p_tenant_id
     -- 'published' y nada más: un aviso cerrado (0117), pausado o vencido no
     -- vuelve al feed por venir de alguien a quien seguís.
     and l.status = 'published'
     and (
          -- Lo publicó alguien que seguís: así el evento, la vacante o el
          -- departamento de esa persona te llega sin que tengas que seguir
          -- cada aviso suyo de a uno.
          exists (select 1 from public.follows f
                   where f.follower_id = (select auth.uid())
                     and f.tenant_id   = l.tenant_id
                     and f.target_kind = 'profile'
                     and f.target_id   = l.created_by)
          -- O seguís el aviso mismo (negocio, evento, profesional, tienda).
       or exists (select 1 from public.follows f
                   where f.follower_id = (select auth.uid())
                     and f.tenant_id   = l.tenant_id
                     and f.target_kind = 'listing'
                     and f.target_id   = l.id)
     )
     and (
          l.created_by is null
       or not exists (select 1 from public.user_blocks b
                       where b.blocker_id = (select auth.uid())
                         and b.blocked_id = l.created_by)
     )
     and (p_cursor_created_at is null
          or (l.created_at, l.id) < (p_cursor_created_at, p_cursor_id))
   order by l.created_at desc, l.id desc
   limit least(greatest(coalesce(p_limit, 9), 1), 50);
$$;

comment on function public.feed_siguiendo_listings_page(uuid, timestamptz, uuid, int) is
  'Hermana de feed_listings_page para la pestaña "Siguiendo" (0119): avisos publicados por perfiles que seguís, más los avisos que seguís vos. Mismo returns table que la de "Para ti" para reusar el mapper. SIN la regla de distribución premium (lib/monetization/feed.ts) y sin zona: acá no se vende inventario ni se descubre nada, se entrega lo que la persona pidió ver. Tampoco incluye los avisos propios —para eso está "Mis publicaciones"—, a diferencia de la función de posts, donde ver salir lo tuyo sí es la confirmación de que salió. security invoker: listings_select (0091) sigue mandando.';

-- ---------------------------------------------------------------------------
-- 3. Grants — la diferencia con la 0115, escrita
-- ---------------------------------------------------------------------------
-- La 0115 le da execute a `anon` porque el sitio público se sirve de sus dos
-- funciones. Éstas no: sin `auth.uid()` el filtro no selecciona nada y la
-- pestaña devolvería una página vacía indistinguible de un error.
--
-- ⚠️ EL REVOKE ES OBLIGATORIO, NO DECORATIVO. Una función nueva nace con
-- EXECUTE para PUBLIC y `anon` hereda de PUBLIC: sin estas dos líneas, "no le
-- damos el grant a anon" no cierra absolutamente nada. Es la corrección que la
-- 0083 tuvo que escribir después de que la 0082 afirmara lo contrario, y hay
-- que revocar de los DOS —`public` y `anon`— porque sacarle a uno solo deja el
-- otro cubriendo.
revoke execute on function public.feed_siguiendo_posts_page(uuid, timestamptz, uuid, int)
  from public, anon;
revoke execute on function public.feed_siguiendo_listings_page(uuid, timestamptz, uuid, int)
  from public, anon;

grant execute on function public.feed_siguiendo_posts_page(uuid, timestamptz, uuid, int)
  to authenticated, service_role;
grant execute on function public.feed_siguiendo_listings_page(uuid, timestamptz, uuid, int)
  to authenticated, service_role;

commit;
