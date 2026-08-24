-- =============================================================================
-- 0113_pagina_del_feed_en_la_base.sql — Comunidad Latina
--
-- Dos funciones que resuelven una página del feed DENTRO de Postgres. Cierran
-- el techo de 8 KB de URL que este repo viene documentando desde la auditoría
-- del 2026-08-13 y que hasta hoy sólo estaba acotado, no resuelto.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- EL PROBLEMA, QUE NO ES DE RENDIMIENTO
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Las lecturas de supabase-js son GET: todo `.in(...)` viaja en el querystring,
-- ~39 bytes por uuid, y Kong corta el request line en ~8 KB con un 414.
--
-- El feed "Para ti" inlinea TRES listas: las campañas activas del tenant, las
-- fichas que el visitante sigue, y los perfiles que bloqueó. Con los topes que
-- hay hoy (150 / 200 / 200) el peor caso da **~21 KB** — o sea que los topes
-- vuelven la falla acotada y predecible, no la evitan. El propio docblock de
-- `feed/queries.ts` lo dice: subir esos números acerca el 414, no da más
-- alcance.
--
-- Y la lista de campañas es **del tenant**, no del visitante. Eso hace que el
-- 414 le pegue a TODOS los usuarios de una comunidad al mismo tiempo, y que lo
-- dispare el negocio de publicidad funcionando bien: cuantas más campañas
-- activas, más cerca del corte. Un producto que se rompe cuando se vende es un
-- producto con una bomba de tiempo, no con un problema de performance.
--
-- Acá viajan cuatro escalares y nada más.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- `SECURITY INVOKER`, Y ES LA DECISIÓN IMPORTANTE DEL ARCHIVO
-- ═══════════════════════════════════════════════════════════════════════════
--
-- La nota que quedó escrita en `queries.ts` pedía un `security definer`. Se
-- descartó a propósito, y conviene dejar el porqué porque la tentación vuelve:
--
-- Mover un filtro de lugar y mover la frontera de seguridad son dos cosas
-- distintas, y sólo una estaba rota. Lo que hay que arreglar es DÓNDE se
-- evalúa el alcance (en la base y no en la URL). Quién puede leer cada fila ya
-- está bien resuelto por `posts_select` y `listings_select` (0091).
--
-- Con `invoker`, esas policies se siguen evaluando contra el JWT de quien
-- pregunta, así que estas funciones **no pueden devolver una fila que la query
-- de hoy no devuelva**. Con `definer` pasarían a correr como su dueño y toda la
-- RLS quedaría del lado de adentro: cualquier error futuro en el `where` de
-- acá se convertiría en una fuga, en vez de en un resultado de más que la
-- policy igual descarta. Es el mismo criterio de `global_search()` (0044/0052).
--
-- `p_tenant_id` es un parámetro y NO es la frontera: es exactamente el mismo
-- `.eq("tenant_id", …)` que hace la app hoy. La 0091 ya dejó escrito por qué un
-- tenant elegido por el visitante no aísla nada — el aislamiento lo da la
-- policy, que deriva el tenant del servidor.
--
-- `anon` incluido en los grants a propósito: el feed lo lee gente sin sesión.
-- Con `auth.uid()` en null las tres ramas de seguido / propio / bloqueo se
-- apagan solas y queda "personal + promocionado", que es exactamente lo que ve
-- hoy un visitante anónimo.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- POR QUÉ LA LISTA DE COLUMNAS EXPLÍCITA Y NO `returns setof public.posts`
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `returns setof <tabla>` no tiene firma que mantener y es inmune a un tipo mal
-- declarado. Se descartó igual: las dos tablas tienen una columna `tsvector` de
-- búsqueda de texto completo (0044), y devolver la tabla entera la mandaría por
-- el cable en CADA scroll de CADA persona. La lista explícita es además un
-- contrato publicado, que es lo que este proyecto pide de cualquier cosa
-- pensada para reusarse.
--
-- Los 33 tipos se verificaron uno por uno contra `information_schema.columns`
-- de la base real antes de escribir esto (`price_amount` es `numeric`, los
-- contadores `integer`, `media`/`photos` son `text[]`, `media_filters` es
-- `jsonb`). Si alguna vez no coinciden, Postgres tira "structure of query does
-- not match function result type" en runtime, no al aplicar la migración.
--
--
-- ── LA APP YA SABE CAER SOLA ────────────────────────────────────────────────
-- `src/app/(app)/feed/feed-rpc.ts` llama a estas funciones y, si no existen,
-- usa el camino viejo — byte por byte el mismo comportamiento. Eso permite
-- desplegar el código antes que la migración sin ventana rota. Cuando esto esté
-- aplicado en todos los entornos se puede borrar ese fallback y con él las tres
-- constantes de tope de `queries.ts`.
-- =============================================================================

