-- =============================================================================
-- 0115_zona_del_feed.sql — Comunidad Latina
--
-- "Tu zona" recorta seis listados y NO recortaba el feed, que es la pantalla
-- donde la gente pasa el tiempo. El síntoma que lo destapó es exacto: elegir
-- Bronx en el header y ver el mismo feed de siempre, con el subtítulo diciendo
-- otra zona. Una preferencia que no cambia nada se lee como una app rota, y con
-- razón.
--
-- Faltaba el dato, no el filtro: `listings.area_label` existe desde la 0004 y
-- está cargado en el 100% de lo publicado, pero `posts` nunca tuvo zona. Esta
-- migración se la da, y enseña a las dos funciones del feed (0113) a usarla.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 1. DE DÓNDE SALE LA ZONA DE UNA PUBLICACIÓN
-- ═══════════════════════════════════════════════════════════════════════════
--
-- De lo que su autor YA declaró, nunca de geo nueva (§5.4: jamás dirección
-- exacta, siempre `area_label` aproximado):
--
--   · publicada COMO una ficha (`entity_listing_id`) → la zona de esa ficha.
--     Un post del restaurante de Corona es de Corona aunque su dueño viva en
--     Astoria: lo que la gente sigue es el negocio, no al dueño.
--   · publicada como persona → `profiles.area_label` de quien publica.
--
-- Es una FOTO del momento de publicar, no un puntero. Quien se muda cambia
-- dónde va a publicar de ahora en más; no reescribe dónde pasó lo que ya contó.
-- Por eso la columna vive en `posts` y no se resuelve por join en cada lectura:
-- además de ser lo correcto, deja el filtro del feed en un índice y no en un
-- join por fila.
--
-- ── POR QUÉ UN TRIGGER Y NO EL INSERT DE LA APP ─────────────────────────────
-- Porque la columna decide DISTRIBUCIÓN: quién ve qué. Un valor que llegara del
-- cliente sería un campo para elegir en qué barrio aparecer — spam gratis. El
-- trigger la deriva SIEMPRE en el servidor, ignora lo que venga en el payload y
-- en el UPDATE conserva la que ya estaba: la zona de una publicación no se
-- edita después.
--
-- La única excepción es la publicación que nació SIN zona porque su autor
-- todavía no había declarado la suya. Esa se puede completar —el orden real de
-- la gente es publicar primero y completar el perfil después— y se completa
-- sola: un trigger en `profiles` le pone zona a sus publicaciones huérfanas
-- cuando declara la propia por primera vez. Sin eso, esas publicaciones
-- quedarían invisibles para siempre en cualquier feed filtrado, que es pérdida
-- de alcance silenciosa. Mudarse (cambiar una zona por otra) no reescribe nada.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 2. LO QUE UNA CAMPAÑA COMPRÓ SE RESPETA — EN LOS DOS SENTIDOS
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `post_promotions.audience` (0023) guarda `{"scope":"all"}` o
-- `{"scope":"zones","zones":[…]}` desde hace meses y nadie lo estaba mirando —
-- `feed/queries.ts` lo dice con todas las letras: «se guarda para segmentación
-- geográfica futura». Hoy hay campañas activas con zonas elegidas mostrándose
-- en toda la comunidad. Y prender el filtro del feed sin mirar `audience`
-- habría roto lo contrario: campañas de alcance total desapareciendo de la
-- vista de quien eligió una zona. Las dos son la misma falla —entregar algo
-- distinto de lo que se vendió— así que las dos se arreglan acá:
--
--   · `scope=all`   → llega igual, esté donde esté mirando quien lee.
--   · `scope=zones` → llega si alguna de sus zonas es la que se está mirando.
--   · visitante SIN zona (mira toda la comunidad) → llega. Ante la duda, sí:
--     es la misma asimetría deliberada que `boostReachesViewer` documenta en
--     `lib/boosts/scope.ts` — adentro de la comunidad que cobró el impulso, no
--     entregarlo por un dato que falta es cobrar por algo que no se dio.
--
-- El contenido ORGÁNICO no tiene esa excepción: con una zona elegida se ve lo
-- de esa zona y punto, igual que ya hacen Vivienda, Empleos, Negocios,
-- Profesionales, Marketplace y Eventos. Incluir "lo que no declaró zona" habría
-- sido más cómodo y habría convertido el rótulo del header en mentira.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 3. POR QUÉ `p_area_labels` ES UN ARRAY DE ETIQUETAS EXACTAS
-- ═══════════════════════════════════════════════════════════════════════════
--
-- El match de zonas de esta app es laxo y sin acentos (`sameZoneLabel`), y esa
-- función vive en TypeScript. Reescribirla en SQL sería mantener dos versiones
-- del mismo criterio para siempre — el trade-off que `lib/zona/coincidencias.ts`
-- ya resolvió: el match se hace ANTES, contra el catálogo de zonas de la
-- comunidad, y a la base le llega un `= any(...)` de valores exactos.
--
-- `null` significa "no filtres" y NUNCA "no hay nada": `zonasCoincidentes`
-- devuelve al menos la zona elegida cuando hay una. Esa distinción es lo que
-- evita el peor bug posible acá, que es un feed en blanco.
--
-- Las dos funciones siguen siendo `security invoker` por lo que explica la
-- 0113: mover un filtro de lugar no es mover la frontera de seguridad.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. La zona de una publicación
-- ---------------------------------------------------------------------------
alter table public.posts
  add column if not exists area_label text;

