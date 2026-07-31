-- =============================================================================
-- 0044_global_search.sql — Comunidad Latina
-- BÚSQUEDA GLOBAL (feedback consolidado 2026-07-30 §1): la barra de /buscar
-- devuelve resultados AGRUPADOS POR TIPO en una sola ida, no 7 queries desde el
-- cliente.
--
-- Por qué una RPC y no 7 selects:
--   * un solo lugar donde se aplica el tenant;
--   * un solo lugar donde se decide el `href` de cada tipo — si cada superficie
--     inventa su ruteo, el día que una ruta cambie quedan links muertos
--     repartidos por toda la app;
--   * SECURITY INVOKER: la RLS de cada tabla decide qué ve cada quien. Nadie
--     tiene que "acordarse de filtrar" en la UI, que es exactamente el modo de
--     falla que el enumerador (§5.2.1) existe para evitar.
--
-- Qué se agrega acá y por qué:
--   1. posts.search — tsvector generado (config 'spanish', igual que
--      listings.search de 0004) + GIN. Un post es PROSA: el stemming sirve y el
--      ranking sale comparable con el de listings porque usa la MISMA config.
--   2. profiles.display_name — índice GIN pg_trgm, NO tsvector. Un nombre no es
--      prosa: nadie lematiza "González" ni escribe una frase; se tipean 3 letras
--      y se espera coincidencia por substring/typo. Eso es trigrama, no FTS.
--   3. listings.search ya existe desde 0004 (verificado contra la base:
--      listings_search_idx, gin(search)) — no se toca nada.
--
-- LO QUE LA BASE **NO** GARANTIZA (contrato para la app): `image_url` sale CRUDO
-- tal como está guardado — puede ser una ruta del Storage
-- ({tenant}/{user}/archivo) o una URL absoluta de seed. Resolverlo es trabajo de
-- los helpers que ya existen (firstPhotoUrl / postMediaUrl). La DB no conoce
-- NEXT_PUBLIC_SUPABASE_URL y no debería.
-- =============================================================================


-- =============================================================================
-- 1 · Índices de búsqueda que faltaban
-- =============================================================================

-- ---------------------------------------------------------------------------
-- posts.search — FTS sobre el cuerpo del post
--
-- Un solo campo ⇒ sin setweight: no hay jerarquía título/descripción que
-- expresar (posts no tiene título). La config va EXPLÍCITA ('spanish') porque
-- to_tsvector(regconfig, text) es immutable solo con la config fijada — sin
-- ella la columna generada ni siquiera se puede crear.
-- ---------------------------------------------------------------------------
alter table public.posts
  add column search tsvector generated always as (
    to_tsvector('spanish', coalesce(body, ''))
  ) stored;

comment on column public.posts.search is
  'FTS del cuerpo del post, config ''spanish'' EXPLÍCITA — la misma que listings.search (0004), para que ts_rank() sea comparable entre publicaciones y avisos dentro de global_search(). Sin unaccent: unaccent() no es immutable y no puede vivir en una columna generada (misma nota que listings.search).';

create index posts_search_idx on public.posts using gin (search);

-- ---------------------------------------------------------------------------
-- profiles.display_name — trigrama
--
-- OJO con el costo real: una búsqueda de 2 caracteres NO puede usar este índice
-- (no hay trigramas que extraer) y cae en scan. Se acepta a conciencia:
-- `profiles` es la tabla más chica del esquema (una fila por persona, sin
-- historial) y la RPC filtra siempre por tenant. A partir de 3 caracteres el
-- índice entra y el costo se aplana.
-- ---------------------------------------------------------------------------
create index profiles_display_name_trgm_idx
  on public.profiles using gin (display_name extensions.gin_trgm_ops);


-- =============================================================================
-- 2 · Helpers
-- =============================================================================

-- ---------------------------------------------------------------------------
-- app.media_has_video — ¿este post trae un video?
--
-- posts.media es text[] SIN columna de tipo (0025): el kind se infiere por
-- extensión, exactamente como lo hace mediaKindOf() en
-- src/components/feed/helpers.ts. Esta función es el ESPEJO EN SQL de esa regla
-- — si un día se agrega una extensión hay que tocar los dos lados.
--
-- IMMUTABLE a propósito: así puede usarse dentro de CHECKs (lo hace 0046) y en
-- predicados de índice, no solo en un WHERE.
-- ---------------------------------------------------------------------------
create or replace function app.media_has_video(p_media text[])
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select exists (
    select 1
      from unnest(coalesce(p_media, '{}'::text[])) as m
     where m ~* '\.(mp4|webm|mov|m4v)(\?.*)?$'
  );
$$;

comment on function app.media_has_video(text[]) is
  'true si alguno de los medios del post tiene extensión de video (mp4/webm/mov/m4v). Espejo en SQL de mediaKindOf() (src/components/feed/helpers.ts): posts.media guarda fotos y videos en el mismo array sin columna de tipo (0025). IMMUTABLE para poder usarse en CHECK y en predicados de índice.';