begin;

create or replace function public.feed_posts_page(
  p_tenant_id         uuid,
  p_cursor_created_at timestamptz default null,
  p_cursor_id         uuid        default null,
  p_limit             int         default 9,
  p_entity_kind       text        default null
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
     -- ALCANCE (0023): personal, PROPIO, de ficha seguida, o promocionado.
     -- La rama "propio" no es un extra: el dueño NO se sigue a sí mismo, así que
     -- sin ella su primera publicación comercial no aparecía ni en su feed.
     and (
          p.entity_listing_id is null
       or p.author_id = (select auth.uid())
       or exists (select 1 from public.follows f
                   where f.follower_id = (select auth.uid())
                     and f.tenant_id   = p.tenant_id
                     and f.target_kind = 'listing'
                     and f.target_id   = p.entity_listing_id)
       or exists (select 1 from public.post_promotions pr
                   where pr.post_id   = p.id
                     and pr.tenant_id = p.tenant_id
                     and pr.status    = 'active'
                     and pr.ends_at   > now())
     )
     -- BLOQUEOS (0020). El `is null` preserva al autor anónimo (cuenta borrada).
     and (
          p.author_id is null
       or not exists (select 1 from public.user_blocks b
                       where b.blocker_id = (select auth.uid())
                         and b.blocked_id = p.author_id)
     )
     -- Scope por vertical (paneles de Negocios/Profesionales). null = todo.
     and (
          p_entity_kind is null
       or exists (select 1 from public.listings l
                   where l.id     = p.entity_listing_id
                     and l.kind   = p_entity_kind
                     and l.status = 'published')
     )
     -- KEYSET: comparación de fila, sirve posts_feed_idx tal cual.
     and (p_cursor_created_at is null
          or (p.created_at, p.id) < (p_cursor_created_at, p_cursor_id))
   order by p.created_at desc, p.id desc
   limit least(greatest(coalesce(p_limit, 9), 1), 50);
$$;

comment on function public.feed_posts_page(uuid, timestamptz, uuid, int, text) is
  'Una página de posts del feed "Para ti" ya resuelta contra follows / post_promotions / user_blocks DENTRO de la base: ningún id viaja por el querystring, que era el 414 de Kong a los ~8 KB. security invoker a propósito — posts_select (0091) sigue decidiendo qué fila se puede leer; p_tenant_id sólo acota, no aísla. p_entity_kind acota a posts de una ficha publicada de ese vertical (pestañas Publicaciones de Negocios y Profesionales).';


create or replace function public.feed_listings_page(
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
     and l.status = 'published'
     -- MONETIZACIÓN §3: el empujón del "Para ti" es premium, con las mismas
     -- tres excepciones de recommendedFeedListingFilter (premium / seguido /
     -- propio). El aviso gratuito NO desaparece: sigue en su módulo, en las
     -- búsquedas y en el perfil de quien lo publicó.
     and (
          l.tier = 'premium'
       or l.created_by = (select auth.uid())
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

comment on function public.feed_listings_page(uuid, timestamptz, uuid, int) is
  'Hermana de feed_posts_page para el carril de avisos del "Para ti": misma regla de distribución premium (lib/monetization/feed.ts) resuelta en la base, sin inlinear los ids de follows ni de user_blocks en la URL.';

grant execute on function public.feed_posts_page(uuid, timestamptz, uuid, int, text)
  to anon, authenticated, service_role;
grant execute on function public.feed_listings_page(uuid, timestamptz, uuid, int)
  to anon, authenticated, service_role;

commit;