comment on column public.posts.area_label is
  'Zona aproximada de la publicación, derivada por app.posts_area_label() al insertar: la de la ficha cuando se publica como entidad, si no la de profiles.area_label del autor. NULL = su autor nunca declaró zona. Es una FOTO del momento de publicar (mudarse no reescribe lo ya publicado) y NUNCA la escribe el cliente: decide distribución en el feed, y dejarla en manos de quien publica sería un campo para elegir en qué barrio aparecer. Mismo vocabulario de texto libre que listings.area_label (§5.4: zona, jamás dirección).';

-- Lo ya publicado, con la misma regla. Va ANTES del trigger a propósito: el
-- trigger conserva la zona en cada UPDATE, así que con él puesto este backfill
-- se pisaría a sí mismo y no escribiría nada (verificado contra la base real
-- antes de aplicar: 0 de 54 filas). Sin backfill, el feed filtrado arrancaría
-- vacío para toda la comunidad — la forma más rápida de que una feature
-- correcta parezca un incidente.
update public.posts p
   set area_label = nullif(btrim(coalesce(
         (select l.area_label from public.listings l where l.id = p.entity_listing_id),
         (select pr.area_label from public.profiles pr where pr.id = p.author_id),
         '')), '')
 where p.area_label is null;

create or replace function app.posts_area_label()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_zona text;
begin
  -- Una zona YA escrita no se toca: la publicación no cambia de barrio cuando
  -- su autor se muda, y el payload de un UPDATE tampoco puede reescribirla.
  if tg_op = 'UPDATE' and old.area_label is not null then
    new.area_label := old.area_label;
    return new;
  end if;

  -- Se deriva en el INSERT, y también en el UPDATE de una publicación que nació
  -- SIN zona porque su autor todavía no había declarado la suya. Ese segundo
  -- caso no es una licencia para editarla: el valor sale igual del servidor
  -- (ficha > perfil) y lo que venga en el payload se descarta.
  if new.entity_listing_id is not null then
    select l.area_label into v_zona
      from public.listings l
     where l.id = new.entity_listing_id;
  end if;

  if v_zona is null then
    select p.area_label into v_zona
      from public.profiles p
     where p.id = new.author_id;
  end if;

  new.area_label := nullif(btrim(coalesce(v_zona, '')), '');
  return new;
end;
$$;

comment on function app.posts_area_label() is
  'BEFORE INSERT OR UPDATE en posts: deriva posts.area_label en el servidor (ficha > perfil del autor) y la vuelve inmutable una vez escrita. security definer a propósito — la lectura de profiles/listings no puede depender de que una policy futura siga dejando leer esas dos columnas: si dejara de hacerlo, las publicaciones nacerían sin zona y desaparecerían del feed filtrado en silencio. No escribe nada fuera de la fila que se está insertando.';

drop trigger if exists posts_set_area_label on public.posts;
create trigger posts_set_area_label
before insert or update on public.posts
for each row execute function app.posts_area_label();

-- ---------------------------------------------------------------------------
-- Quien declara su zona DESPUÉS de publicar
--
-- El orden real de la gente es publicar primero y completar el perfil después.
-- Sin esto, esas publicaciones quedarían sin zona para siempre: invisibles para
-- cualquiera que filtre por un barrio, sin que su autor pueda hacer nada al
-- respecto. Es pérdida de alcance silenciosa, que es la peor clase.
--
-- Sólo toca las que están en NULL, y sólo cuando la zona del perfil pasa de
-- vacía a puesta. Mudarse (cambiar una zona por otra) NO reescribe nada: eso
-- sería contradecir la foto del momento de publicar.
-- ---------------------------------------------------------------------------
create or replace function app.profiles_zona_a_sus_posts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.posts p
     set area_label = new.area_label
   where p.author_id = new.id
     and p.area_label is null;
  return null;
end;
$$;

comment on function app.profiles_zona_a_sus_posts() is
  'AFTER UPDATE OF area_label en profiles: le pone zona a las publicaciones de esa persona que nacieron sin ninguna, cuando declara la suya por primera vez. No reescribe las que ya tienen (mudarse no mueve lo publicado). El valor igual lo re-deriva app.posts_area_label() en el BEFORE del UPDATE, así que sigue saliendo del servidor.';

