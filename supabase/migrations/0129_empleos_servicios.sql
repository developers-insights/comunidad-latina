-- =============================================================================
-- 0129 — SERVICIOS EN EMPLEOS: la gente también OFRECE lo que sabe hacer
-- =============================================================================
--
-- ORIGEN: call con el cliente del 2026-09-03 (48:42–57:00), punto 12 del
-- feedback. Los chips de /empleos eran tres JORNADAS del mismo objeto (tiempo
-- completo / medio tiempo / ocasional) y el cliente pidió otra división, que no
-- es de jornada sino de QUÉ ES el aviso:
--
--   · Empleos    "un empleo es full-time, part-time, todo eso" — el restaurante
--                que busca cocinero y meseros.
--   · Ocasional  trabajos de uno o dos días, estilo Craigslist ("necesito un
--                carpintero sábado y domingo"). Sigue siendo `one_off`.
--   · Servicios  la gente OFRECE: "soy jardinero, disponible sábados y
--                domingos", "arreglo computadoras", "cambio la pantalla del
--                celular". DISTINTO de Profesionales, que —palabras del
--                cliente— son "gente con licencia".
--
-- Las dos primeras ya existían en `attrs.employment_type`. La tercera no existía
-- en ningún lado: "Servicio de creador" (Creator Marketplace) es otra cosa.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- QUÉ HACE ESTE ARCHIVO — Y LO QUE DELIBERADAMENTE NO HACE
-- ═══════════════════════════════════════════════════════════════════════════
--
-- HACE tres cosas:
--   1. suma 'service' al CHECK de `listings.kind`;
--   2. crea los dos índices que necesitan las pestañas nuevas;
--   3. re-declara `public.global_search` para que un servicio aparezca en el
--      buscador global, dentro del grupo "Empleos".
--
-- NO CREA NINGUNA TABLA, y esa es la decisión de fondo. Un servicio es un aviso
-- de la misma sección: se publica igual, se modera igual, se reporta igual, se
-- guarda igual y vence igual. Modelarlo como `listings` con un `kind` nuevo lo
-- hace heredar de una sola vez la RLS por tenant, la moderación (finalizeJob y
-- finalizeService comparten motor), los reportes y la auto-pausa (0118), los
-- guardados (0038), el vencimiento (0098), el feed y la búsqueda. Una tabla
-- `services` paralela habría tenido que re-ganarse esas diez cosas, y la primera
-- que se olvidara sería un agujero.
--
-- NO CREA POLICIES NI GRANTS, y eso se VERIFICÓ leyendo el código, no se supuso:
-- las cuatro policies de `listings` (0004, con `listings_insert` reescrita por
-- 0126) no nombran ningún `kind` en ninguna de sus ramas — filtran por
-- `tenant_id = app.current_tenant_id()`, por `created_by = auth.uid()`, por
-- `status` y por rol. Un `kind` nuevo queda cubierto por construcción. Y los
-- GRANT son de TABLA, no de fila: `listings` ya los tiene desde 0085.
--
-- NO TOCA EL GATE DE IDENTIDAD (`app.vertical_exige_identidad`, 0106/0126), y
-- eso SÍ es una decisión de producto que hay que leer como tal: la función
-- exige identidad verificada en property, product, job y en el evento que cobra
-- entrada. `service` no entra, así que publicar un servicio NO va a pedir
-- documento. El criterio: es el aviso de menor fricción del módulo —"soy
-- jardinero, sábados y domingos"— y pedirle cédula a quien ofrece cortar el
-- pasto apagaría la pestaña antes de que arranque; la red que sí corre es la
-- misma que en Profesionales (que tampoco lo exige): moderación del texto antes
-- de publicar, Trust Score visible, reportes y auto-pausa. El feedback del 3/9
-- dejó ANOTADO como input pendiente confirmarlo con el cliente ("un servicio es
-- un aviso simple sin verificación de licencia, así lo describió"). Si la
-- respuesta cambia, el cambio es UNA rama en `app.vertical_exige_identidad` MÁS
-- la del código — nunca sólo en el código.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- DÓNDE GUARDA CADA COSA UN SERVICIO (ninguna columna es nueva)
-- ═══════════════════════════════════════════════════════════════════════════
--
--   qué hace         → `title` + `description`
--   zona             → `area_label` (+ `work_mode`, 0087: "arreglo
--                      computadoras" puede resolverse a distancia)
--   disponibilidad   → `attrs.work_days` + `attrs.schedule`, LAS MISMAS claves
--                      que ya escribe un empleo (contrato en
--                      `src/lib/empleos/detalles.ts`). "Sábados y domingos" es
--                      el mismo hecho que "qué días se trabaja": inventarle un
--                      `attrs.availability` sería el mismo dato con dos nombres,
--                      y el primer informe que los cruce falla.
--   precio de refer. → `price_amount` (el PISO, "desde") + `price_period`.
--                      NULL = "a convenir", que en un servicio es una respuesta
--                      legítima y no un dato faltante: el jardinero cotiza
--                      mirando el patio.
--
-- Lo que un servicio NO escribe: `attrs.employment_type` (no hay jornada) ni
-- `attrs.questions` (no hay postulación — se contacta por Mensajes).
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- CÓMO VOLVER ATRÁS
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Este archivo NO destruye nada, así que el rollback es simétrico y seguro sólo
-- MIENTRAS no exista ninguna fila `kind='service'`:
--
--   drop index if exists public.listings_empleos_idx;
--   drop index if exists public.listings_job_employment_type_idx;
--   -- volver a poner el CHECK sin 'service' (falla si ya hay filas service)
--   -- y re-aplicar la sección 6 de la 0052 para `global_search`.
--
-- Con servicios ya publicados, el rollback correcto es despublicarlos primero
-- (`status='closed'`) y recién después revertir el CHECK.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- QUÉ NO SE PUDO VERIFICAR EN VIVO AL ESCRIBIR ESTO
-- ═══════════════════════════════════════════════════════════════════════════
--
-- El MCP de Supabase de este proyecto devolvió "Connection terminated due to
-- connection timeout" en los tres intentos de leer `pg_constraint` y
-- `list_migrations` — el mismo síntoma que ya dejó anotado el encabezado de la
-- 0126. Así que el nombre y la definición ACTUALES del CHECK en producción no
-- están re-verificados por quien escribió este archivo. Por eso el do-block
-- busca la constraint por su DEFINICIÓN y no por su nombre, y por eso las dos
-- creaciones de índice llevan `if not exists`: el archivo es correcto tanto si
-- la base está exactamente como la describen las migraciones del repo como si
-- alguien la tocó a mano en el medio. ANTES DE APLICAR, correr:
--
--   select conname, pg_get_constraintdef(oid)
--     from pg_constraint
--    where conrelid = 'public.listings'::regclass and contype = 'c';
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. listings.kind += 'service'
--
-- El do-block busca la constraint por su DEFINICIÓN y no por su nombre porque
-- ya cambió de nombre una vez (0004 la creó anónima, 0024 la rebautizó
-- `listings_kind_check`, 0096 la volvió a soltar y crear con ese nombre).
-- Copiado de 0096 a propósito: el que corra esto sobre una base con historia
-- distinta no debería tener que averiguar cómo se llama. De paso lo deja
-- re-corrible: si ya se aplicó, la busca de nuevo por definición, la suelta y la
-- vuelve a crear idéntica — no falla la segunda vez.
-- ---------------------------------------------------------------------------
do $$
declare
  v_name text;
begin
  select conname into v_name
    from pg_constraint
   where conrelid = 'public.listings'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) like '%kind = ANY%';
  if v_name is not null then
    execute format('alter table public.listings drop constraint %I', v_name);
  end if;
end;
$$;

alter table public.listings
  add constraint listings_kind_check
  check (kind in (
    'property', 'business', 'professional', 'event', 'job',
    'service', 'product', 'creator_gig', 'lost_found'
  ));

comment on column public.listings.kind is
  'Verticales: property/business/professional/event/job + service (Empleos, 0129 — lo que la gente OFRECE: attrs.work_days y attrs.schedule para la disponibilidad, price_amount = piso "desde" y NULL = a convenir; sin employment_type ni questions, porque no hay postulacion) + product (Marketplace: attrs.store_listing_id = negocio dueño) + creator_gig (Creator Marketplace: price_amount = presupuesto, attrs.category/deliverables/deadline) + lost_found (Comunidad — Perdido y encontrado, 0096: attrs.lf_type/lf_category/lf_happened_on/lf_resolved_at; price_amount SIEMPRE null, no se compra ni se vende nada acá).';

-- ---------------------------------------------------------------------------
-- 2. Los dos índices de las pestañas nuevas
--
-- La lista de /empleos hace SIEMPRE la misma consulta: tenant + kind + status
-- publicado, ordenado por (created_at desc, id desc) para el keyset. Con las
-- tres pestañas eso se abre en dos formas:
--
--   · "Todos" pide los DOS kinds a la vez → por eso el índice es parcial sobre
--     `kind in ('job','service')` y lleva `kind` como segunda columna: sirve
--     igual para la consulta de un kind solo (Servicios) que para la de los dos.
--   · "Empleos" y "Ocasional" filtran además por la jornada, que vive en jsonb.
--     Sin el segundo índice esa rama termina evaluando `attrs` fila por fila;
--     con él, el planner tiene el valor ya extraído.
--
-- El índice de jornada NO cubre 'service' a propósito: un servicio no declara
-- `employment_type`, así que indexarlo sería guardar una columna de NULLs.
-- ---------------------------------------------------------------------------
create index if not exists listings_empleos_idx
  on public.listings (tenant_id, kind, created_at desc, id desc)
  where kind in ('job', 'service') and status = 'published';

create index if not exists listings_job_employment_type_idx
  on public.listings (tenant_id, (attrs->>'employment_type'), created_at desc, id desc)
  where kind = 'job' and status = 'published';

-- ---------------------------------------------------------------------------
-- 3. public.global_search — un servicio también se busca
--
-- Se re-declara ENTERA porque plpgsql no admite parches parciales; el cuerpo es
-- el de la 0052 letra por letra, con dos cambios y ninguno más:
--
--   a) 'service' entra al `kind in (...)` y a los dos CASE (`result_type` y
--      `href`), apuntando al grupo "empleos" y a `/empleos/{id}`. Cae en el
--      MISMO grupo que un empleo y no en uno nuevo porque el buscador agrupa por
--      PANTALLA de destino, y las dos pantallas son la misma: /empleos y
--      /empleos/[id]. Un grupo "Servicios" propio habría obligado además a
--      tocar `groupSearchResults` en components/search, que es de otro dueño.
--
--   b) la ventana pasa de `partition by l.kind` a partir por el kind YA
--      AGRUPADO. Sin esto, "empleos" devolvería hasta `limit_per_type` empleos
--      MÁS `limit_per_type` servicios: el doble de filas de las que el contrato
--      promete por tipo, y un panel de tipeo-anticipado que se desborda.
--
-- Todo lo demás —contrato de salida, topes duros, tenant, bloqueos, el resto de
-- los hrefs, SECURITY INVOKER, `set search_path = ''`— queda literal.
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
               when 'service'      then 'empleos'
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
               when 'service'      then '/empleos/'
               when 'product'      then '/marketplace/'
             end || l.id::text                          as href,
             ts_rank(l.search, v_ts)                    as rank,
             row_number() over (
               partition by (case when l.kind = 'service' then 'job' else l.kind end)
               order by ts_rank(l.search, v_ts) desc,
                        l.published_at desc nulls last,
                        l.id desc
             )                                          as rn
        from public.listings l
       where l.tenant_id = v_tenant
         and l.status = 'published'
         and l.kind in ('property', 'business', 'professional', 'event', 'job',
                        'service', 'product')
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
  'Búsqueda global agrupada por tipo, una sola ida. INSENSIBLE A LOS ACENTOS desde 0052: consulta y documento se leen con ''spanish'' Y con ''spanish_unaccent'' y se unen con OR — las dos puntas, o empeora. Desde 0129 los avisos kind=''service'' (Servicios, dentro de Empleos) entran al MISMO grupo ''empleos'' y al mismo href /empleos/{id}, y la ventana particiona por el kind ya agrupado para que ese grupo siga respetando limit_per_type. SECURITY INVOKER: la RLS de cada tabla decide qué ve cada quien (un resultado que no podés ver no aparece, sin filtrar nada en la UI). Devuelve VACÍO —no error— si q tiene menos de 2 caracteres o si el JWT no trae tenant. q se recorta a 80 caracteres y limit_per_type se clampa a [1,20]. `rank` ordena DENTRO del grupo; entre tipos no es comparable (ts_rank vs similarity) y no hace falta que lo sea porque la pantalla agrupa. `image_url` sale crudo (ruta de Storage o URL absoluta): lo resuelve la app.';

-- Los grants se re-declaran porque `create or replace` sobre una función que ya
-- existía los CONSERVA, pero si alguien corre este archivo sobre una base donde
-- la función no estuviera, nacería pública. Mismo cierre que 0044 y 0052.
revoke execute on function public.global_search(text, int) from public;
grant execute on function public.global_search(text, int) to anon, authenticated, service_role;

commit;
