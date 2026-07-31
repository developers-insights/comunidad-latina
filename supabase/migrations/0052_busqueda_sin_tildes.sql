-- =============================================================================
-- 0052_busqueda_sin_tildes.sql — Comunidad Latina
-- LA BÚSQUEDA GLOBAL FALLA CON LAS PALABRAS MÁS COMUNES DEL PRODUCTO CUANDO SE
-- ESCRIBEN SIN TILDE — que es como las escribe casi todo el mundo desde el
-- teléfono. Medido contra esta misma base antes de tocar nada:
--
--   select to_tsvector('spanish','Habitación amplia en Corona');
--     → 'ampli':2 'coron':4 'habit':1
--   select websearch_to_tsquery('spanish','habitacion');   → 'habitacion'  ✗
--   select websearch_to_tsquery('spanish','habitación');   → 'habit'       ✓
--
--   global_search('habitacion') → 0 filas
--   global_search('habitación') → 2 filas (los dos avisos que existen)
--
-- El stemmer español RECORTA el sufijo acentuado ("Habitación" → 'habit'), pero
-- la misma palabra sin tilde no la reconoce y la deja entera ('habitacion'). Las
-- dos grafías nunca se encuentran. Lo mismo con panadería/panaderia,
-- inmigración/inmigracion, diseño/diseno, uñas/unas…
--
-- -----------------------------------------------------------------------------
-- LA RECETA OBVIA (unaccent antes del stemmer) TIENE UN COSTO QUE HAY QUE MEDIR
-- -----------------------------------------------------------------------------
-- El manual de `unaccent` propone una configuración que pasa unaccent ANTES del
-- stemmer. Funciona… y ROMPE el stemming del español, porque el stemmer Snowball
-- reconoce los sufijos POR la tilde. Medido, misma base:
--
--   palabra        to_tsvector('spanish')   con unaccent-antes-del-stemmer
--   orientación    'orient'                 'orientacion'
--   orientativa    'orient'                 'orient'      ← ya no se encuentran
--   barbería       'barb'                   'barberi'
--   barba          'barb'                   'barb'        ← ya no se encuentran
--   preparación    'prepar'                 'preparacion'
--
-- Barrido sobre TODO el vocabulario real de listings publicados (182 términos de
-- ≥4 letras sacados de title + area_label), consultando cada uno como está
-- escrito: con la config sola se PIERDEN 6 términos (barba 5→2, comida 7→5,
-- orientación 3→1, barbería 5→4, orientativa 3→2, preparación 4→3). En posts,
-- 1 más ('dónde' 2→0). Eso es una regresión real, no una nota al pie.
--
-- -----------------------------------------------------------------------------
-- LO QUE SE HACE EN SU LUGAR: EL DOCUMENTO GUARDA LAS DOS LECTURAS
-- -----------------------------------------------------------------------------
-- `search` pasa a ser la UNIÓN de los dos análisis del mismo texto:
--
--   to_tsvector('spanish', x)  ||  to_tsvector('spanish_unaccent', x)
--
-- y la consulta se arma igual, uniendo las dos tsquery con OR. Con eso las
-- cuatro combinaciones cierran, incluida la que se olvida siempre — alguien
-- publicó "Habitacion en Corona" sin tilde y otro busca "habitación":
--
--   consulta \ documento   con tilde                sin tilde
--   con tilde              rama spanish   ✓         rama unaccent ✓
--   sin tilde              rama unaccent  ✓         ambas         ✓
--
-- Es correcto POR CONSTRUCCIÓN, no por suerte: la rama unaccent del documento
-- produce exactamente spanish_stem(unaccent(palabra)), que es el mismo lexema
-- que produce la consulta tipeada sin tildes. No hay caso que se escape.
--
-- Medido, listings publicados, 182 términos:
--   * consulta CON tilde (lo que ya andaba): 182 iguales, 0 pierden.
--   * consulta SIN tilde: 15 términos pasan de 0 resultados a tenerlos
--     (espanol 0→8, barberia 0→4, preparacion 0→3, unas 0→3, disenador 0→2,
--      diseno 0→2, habitacion 0→2, inmigracion 0→2, panaderia 0→2, campana,
--      ciudadania, ninera, orientacion, paqueteria, peluqueria 0→1), 0 pierden.
--   * ts_rank: el orden de los 16 resultados de "corona" no se mueve NI UNA
--     posición. La unión duplica posiciones de forma pareja y ts_rank usa
--     normalización 0 (ignora el largo del documento).
--
-- LO QUE CUESTA: la columna tsvector crece ~20% (listings 16 kB → 19 kB;
-- posts 3552 B → 4226 B sobre el corpus actual). Los lexemas que coinciden en
-- las dos ramas se fusionan en una sola entrada — sólo pagan los acentuados.
-- A cambio no se pierde ni un resultado. Es el trade correcto.
--
-- LO QUE SE ACEPTA A CONCIENCIA: unaccent colapsa pares reales del español
-- (año/ano, papá/papa, peña/pena). En la rama unaccent "año" y "ano" quedan en
-- el mismo lexema. La rama `spanish` los sigue distinguiendo, así que el
-- resultado exacto sigue rankeando arriba; lo que aparece es ruido al final de
-- la lista, no un resultado perdido. Es el precio conocido de que se pueda
-- buscar sin tildes, y es mucho más barato que el defecto que arregla.
--
-- -----------------------------------------------------------------------------
-- POR QUÉ LA CONFIG VIVE EN `public`
-- -----------------------------------------------------------------------------
-- Tiene que ser nombrable desde DOS lugares con reglas distintas:
--   * las funciones con `set search_path = ''` (global_search, 0044) sólo pueden
--     nombrarla CALIFICADA → `public.spanish_unaccent` funciona;
--   * PostgREST, que resuelve el nombre de la config con su search_path
--     (public, extensions) cuando la app manda `textSearch(..., {config})`.
-- `app` queda afuera: no está en el search_path de PostgREST. `extensions` queda
-- afuera: ahí viven los objetos DE LAS EXTENSIONES, que Supabase administra; una
-- config nuestra puesta ahí es nuestra y no tiene por qué depender del ciclo de
-- vida de una extensión ajena.
--
-- -----------------------------------------------------------------------------
-- INMUTABILIDAD: PROBADO, NO SUPUESTO
-- -----------------------------------------------------------------------------
-- Una columna generada exige expresión IMMUTABLE. `to_tsvector(regconfig, text)`
-- está declarada IMMUTABLE aunque la config use unaccent (verificado en
-- pg_proc.provolatile = 'i'), y Postgres ACEPTÓ la columna generada con la
-- config nueva — probado en una transacción de prueba antes de escribir esto.
-- No hizo falta ningún wrapper para el tsvector.
--
-- RIESGO QUE QUEDA ABIERTO: esa inmutabilidad es una DECLARACIÓN, no una
-- garantía. Si algún día cambia el diccionario de unaccent (upgrade de la
-- extensión, edición de unaccent.rules) los lexemas ya guardados en `search` y
-- las claves de los índices GIN quedan viejos y hay que reindexar:
--   update public.listings set title = title;  -- fuerza recálculo del generated
--   update public.posts    set body  = body;
--   reindex index public.profiles_display_name_unaccent_trgm_idx;
-- Es el mismo riesgo que documenta el manual de unaccent para índices y es la
-- razón por la que este comentario existe.
--
-- -----------------------------------------------------------------------------
-- CÓMO SE CAMBIA UNA COLUMNA GENERADA (y por qué NO hay drop + add acá)
-- -----------------------------------------------------------------------------
-- Inventario de dependencias tomado contra la base ANTES de tocar, vía pg_depend
-- sobre listings.search y posts.search: UN índice cada una
-- (listings_search_idx, posts_search_idx) y nada más — ninguna vista, política,
-- constraint ni trigger las menciona.
--
-- Con eso a la vista, DROP + ADD sería la herramienta equivocada: esta base es
-- PostgreSQL 17.6 y soporta `ALTER COLUMN … SET EXPRESSION AS`, que reescribe la
-- tabla y REINDEXA dejando el índice, la posición de la columna (attnum 22),
-- los comentarios y los privilegios EXACTAMENTE donde estaban. Probado en
-- transacción: el índice sobrevive con la misma definición y las 58 filas
-- quedan reindexadas. DROP + ADD haría lo mismo pero abriendo una ventana sin
-- índice, moviendo la columna al final (cambia el orden de `select *`) y
-- obligando a recrear a mano privilegios y comentarios: más pasos, más
-- superficie para equivocarse, cero beneficio. Se elige la operación de menos
-- piezas móviles.
--
-- Dependencias: 0004 (listings.search), 0044 (posts.search, global_search,
-- profiles_display_name_trgm_idx), 0019 (match_chunks_fts). Requiere PG ≥ 17.
-- =============================================================================