drop trigger if exists profiles_zona_a_sus_posts on public.profiles;
create trigger profiles_zona_a_sus_posts
after update of area_label on public.profiles
for each row
when (
  nullif(btrim(coalesce(old.area_label, '')), '') is null
  and nullif(btrim(coalesce(new.area_label, '')), '') is not null
)
execute function app.profiles_zona_a_sus_posts();

-- El índice que sirve al feed con zona: mismo orden de keyset que
-- posts_feed_idx (0007), con la zona adelante. Parcial por `published` — el
-- feed no lee otra cosa. Sin CONCURRENTLY porque apply-migrations.mjs envuelve
-- cada archivo en begin/commit (ver el encabezado de la 0112).
create index if not exists posts_zona_feed_idx
  on public.posts (tenant_id, area_label, created_at desc, id desc)
  where status = 'published';

-- ---------------------------------------------------------------------------
-- 2. Las dos funciones del feed, con zona
--
-- DROP + CREATE y no `create or replace`: cambia la firma. Con las dos
-- versiones vivas a la vez, una llamada con los parámetros viejos sería
-- ambigua y Postgres la rechazaría. Así queda UNA sola función cuyo parámetro
-- nuevo tiene default, y el código desplegado hoy —que llama sin él— sigue
-- andando durante la ventana de deploy.
-- ---------------------------------------------------------------------------
drop function if exists public.feed_posts_page(uuid, timestamptz, uuid, int, text);

create function public.feed_posts_page(
  p_tenant_id         uuid,
  p_cursor_created_at timestamptz default null,
  p_cursor_id         uuid        default null,
  p_limit             int         default 9,
  p_entity_kind       text        default null,
  p_area_labels       text[]      default null
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
     -- ZONA (0115). null = sin zona elegida ⇒ no filtra. Lo orgánico se recorta
     -- sin excepciones; lo promocionado llega hasta donde su campaña compró.
     and (
          p_area_labels is null
       or p.area_label = any(p_area_labels)
       or exists (select 1 from public.post_promotions pr
                   where pr.post_id   = p.id
                     and pr.tenant_id = p.tenant_id
                     and pr.status    = 'active'
                     and pr.ends_at   > now()
                     and (
                          coalesce(pr.audience->>'scope', 'all') <> 'zones'
                       or exists (
                            select 1
                              from jsonb_array_elements_text(
                                     case when jsonb_typeof(pr.audience->'zones') = 'array'
                                          then pr.audience->'zones'
                                          else '[]'::jsonb end) z
                             where z = any(p_area_labels))
                     ))
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

comment on function public.feed_posts_page(uuid, timestamptz, uuid, int, text, text[]) is
  'Una página de posts del feed "Para ti" ya resuelta contra follows / post_promotions / user_blocks / zona DENTRO de la base: ningún id viaja por el querystring, que era el 414 de Kong a los ~8 KB. security invoker a propósito — posts_select (0091) sigue decidiendo qué fila se puede leer; p_tenant_id sólo acota, no aísla. p_entity_kind acota a posts de una ficha publicada de ese vertical (pestañas Publicaciones de Negocios y Profesionales). p_area_labels son las etiquetas EXACTAS que "Tu zona" resolvió con el match laxo de sameZoneLabel (0115): null = sin zona elegida y nunca "no hay nada"; lo promocionado la esquiva sólo hasta donde llega el audience que compró.';


drop function if exists public.feed_listings_page(uuid, timestamptz, uuid, int);

create function public.feed_listings_page(
  p_tenant_id         uuid,
  p_cursor_created_at timestamptz default null,
  p_cursor_id         uuid        default null,
  p_limit             int         default 9,
  p_area_labels       text[]      default null
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
     -- ZONA (0115): mismo criterio que los seis módulos — un aviso de otra zona
     -- no aparece, aunque sea premium. El impulso compra ORDEN adentro de una
     -- comunidad, no domicilio en otro barrio.
     and (p_area_labels is null or l.area_label = any(p_area_labels))
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

comment on function public.feed_listings_page(uuid, timestamptz, uuid, int, text[]) is
  'Hermana de feed_posts_page para el carril de avisos del "Para ti": misma regla de distribución premium (lib/monetization/feed.ts) resuelta en la base, sin inlinear los ids de follows ni de user_blocks en la URL. p_area_labels aplica "Tu zona" con el mismo criterio que los seis listados (0115): null = no filtrar.';

grant execute on function public.feed_posts_page(uuid, timestamptz, uuid, int, text, text[])
  to anon, authenticated, service_role;
grant execute on function public.feed_listings_page(uuid, timestamptz, uuid, int, text[])
  to anon, authenticated, service_role;

commit;
