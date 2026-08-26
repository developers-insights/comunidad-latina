-- =============================================================================
-- 0115_feed_siguiendo.sql — Comunidad Latina
--
-- La pestaña «Siguiendo» del feed de inicio, que la spec de módulos pide
-- textualmente (§8): «El feed de inicio debe dividirse en: Siguiendo —contenido
-- de usuarios, creadores, negocios y profesionales que el usuario sigue— y Para
-- ti —recomendaciones personalizadas, contenido comunitario y promociones
-- pagadas.»
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- POR QUÉ ESTO NO SE PODÍA HACER SIN BAJAR A LA BASE
-- ═══════════════════════════════════════════════════════════════════════════
--
-- «Siguiendo» es, por definición, la lista de todo lo que una persona sigue.
-- Resolverla del lado de la app significa traer esa lista y meterla en un
-- `.in(...)`, que en supabase-js viaja por el QUERYSTRING: ~39 bytes por uuid y
-- el corte de Kong alrededor de los 8 KB (el 414 que documenta la 0113). O sea
-- que la pestaña se rompería justo para quien más la usa —el que sigue a medio
-- barrio— y funcionaría perfecto para el que no sigue a nadie.
--
-- Acá viajan tres escalares: comunidad, cursor y tope. Ni un id.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- QUÉ ENTRA, Y POR QUÉ SON DOS RAMAS Y NO UNA
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `follows` es polimórfica desde la 0023 (`target_kind in ('listing','profile')`)
-- y las dos ramas significan cosas distintas:
--
--   · SEGUÍS UNA FICHA (negocio, profesional, evento, propiedad, aviso de
--     creador) → entran sus publicaciones de entidad, o sea las que tienen
--     `posts.entity_listing_id` apuntando a esa ficha.
--
--   · SEGUÍS UNA PERSONA → entran sus publicaciones PERSONALES, las que no
--     salen a nombre de ninguna ficha.
--
-- Y no se cruzan: si seguís a Ana pero no a su restaurante, ves lo que publica
-- Ana y no la carta del restaurante. Es lo que la persona eligió al tocar
-- Seguir en cada lugar, y confundirlas convertiría un follow personal en un
-- alta silenciosa a un canal comercial.
--
-- El docblock de `fetchFollowedListingIds` explica por qué en «Para ti» el
-- follow de PERFIL no cambia nada (un post personal ya es universal ahí). Acá
-- sí cambia todo, porque acá el default no es "todo": es "nada".
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- LO QUE DELIBERADAMENTE NO ENTRA
-- ═══════════════════════════════════════════════════════════════════════════
--
--   · LO PROMOCIONADO. La spec parte las dos pestañas justamente por esto:
--     «Para ti: recomendaciones personalizadas, contenido comunitario y
--     promociones pagadas» y «Las publicaciones comerciales no deben
--     distribuirse automáticamente a toda la audiencia». Una campaña paga que
--     se cuela en «Siguiendo» rompe la única promesa que esa pestaña hace: acá
--     está lo que vos elegiste. Que se pueda pagar para entrar la volvería
--     indistinguible de la otra.
--
--   · LO PROPIO. `feed_posts_page` sí trae las publicaciones del que mira (sin
--     esa rama, la primera publicación de un negocio no aparecía ni en el feed
--     de su dueño). Acá no corresponde: nadie se sigue a sí mismo, y una
--     pestaña que se llama «Siguiendo» y muestra lo tuyo miente sobre qué es.
--     Lo propio sigue estando en «Para ti», en tu perfil y en tu ficha.
--
--   · LOS AVISOS. «Siguiendo» es contenido publicado, no vidriera recomendada:
--     no tiene carril de `listings` y por eso no hay hermana de
--     `feed_listings_page`. Los avisos de quien seguís ya llegan por sus
--     publicaciones.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- `SECURITY INVOKER`, IGUAL QUE LA 0113
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Por el mismo motivo, que conviene no re-discutir: mover un filtro de lugar y
-- mover la frontera de seguridad son dos cosas distintas. Con `invoker`,
-- `posts_select` (0091) se sigue evaluando contra el JWT de quien pregunta y
-- esta función NO PUEDE devolver una fila que la app no podría leer igual.
--
-- `anon` en los grants por consistencia con sus hermanas, no porque sirva: sin
-- sesión `auth.uid()` es null, ninguna rama de `follows` matchea y la función
-- devuelve cero filas. La app ni siquiera ofrece la pestaña sin sesión — pero
-- una función que revienta con 42501 en vez de devolver vacío obligaría a la
-- app a distinguir dos casos que para ella son el mismo.
--
-- Los índices ya existen y no se agrega ninguno: `follows_follower_idx`
-- (tenant_id, follower_id, target_kind) cubre los dos EXISTS, y `posts_feed_idx`
-- cubre el orden y el keyset.
-- =============================================================================

begin;

create or replace function public.feed_following_page(
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
     -- LAS DOS RAMAS DEL SEGUIMIENTO (ver el encabezado).
     and (
          (p.entity_listing_id is not null
           and exists (select 1 from public.follows f
                        where f.follower_id = (select auth.uid())
                          and f.tenant_id   = p.tenant_id
                          and f.target_kind = 'listing'
                          and f.target_id   = p.entity_listing_id))
       or (p.entity_listing_id is null
           and p.author_id is not null
           and exists (select 1 from public.follows f
                        where f.follower_id = (select auth.uid())
                          and f.tenant_id   = p.tenant_id
                          and f.target_kind = 'profile'
                          and f.target_id   = p.author_id))
     )
     -- BLOQUEOS (0020). Es redundante con el follow —nadie sigue a quien
     -- bloqueó— salvo en el caso real que lo justifica: bloquear DESPUÉS de
     -- seguir. El follow queda, y sin esta línea el bloqueo no se notaría acá.
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

comment on function public.feed_following_page(uuid, timestamptz, uuid, int) is
  'Una página de la pestaña «Siguiendo» del feed (spec de módulos §8), resuelta contra follows DENTRO de la base: ningún id viaja por el querystring. Dos ramas que no se cruzan — follows de listing traen las publicaciones DE ENTIDAD de esa ficha, follows de profile traen las publicaciones PERSONALES de esa persona. NO trae lo promocionado (las promociones pagadas son de «Para ti» por definición de la spec) ni lo propio (nadie se sigue a sí mismo). security invoker: posts_select (0091) sigue decidiendo qué fila se puede leer.';

grant execute on function public.feed_following_page(uuid, timestamptz, uuid, int)
  to anon, authenticated, service_role;

commit;