-- =============================================================================
-- 1 · La configuración de texto
-- =============================================================================

create text search configuration public.spanish_unaccent ( copy = pg_catalog.spanish );

-- Sólo los tokens que PUEDEN traer un acento. `asciiword`, `asciihword` y
-- `hword_asciipart` los define el parser como ASCII puro: pasarles unaccent
-- sería trabajo por token para no cambiar nada. Los tipos numéricos, url, email
-- y file siguen con `simple`, tal cual los deja la copia de `spanish`.
alter text search configuration public.spanish_unaccent
  alter mapping for word, hword, hword_part
  with extensions.unaccent, pg_catalog.spanish_stem;

comment on text search configuration public.spanish_unaccent is
  'Español con los acentos normalizados ANTES del stemmer (unaccent → spanish_stem) para word/hword/hword_part. Vive en `public` porque tiene que ser nombrable calificada desde funciones con search_path='''' (global_search) Y por PostgREST, que resuelve la config con search_path=public,extensions. NO reemplaza a ''spanish'': se usa JUNTO con ella — las columnas `search` guardan la unión de los dos análisis, porque el stemmer español reconoce los sufijos por la tilde y unaccent solo perdería recall (orientación/orientativa, barbería/barba). Ver el encabezado de 0052 con las mediciones.';


-- =============================================================================
-- 2 · unaccent inmutable — para los índices de expresión
-- =============================================================================

-- Las DOS formas de unaccent() están declaradas STABLE (verificado en pg_proc,
-- también la de dos argumentos), así que ninguna puede entrar directo en un
-- índice. Este wrapper es el patrón que documenta el propio manual de unaccent:
-- se DECLARA immutable y el que firma se hace cargo de reindexar si el
-- diccionario cambia (ver "RIESGO QUE QUEDA ABIERTO" arriba).
--
-- Fija el diccionario POR NOMBRE CALIFICADO ('extensions.unaccent'::regdictionary)
-- en vez de usar unaccent(text): la forma de un argumento resuelve el
-- diccionario por search_path en tiempo de ejecución, y un índice cuyo
-- contenido dependa del search_path de quien escribe la fila es un índice
-- corrupto esperando su turno.
--
-- El `set search_path = ''` además IMPIDE el inlining, que acá es lo que
-- queremos: si Postgres expandiera el cuerpo, la expresión del WHERE dejaría de
-- ser igual a la del índice y el índice no se usaría nunca.
create or replace function app.unaccent_immutable(p_text text)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select extensions.unaccent('extensions.unaccent'::regdictionary, p_text);
$$;

comment on function app.unaccent_immutable(text) is
  'unaccent() con el diccionario FIJADO por nombre calificado y declarado IMMUTABLE para poder vivir en un índice de expresión (extensions.unaccent es STABLE en las dos formas y no sirve). Se usa para que la búsqueda de personas por trigrama encuentre "Peña" tipeando "pena". La inmutabilidad es una declaración: si cambia unaccent.rules hay que reindexar profiles_display_name_unaccent_trgm_idx (0052).';


-- =============================================================================
-- 3 · listings.search — la unión de los dos análisis
-- =============================================================================

-- ALTER COLUMN … SET EXPRESSION (PG 17): reescribe y reindexa in situ. El índice
-- listings_search_idx NO se toca — sigue siendo el mismo objeto, con la misma
-- definición, y queda reconstruido sobre los lexemas nuevos.
--
-- Los pesos A/B/C se repiten idénticos en las dos ramas: title sigue pesando más
-- que description sin importar por cuál de las dos lecturas entró el match, así
-- que el ranking no cambia de criterio.
alter table public.listings
  alter column search set expression as (
    setweight(to_tsvector('pg_catalog.spanish',      coalesce(title,       '')), 'A') ||
    setweight(to_tsvector('pg_catalog.spanish',      coalesce(description, '')), 'B') ||
    setweight(to_tsvector('pg_catalog.spanish',      coalesce(area_label,  '')), 'C') ||
    setweight(to_tsvector('public.spanish_unaccent', coalesce(title,       '')), 'A') ||
    setweight(to_tsvector('public.spanish_unaccent', coalesce(description, '')), 'B') ||
    setweight(to_tsvector('public.spanish_unaccent', coalesce(area_label,  '')), 'C')
  );

comment on column public.listings.search is
  'FTS de title(A)/description(B)/area_label(C), con los DOS análisis del mismo texto en la misma columna: ''spanish'' (stemming completo, necesita la tilde) y ''spanish_unaccent'' (0052, encuentra lo mismo tipeado sin tildes). Guardar los dos es lo que permite arreglar "habitacion" SIN perder "barba"→"barbería", que sí se perdía usando solo unaccent — medido en 0052. Cuesta ~20% de tamaño; los lexemas iguales se fusionan y sólo pagan los acentuados. Consultar preferentemente con la MISMA unión (ver global_search); con ''spanish'' sola también funciona y no pierde nada.';


-- =============================================================================
-- 4 · posts.search — lo mismo
-- =============================================================================

-- Un solo campo ⇒ sin setweight, igual que en 0044.
alter table public.posts
  alter column search set expression as (
    to_tsvector('pg_catalog.spanish',      coalesce(body, '')) ||
    to_tsvector('public.spanish_unaccent', coalesce(body, ''))
  );

comment on column public.posts.search is
  'FTS del cuerpo del post con los DOS análisis (''spanish'' + ''spanish_unaccent'', 0052), igual que listings.search — así ts_rank() sigue siendo comparable entre publicaciones y avisos dentro de global_search(). Ver el encabezado de 0052: la unión existe porque unaccent solo también perdía resultados (''dónde'' 2→0 en este mismo corpus).';


-- =============================================================================
-- 5 · Personas — trigrama insensible a acentos
-- =============================================================================

-- global_search busca personas por ILIKE + similarity sobre display_name, y eso
-- es tan sensible a la tilde como el FTS: "pena" no encuentra "Franklin Peña",
-- "nunez" no encuentra "Marisol Núñez", "maria" no encuentra "María Peralta"
-- (los tres medidos, los tres devolvían 0).
--
-- El arreglo es acotado: unaccent de los DOS lados de la comparación. Eso deja
-- inservible al índice de 0044 para ESTA consulta, así que va el índice que
-- corresponde a la expresión nueva. Verificado con el planner (enable_seqscan
-- off): Bitmap Index Scan on profiles_display_name_unaccent_trgm_idx.
--
-- profiles_display_name_trgm_idx (0044) NO se borra: /admin/miembros sigue
-- filtrando con `.ilike("display_name", …)` crudo
-- (src/app/admin/miembros/page.tsx) y ese índice es el que lo sostiene. Dos
-- índices GIN sobre la tabla más chica del esquema (16 kB hoy) es un costo que
-- se paga sin discutir; borrar el que todavía tiene un consumidor, no.
create index profiles_display_name_unaccent_trgm_idx
  on public.profiles using gin (app.unaccent_immutable(display_name) extensions.gin_trgm_ops);

comment on index public.profiles_display_name_unaccent_trgm_idx is
  'Trigramas sobre el display_name SIN acentos: es el que hace que "pena" encuentre a "Peña" en global_search. Convive con profiles_display_name_trgm_idx (0044), que sigue sirviendo al ILIKE crudo de /admin/miembros. La expresión tiene que ser IDÉNTICA a la del WHERE (app.unaccent_immutable(display_name)) o el índice no se usa.';


-- =============================================================================
-- 6 · public.global_search — las dos puntas, o no sirve
-- =============================================================================

-- ÚNICO CAMBIO respecto de 0044/0046: cómo se arma la consulta.
--   * FTS: v_ts pasa a ser la UNIÓN de las dos tsquery. Cambiar sólo el
--     documento (o sólo la consulta) EMPEORA: los lexemas de un lado dejan de
--     existir del otro. Van juntos o no van.
--   * PERSONAS: unaccent de los dos lados, contra el índice de expresión nuevo.
-- Todo lo demás —contrato de salida, topes duros, tenant, bloqueos, hrefs— queda
-- literal. Se re-declara entera porque plpgsql no admite parches parciales.
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
  v_qu     text;
  v_like   text;
  v_ts     tsquery;
begin
  v_q := btrim(coalesce(q, ''));
  if char_length(v_q) < 2 or v_tenant is null then
    return; -- vacío, sin escanear nada
  end if;
  v_q := left(v_q, 80);

  -- La consulta se lee de las DOS maneras y se unen con OR, igual que el
  -- documento. Con la tilde entra por la rama 'spanish'; sin la tilde, por la
  -- rama 'spanish_unaccent'. Cualquiera de las dos alcanza para encontrar un
  -- documento que guardó ambas.
  --
  -- Puede quedar VACÍA si `q` es toda stopwords ("de la"). No es un caso a
  -- esquivar: las ramas de FTS devuelven cero y la de personas (trigrama, sin
  -- stopwords) sigue funcionando. Es el comportamiento correcto.
  v_ts := websearch_to_tsquery('pg_catalog.spanish', v_q)
       || websearch_to_tsquery('public.spanish_unaccent', v_q);

  -- Para personas se compara SIN acentos de los dos lados. El patrón se arma
  -- DESPUÉS de sacar los acentos y ANTES de escapar los comodines, para que el
  -- escape siga cubriendo lo que tiene que cubrir: sin esto, buscar "100%"
  -- pasaría a matchear cualquier cosa.
  v_qu   := app.unaccent_immutable(v_q);
  v_like := '%' || replace(replace(replace(v_qu, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  -- -------------------------------------------------------------------------
  -- PERSONAS
  --
  -- El filtro de tenant lo pone la RPC, no la RLS: profiles_select es
  -- `using(true)` porque el perfil es contenido público (SEO). Acá buscamos
  -- DENTRO de la comunidad.
  -- No aparece quien tenga bloqueo con vos en cualquier dirección
  -- (app.pair_blocked): el buscador no puede ser la puerta de atrás que devuelve
  -- a alguien que bloqueaste al alcance de un clic.
  --
  -- app.unaccent_immutable(p.display_name) tiene que quedar TAL CUAL en el WHERE
  -- y en el ORDER BY: es la expresión indexada por
  -- profiles_display_name_unaccent_trgm_idx. Cualquier variante (un lower() de
  -- más, otro orden) devuelve lo mismo pero por seq scan.
  -- -------------------------------------------------------------------------
  return query
  select 'personas'::text,
         p.id,
         p.display_name,
         p.area_label,
         p.avatar_url,
         '/perfil/' || p.id::text,
         extensions.similarity(app.unaccent_immutable(p.display_name), v_qu)::real
    from public.profiles p
   where p.tenant_id = v_tenant
     and app.unaccent_immutable(p.display_name) ilike v_like escape '\'
     and (v_uid is null or not app.pair_blocked(v_uid, p.id))
   order by extensions.similarity(app.unaccent_immutable(p.display_name), v_qu) desc,
            p.display_name
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
  'Búsqueda global agrupada por tipo, una sola ida. INSENSIBLE A LOS ACENTOS desde 0052: consulta y documento se leen con ''spanish'' Y con ''spanish_unaccent'' y se unen con OR — las dos puntas, o empeora. SECURITY INVOKER: la RLS de cada tabla decide qué ve cada quien (un resultado que no podés ver no aparece, sin filtrar nada en la UI). Devuelve VACÍO —no error— si q tiene menos de 2 caracteres o si el JWT no trae tenant. q se recorta a 80 caracteres y limit_per_type se clampa a [1,20]. `rank` ordena DENTRO del grupo; entre tipos no es comparable (ts_rank vs similarity) y no hace falta que lo sea porque la pantalla agrupa. `image_url` sale crudo (ruta de Storage o URL absoluta): lo resuelve la app.';

revoke execute on function public.global_search(text, int) from public;
grant execute on function public.global_search(text, int) to anon, authenticated, service_role;


-- =============================================================================
-- 7 · public.match_chunks_fts — el Asistente tiene el MISMO defecto
-- =============================================================================

-- SÍ CORRESPONDE, y la decisión no es por simetría sino porque está medido:
-- quien le escribe al Asistente teclea igual que quien usa el buscador. Barrido
-- sobre los 21 chunks reales, consultando cada palabra acentuada del corpus en
-- su forma SIN tilde: hoy 21 términos devuelven menos de lo que deberían
-- —espanol 0→3, ninos 0→2, habitacion 0→2, combinacion 0→2, inmigracion,
-- asesoria, declaracion, lavanderia, paqueteria, dueno, podes… — y con la unión
-- pasan a encontrar. Control de no-regresión sobre los 367 términos del corpus
-- consultados como están escritos: 362 iguales, 5 mejoran, 0 pierden.
--
-- Y ADEMÁS ES GRATIS: acá el tsvector se calcula al vuelo, no hay columna
-- generada ni índice GIN que reconstruir. 21 filas, seq scan, service_role.
-- Un arreglo que no cuesta nada y que evita que el Asistente conteste "todavía
-- no tengo información verificada" teniendo la respuesta indexada.
--
-- Se re-declara entera (plpgsql). Cambia SOLO cómo se arma la consulta y cómo se
-- arma el documento; el doble-gate de published, la seguridad y el contrato de
-- retorno quedan idénticos a 0019.
create or replace function public.match_chunks_fts(
  p_query       text,
  p_tenant_id   uuid,
  p_match_count int default 6
)
returns table (
  content     text,
  metadata    jsonb,
  source_kind text,
  source_id   uuid,
  similarity  float
)
language plpgsql
stable
security definer
set search_path = public, app, extensions
as $$
declare
  -- Clampeado aunque sea solo-service_role (defensa en profundidad).
  v_count      int := least(greatest(coalesce(p_match_count, 6), 1), 20);
  v_lexemes    text;
  v_lexemes_ua text;
  v_query      tsquery;
begin
  if p_query is null or length(btrim(p_query)) = 0 then
    return;
  end if;

  -- Construcción OR: una pregunta natural ("¿qué hago si ICE toca mi puerta?")
  -- con websearch/plainto se convierte en un AND de TODOS los términos → ningún
  -- chunk contiene las 5 palabras y no matchea nada. En cambio tokenizamos la
  -- pregunta (to_tsvector: stemming + saca stopwords/signos) y unimos los
  -- lexemas con OR: matchea cualquier chunk con AL MENOS una palabra relevante,
  -- y ts_rank ordena arriba a los que cubren más términos. Es lo correcto para
  -- una KB chica de preguntas/respuestas: recall alto, precisión por ranking.
  --
  -- Desde 0052 se tokeniza DOS VECES, una por cada lectura del español. Las dos
  -- listas se convierten a tsquery con SU PROPIA config (re-parsear los lexemas
  -- de una con la otra los volvería a stemmear mal) y recién ahí se unen.
  v_lexemes    := array_to_string(
    tsvector_to_array(to_tsvector('pg_catalog.spanish', p_query)), ' | '
  );
  v_lexemes_ua := array_to_string(
    tsvector_to_array(to_tsvector('public.spanish_unaccent', p_query)), ' | '
  );
  if coalesce(v_lexemes, '') = '' and coalesce(v_lexemes_ua, '') = '' then
    return; -- solo stopwords/signos: nada que buscar
  end if;

  -- to_tsquery re-parsea los lexemas; ante input raro (un lexema con caracteres
  -- que to_tsquery rechaza) se cae a plainto para no romper la búsqueda.
  -- Las ramas vacías se saltean: to_tsquery('') es un error, no una tsquery
  -- vacía.
  begin
    v_query := ''::tsquery;
    if coalesce(v_lexemes, '') <> '' then
      v_query := v_query || to_tsquery('pg_catalog.spanish', v_lexemes);
    end if;
    if coalesce(v_lexemes_ua, '') <> '' then
      v_query := v_query || to_tsquery('public.spanish_unaccent', v_lexemes_ua);
    end if;
  exception when others then
    v_query := plainto_tsquery('pg_catalog.spanish', p_query)
            || plainto_tsquery('public.spanish_unaccent', p_query);
  end;
  if v_query is null or numnode(v_query) = 0 then
    return;
  end if;

  return query
  with matched as (
    select c.content,
           c.metadata,
           c.source_kind,
           c.source_id,
           -- El índice a buscar suma el contenido + campos citables del
           -- metadata (título/zona/resumen) para mejorar el recall sin importar
           -- si el chunk quedó cortado antes del título. Las dos lecturas del
           -- español van en el mismo tsvector, igual que en listings/posts.
           ts_rank(
             to_tsvector(
               'pg_catalog.spanish',
               coalesce(c.content, '') || ' ' ||
                 coalesce(c.metadata->>'title', '') || ' ' ||
                 coalesce(c.metadata->>'summary', '') || ' ' ||
                 coalesce(c.metadata->>'area_label', '')
             ) ||
             to_tsvector(
               'public.spanish_unaccent',
               coalesce(c.content, '') || ' ' ||
                 coalesce(c.metadata->>'title', '') || ' ' ||
                 coalesce(c.metadata->>'summary', '') || ' ' ||
                 coalesce(c.metadata->>'area_label', '')
             ),
             v_query
           ) as rank
      from public.rag_chunks c
     where (c.tenant_id = p_tenant_id or c.tenant_id is null)
       -- Doble gate anti-fuga idéntico a match_chunks (0017): aunque el
       -- pipeline solo indexa contenido publicado, se re-chequea EN VIVO que la
       -- fuente siga publicada — un aviso despublicado ayer no se cita hoy.
       and (
         (c.source_kind = 'guide' and exists (
           select 1 from public.guides g
            where g.id = c.source_id and g.status = 'published'
         ))
         or (c.source_kind = 'listing' and exists (
           select 1 from public.listings l
            where l.id = c.source_id and l.status = 'published'
         ))
         or c.source_kind = 'faq'
       )
       and (
         to_tsvector(
           'pg_catalog.spanish',
           coalesce(c.content, '') || ' ' ||
             coalesce(c.metadata->>'title', '') || ' ' ||
             coalesce(c.metadata->>'summary', '') || ' ' ||
             coalesce(c.metadata->>'area_label', '')
         ) ||
         to_tsvector(
           'public.spanish_unaccent',
           coalesce(c.content, '') || ' ' ||
             coalesce(c.metadata->>'title', '') || ' ' ||
             coalesce(c.metadata->>'summary', '') || ' ' ||
             coalesce(c.metadata->>'area_label', '')
         )
       ) @@ v_query
  )
  select m.content,
         m.metadata,
         m.source_kind,
         m.source_id,
         -- Normalización suave a 0-1 (ts_rank es ilimitado hacia arriba pero en
         -- la práctica << 1): rank/(rank+1). Monótona → no altera el orden.
         (m.rank / (m.rank + 1))::float as similarity
    from matched m
   order by m.rank desc
   limit v_count;
end;
$$;

comment on function public.match_chunks_fts(text, uuid, int) is
  'Recuperación por texto completo (español) del Asistente RAG — gemelo de match_chunks(0017) SIN embeddings. Insensible a los acentos desde 0052 (pregunta y chunk se leen con ''spanish'' Y con ''spanish_unaccent''): quien le escribe al Asistente teclea sin tildes igual que quien usa el buscador. Mismo doble-gate de published en vivo y misma seguridad. p_tenant_id → chunks del tenant + globales (tenant_id null). EXECUTE SOLO service_role (fiscal R3): se invoca únicamente server-side desde /api/assistant, que aplica moderación + rate limit ANTES de buscar.';

-- Los DEFAULT PRIVILEGES de Supabase otorgan EXECUTE a anon/authenticated al
-- crear la función — el revoke explícito por rol es OBLIGATORIO (igual que 0017).
revoke execute on function public.match_chunks_fts(text, uuid, int) from public;
revoke execute on function public.match_chunks_fts(text, uuid, int) from anon, authenticated;
grant execute on function public.match_chunks_fts(text, uuid, int) to service_role;


-- =============================================================================
-- 8 · Estadísticas
-- =============================================================================

-- Las tres tablas quedaron reescritas o con un índice nuevo: sin ANALYZE, el
-- planner sigue con las estadísticas viejas de columnas que ya no contienen lo
-- mismo.
analyze public.listings;
analyze public.posts;
analyze public.profiles;