-- ---------------------------------------------------------------------------
-- app.video_post_href — a dónde lleva tocar un video en los resultados
--
-- Existe como función SEPARADA de global_search() a propósito: 0046 introduce
-- el video publicitario (que NO vive en el scroll de Videos Cortos) y necesita
-- cambiar este destino. Con el href acá, esa migración reemplaza OCHO LÍNEAS en
-- vez de duplicar la RPC entera — y no hay dos copias del ruteo que puedan
-- divergir.
-- ---------------------------------------------------------------------------
create or replace function app.video_post_href(p_post_id uuid)
returns text
language sql
stable
set search_path = ''
as $$
  select '/videos?start=' || p_post_id::text;
$$;

comment on function app.video_post_href(uuid) is
  'Destino de un resultado de búsqueda de tipo ''videos''. Hoy siempre el reel (/videos?start=id). 0046 la re-crea para que el video publicitario abra su anuncio y no el scroll de Videos Cortos.';


-- =============================================================================
-- 3 · public.global_search — la RPC
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Contrato de salida (una fila POR RESULTADO):
--   result_type — personas | propiedades | negocios | profesionales | eventos |
--                 empleos | marketplace | videos | publicaciones
--   id          — id de la entidad (profiles.id | listings.id | posts.id)
--   title       — lo que se muestra grande
--   subtitle    — la segunda línea (zona, autor)
--   image_url   — CRUDO: ruta de Storage o URL absoluta (ver encabezado)
--   href        — ruta interna ya armada
--   rank        — orden DENTRO del grupo
--
-- SOBRE `rank`: ordena dentro de su result_type y nada más. Entre tipos NO es
-- comparable — ts_rank() (avisos y publicaciones) y similarity() (personas)
-- viven en escalas distintas. No es un defecto: la pantalla agrupa por tipo, así
-- que la comparación cruzada nunca ocurre. Documentarlo es más honesto que
-- fabricar un número que finja ser comparable.
--
-- TOPES DUROS:
--   * q < 2 caracteres ⇒ vuelve VACÍA sin tocar una sola tabla (la barra dispara
--     con debounce mientras se escribe: "a" no puede costar 4 scans);
--   * q se recorta a 80 caracteres — nadie busca una frase más larga, y un `q`
--     de 1 MB por PostgREST sería un ataque gratis contra websearch_to_tsquery;
--   * limit_per_type se clampa a [1, 20]: el tope lo pone la base, no el
--     parámetro que manda el cliente.
--
-- SIN TENANT ⇒ VACÍA (no error). Dos razones: (a) sin comunidad no hay nada que
-- buscar; (b) profiles_select es `using(true)` (perfil = contenido público SEO),
-- así que una llamada anónima sin filtro de tenant convertiría esta RPC en un
-- endpoint de enumeración de población — justo el vector que §5.4 prohíbe. Se
-- devuelve vacío y no una excepción para que la UI degrade elegante (§5.6): un
-- buscador que no encuentra nada es un estado, un 500 es un error crudo.
-- ---------------------------------------------------------------------------
create or replace function public.global_search(
  q               text,
  limit_per_type  int default 5
)
returns table (
  result_type text,
  id          uuid,
  title       text,
  subtitle    text,
  image_url   text,
  href        text,
  rank        real
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_uid    uuid := auth.uid();
  v_limit  int  := least(greatest(coalesce(limit_per_type, 5), 1), 20);
  v_q      text;
  v_like   text;
  v_ts     tsquery;
begin
  v_q := btrim(coalesce(q, ''));
  if char_length(v_q) < 2 or v_tenant is null then
    return; -- vacío, sin escanear nada
  end if;
  v_q := left(v_q, 80);

  -- websearch_to_tsquery puede quedar VACÍA si `q` es toda stopwords ("de la").
  -- No es un caso a esquivar: las ramas de FTS devuelven cero y la de personas
  -- (trigrama, sin stopwords) sigue funcionando. Es el comportamiento correcto.
  v_ts := websearch_to_tsquery('spanish', v_q);

  -- ILIKE con los comodines del usuario escapados: sin esto, buscar "100%"
  -- pasaría a matchear cualquier cosa.
  v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  -- -------------------------------------------------------------------------
  -- PERSONAS
  --
  -- El filtro de tenant lo pone la RPC, no la RLS: profiles_select es
  -- `using(true)` porque el perfil es contenido público (SEO). Acá buscamos
  -- DENTRO de la comunidad.
  -- No aparece quien tenga bloqueo con vos en cualquier dirección
  -- (app.pair_blocked): el buscador no puede ser la puerta de atrás que devuelve
  -- a alguien que bloqueaste al alcance de un clic.
  -- -------------------------------------------------------------------------
  return query
  select 'personas'::text,
         p.id,
         p.display_name,
         p.area_label,
         p.avatar_url,
         '/perfil/' || p.id::text,
         extensions.similarity(p.display_name, v_q)::real
    from public.profiles p
   where p.tenant_id = v_tenant
     and p.display_name ilike v_like escape '\'
     and (v_uid is null or not app.pair_blocked(v_uid, p.id))
   order by extensions.similarity(p.display_name, v_q) desc, p.display_name
   limit v_limit;

  -- -------------------------------------------------------------------------
  -- AVISOS — los 6 verticales en UNA sola pasada
  --
  -- Un solo scan de listings_search_idx con row_number() por kind, en vez de 6
  -- queries idénticas con LIMIT cada una. El tope por tipo sale de la ventana.
  --
  -- `creator_gig` queda AFUERA a propósito: Colaboraciones no es uno de los
  -- grupos del buscador global (§1 del contrato) y el módulo abre recién en
  -- 3-4 meses (§6). El `kind in (...)` mantiene el CASE total: ningún kind
  -- nuevo puede colarse con href nulo.
  --
  -- status = 'published': la RLS le deja ver al dueño sus borradores, pero un
  -- borrador en el buscador global es ruido — un resultado tiene que ser un
  -- destino real.
  --
  -- href de 'business': /marketplace/tienda/{id} — la tienda ES un listing
  -- kind='business' y esa es su única página de detalle hoy (/negocios no tiene
  -- ruta [id]).
  -- -------------------------------------------------------------------------
  return query
  select v.result_type, v.id, v.title, v.subtitle, v.image_url, v.href, v.rank
    from (
      select case l.kind
               when 'property'     then 'propiedades'
               when 'business'     then 'negocios'
               when 'professional' then 'profesionales'
               when 'event'        then 'eventos'
               when 'job'          then 'empleos'
               when 'product'      then 'marketplace'
             end                                        as result_type,
             l.id                                       as id,
             l.title                                    as title,
             l.area_label                               as subtitle,
             nullif(btrim(coalesce(l.photos[1], '')), '') as image_url,
             case l.kind
               when 'property'     then '/propiedades/'
               when 'business'     then '/marketplace/tienda/'
               when 'professional' then '/profesionales/'
               when 'event'        then '/eventos/'
               when 'job'          then '/empleos/'
               when 'product'      then '/marketplace/'
             end || l.id::text                          as href,
             ts_rank(l.search, v_ts)                    as rank,
             row_number() over (
               partition by l.kind
               order by ts_rank(l.search, v_ts) desc,
                        l.published_at desc nulls last,
                        l.id desc
             )                                          as rn
        from public.listings l
       where l.tenant_id = v_tenant
         and l.status = 'published'
         and l.kind in ('property', 'business', 'professional', 'event', 'job', 'product')
         and l.search @@ v_ts
    ) v
   where v.rn <= v_limit;

  -- -------------------------------------------------------------------------
  -- VIDEOS y PUBLICACIONES — también en una sola pasada
  --
  -- Los dos grupos salen de `posts` y son MUTUAMENTE EXCLUYENTES: un post con
  -- video cae en 'videos', el resto en 'publicaciones'. Sin esa exclusión, el
  -- mismo post aparecería dos veces en la misma pantalla.
  --
  -- image_url de un video PUEDE SER LA RUTA DEL VIDEO (posts.media mezcla fotos
  -- y videos sin orden garantizado). La app ya sabe distinguirlo con
  -- mediaKindOf() y renderizar un <video> en vez de un <img>.
  -- -------------------------------------------------------------------------
  return query
  select v.result_type, v.id, v.title, v.subtitle, v.image_url, v.href, v.rank
    from (
      select case when app.media_has_video(p.media) then 'videos' else 'publicaciones' end
                                                        as result_type,
             p.id                                       as id,
             left(btrim(p.body), 80)                    as title,
             au.display_name                            as subtitle,
             nullif(btrim(coalesce(p.media[1], '')), '') as image_url,
             case when app.media_has_video(p.media)
                  then app.video_post_href(p.id)
                  else '/feed/' || p.id::text
             end                                        as href,
             ts_rank(p.search, v_ts)                    as rank,
             row_number() over (
               partition by app.media_has_video(p.media)
               order by ts_rank(p.search, v_ts) desc, p.created_at desc, p.id desc
             )                                          as rn
        from public.posts p
        join public.profiles au on au.id = p.author_id
       where p.tenant_id = v_tenant
         and p.status = 'published'
         and p.search @@ v_ts
         and (v_uid is null or not app.pair_blocked(v_uid, p.author_id))
    ) v
   where v.rn <= v_limit;

  return;
end;
$$;

comment on function public.global_search(text, int) is
  'Búsqueda global agrupada por tipo, una sola ida. SECURITY INVOKER: la RLS de cada tabla decide qué ve cada quien (un resultado que no podés ver no aparece, sin filtrar nada en la UI). Devuelve VACÍO —no error— si q tiene menos de 2 caracteres o si el JWT no trae tenant. q se recorta a 80 caracteres y limit_per_type se clampa a [1,20]. `rank` ordena DENTRO del grupo; entre tipos no es comparable (ts_rank vs similarity) y no hace falta que lo sea porque la pantalla agrupa. `image_url` sale crudo (ruta de Storage o URL absoluta): lo resuelve la app.';

revoke execute on function public.global_search(text, int) from public;
grant execute on function public.global_search(text, int) to anon, authenticated, service_role;
