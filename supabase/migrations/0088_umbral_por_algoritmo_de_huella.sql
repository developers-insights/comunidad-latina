-- =============================================================================
-- 0088_umbral_por_algoritmo_de_huella.sql — Comunidad Latina
--
-- EL DEFECTO QUE CORRIGE (leer esto antes de "simplificar" nada de acá abajo)
-- -----------------------------------------------------------------------------
-- Desde la 0061, `public.find_similar_content()` y `app.scan_content_asset()`
-- reciben UN SOLO `p_max_distance` y se lo aplican por igual a las tres huellas
-- perceptuales de `content_assets`, que NO tienen el mismo ancho:
--
--   · phash        bit(64)   — imagen. Umbral calibrado: 10 → 84 % de bits iguales.
--   · video_phash  bit(256)  — video: 4 huellas de 64 bits concatenadas.
--   · audio_phash  bit(256)  — audio: Haitsma-Kalker, 16 tramos × 16 bandas.
--
-- Una distancia de Hamming NO es comparable entre anchos distintos. Con un único
-- número pasa siempre una de estas dos cosas, y las dos son un detector roto:
--
--   · Con 10 (el valor que la app manda hoy desde `src/lib/integrity/scan.ts`),
--     el audio NO MATCHEA NUNCA: el peor caso medido de "mismo audio" —el mismo
--     clip con ruido de amplitud 0,05— da 23 bits (`src/lib/integrity/audio.test.ts`),
--     o sea que el umbral está por debajo del piso de lo que el algoritmo produce
--     para material idéntico. El módulo de audio quedó apagado sin que nada falle.
--   · Con 32 (el umbral correcto del audio, `AUDIO_MAX_DISTANCE` en
--     `src/lib/integrity/audio.ts`), la IMAGEN matchea cualquier cosa: 32 sobre
--     64 bits es exactamente la mitad, que es la distancia esperada entre dos
--     huellas al azar. Sería acusar de duplicado a fotos que no tienen nada que ver.
--
-- No hay un número que sirva para los tres. Por eso a partir de acá el umbral es
-- POR ALGORITMO, sale de la configuración del tenant (`content_integrity_settings`,
-- 0086) y sólo se pisa por parámetro cuando quien llama sabe lo que hace.
--
-- LOS NÚMEROS Y DE DÓNDE SALEN (medidos, no elegidos a ojo)
-- -----------------------------------------------------------------------------
--   IMAGEN, 10/64  — sin cambio. Es el valor que el módulo tiene desde la 0061 y
--                    el que quedó en `max_distance_similar_bits` (0086).
--   VIDEO,  40/256 — 4 × 10. La huella son 4 bloques de 64 bits (VIDEO_FRAMES = 4
--                    en `src/lib/integrity/phash.ts`) y cada bloque es un pHash de
--                    imagen: si los cuatro fotogramas se degradan como se degrada
--                    una imagen recomprimida, la suma es 4 × el umbral de imagen.
--                    Es además la cota que el test ya afirma sobre material real:
--                    `phash.test.ts` exige `DEFAULT_MAX_DISTANCE * 4` para "dos
--                    videos con fotogramas parecidos". Mantiene el MISMO 84 % de
--                    bits iguales que la imagen, y queda lejísimos de los ~128 que
--                    dan dos huellas de 256 bits sin relación.
--   AUDIO,  32/256 — 87,5 % de bits iguales. `AUDIO_MAX_DISTANCE` de
--                    `src/lib/integrity/audio.ts`, calibrado en `audio.test.ts`:
--                    peor caso de MISMO audio = 23 bits; mejor caso de audios
--                    DISTINTOS = 117 bits. Entre 23 y 117 hay muchísimo aire y 32
--                    deja margen para material real (más sucio que una señal
--                    sintética) sin acercarse a la zona de falsos positivos.
--
-- POR QUÉ NO ALCANZABA CON "NORMALIZAR ×4 EN LA APP"
-- -----------------------------------------------------------------------------
-- El comentario de `max_distance_exacto_bits` (0086) dice que la app normaliza el
-- umbral a la escala de 256 antes de comparar. Un factor ×4 uniforme sirve para el
-- VIDEO (que literalmente son 4 pHashes concatenados) y NO sirve para el audio:
-- 10 × 4 = 40 sigue estando por encima de 23 pero es otro algoritmo, con otra
-- distribución, y su umbral se midió aparte y dio 32. Escalar un número no
-- reemplaza haber calibrado el otro. Además la normalización en la app se aplicaba
-- del lado del que llama, o sea que cualquier camino que se olvidara de hacerla
-- volvía a mandar 10 sobre 256.
--
-- COMPATIBILIDAD HACIA ATRÁS (la app se despliega DESPUÉS de esta migración)
-- -----------------------------------------------------------------------------
-- `src/lib/integrity/scan.ts` llama hoy `scan_content_asset(p_asset_id,
-- p_max_distance)`. Esa llamada tiene que seguir funcionando el rato que va entre
-- la migración y el deploy, y sigue funcionando: los parámetros nuevos van al
-- final y con DEFAULT NULL, y NULL significa "usá lo que dice la configuración del
-- tenant". `p_max_distance` conserva su significado histórico y explícito: es el
-- umbral de la huella de IMAGEN (phash, 64 bits), que es la única escala sobre la
-- que ese número estuvo calibrado alguna vez. O sea que la llamada vieja, sin
-- tocar una línea de TypeScript, pasa de "audio y video con un umbral absurdo" a
-- "audio y video con el umbral de la comunidad".
--
-- GRANTS: obligatorios, no decorativos (ver 0085). Cambiar la firma de una función
-- crea un objeto NUEVO: los grants de la firma vieja no se heredan, y sin EXECUTE
-- la app recibe un 404 de PostgREST en vez de un error entendible.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Un umbral por algoritmo en la configuración del tenant
-- ---------------------------------------------------------------------------
-- Se agregan a `content_integrity_settings` (0086) en vez de crear una tabla
-- nueva: son el mismo tipo de decisión, del mismo dueño (el staff del tenant), y
-- partirla en dos tablas obligaría a mantener dos filas coherentes a mano.
--
-- El ALTER va en tres pasos —agregar nullable, backfill explícito, recién ahí
-- NOT NULL— y no en un `add column ... not null default` de una línea. Postgres
-- 15 rellena solo el default al agregar la columna, así que el paso de más no
-- hace falta EN UNA BASE LIMPIA; hace falta si una corrida anterior dejó la
-- columna a medio crear, y en ese caso el `if not exists` la daría por buena con
-- filas en NULL. Es la diferencia entre idempotente y "parece idempotente".
alter table public.content_integrity_settings
  add column if not exists max_distance_video_bits int,
  add column if not exists max_distance_audio_bits int;

alter table public.content_integrity_settings
  alter column max_distance_video_bits set default 40,
  alter column max_distance_audio_bits set default 32;

-- Backfill: las filas que ya existen (la 0086 sembró una por tenant) quedan con
-- los defaults nuevos, nunca en NULL. Un NULL acá significaría "sin umbral" y el
-- coalesce de las funciones de abajo lo taparía en silencio — que es exactamente
-- el tipo de configuración fantasma que este módulo no puede tener.
update public.content_integrity_settings
   set max_distance_video_bits = coalesce(max_distance_video_bits, 40),
       max_distance_audio_bits = coalesce(max_distance_audio_bits, 32)
 where max_distance_video_bits is null
    or max_distance_audio_bits is null;

alter table public.content_integrity_settings
  alter column max_distance_video_bits set not null,
  alter column max_distance_audio_bits set not null;

-- El rango es 0..256 y NO 0..64 como el de la imagen. No es un descuido de
-- copiar y pegar: son huellas de 256 bits, y un CHECK de 0..64 dejaría fuera
-- justamente el rango donde vive el umbral correcto del audio (32) y el del
-- video (40 hoy, más si alguna comunidad decide tolerar más recompresión).
alter table public.content_integrity_settings
  drop constraint if exists content_integrity_settings_video_bits_rango;
alter table public.content_integrity_settings
  add constraint content_integrity_settings_video_bits_rango
  check (max_distance_video_bits between 0 and 256);

alter table public.content_integrity_settings
  drop constraint if exists content_integrity_settings_audio_bits_rango;
alter table public.content_integrity_settings
  add constraint content_integrity_settings_audio_bits_rango
  check (max_distance_audio_bits between 0 and 256);

comment on column public.content_integrity_settings.max_distance_video_bits is
  'Distancia de Hamming máxima para levantar una alerta de coincidencia sobre la huella de VIDEO. Rango 0..256 (no 0..64 como la imagen): video_phash es bit(256), la concatenación de 4 pHashes de 64 bits (VIDEO_FRAMES = 4). Default 40 = 4 × el umbral de imagen, o sea el mismo 84 % de bits iguales por bloque; es además la cota que ya afirma phash.test.ts para "dos videos con fotogramas parecidos" (DEFAULT_MAX_DISTANCE * 4). Comparar esta columna con max_distance_similar_bits NO tiene sentido: son escalas distintas.';

comment on column public.content_integrity_settings.max_distance_audio_bits is
  'Distancia de Hamming máxima para levantar una alerta de coincidencia sobre la huella de AUDIO. Rango 0..256 porque audio_phash es bit(256). Default 32 = AUDIO_MAX_DISTANCE de src/lib/integrity/audio.ts, medido en audio.test.ts: el mismo audio con ruido, cuantizado a 8 bits o recomprimido nunca pasó de 23 bits, y dos audios distintos nunca bajaron de 117. 32 vive en el medio de ese hueco. OJO: bajarlo a la escala de la imagen (10) apaga el detector de audio por completo — queda por debajo del piso que el algoritmo produce para material idéntico, y no falla nada, simplemente no matchea nunca.';

comment on column public.content_integrity_settings.max_distance_similar_bits is
  'Distancia máxima para levantar una alerta de `coincidencia_similar` sobre la huella de IMAGEN (phash, bit(64)). Default 10 = el valor que el módulo tiene desde la 0061. Desde la 0088 este número es SÓLO de la imagen: video y audio tienen los suyos (max_distance_video_bits, max_distance_audio_bits) porque sus huellas son de 256 bits y una distancia de Hamming no es comparable entre anchos distintos. Es el que se le pasa como p_max_distance a find_similar_content()/scan_content_asset().';

-- ---------------------------------------------------------------------------
-- 2. La lectura con defaults, al día con las columnas nuevas
-- ---------------------------------------------------------------------------
-- La 0086 armaba la fila de defaults con un `row(...)` POSICIONAL y dejaba
-- avisado que agregar una columna lo rompe. Efectivamente lo rompe: las dos
-- columnas nuevas quedan al final del rowtype y el row() de 9 elementos ya no
-- castea. Acá se reemplaza por asignación CAMPO POR CAMPO, que falla al migrar
-- (nombre inexistente) en vez de fallar en runtime por orden, y que sobrevive a
-- que alguien reordene o agregue columnas.
--
-- ⚠️ SIGUE HABIENDO UNA REGLA QUE CUMPLIR A MANO: toda columna nueva de
-- content_integrity_settings necesita su línea acá con su default. Si no la
-- tiene, esta función devuelve NULL en esa columna cuando el tenant no tiene fila
-- — que es más benigno que el row() (no revienta), pero igual de silencioso.
create or replace function app.content_integrity_settings(p_tenant uuid)
returns public.content_integrity_settings
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_cfg public.content_integrity_settings;
begin
  select * into v_cfg
    from public.content_integrity_settings
   where tenant_id = p_tenant;

  if found then
    return v_cfg;
  end if;

  v_cfg.tenant_id                             := p_tenant;
  v_cfg.max_distance_exacto_bits              := 0;
  v_cfg.max_distance_similar_bits             := 10;   -- imagen, 64 bits
  v_cfg.umbral_bloqueo_bits                   := 4;    -- imagen, 64 bits
  v_cfg.max_distance_video_bits               := 40;   -- video, 256 bits (4 × 10)
  v_cfg.max_distance_audio_bits               := 32;   -- audio, 256 bits (medido)
  v_cfg.revision_humana_obligatoria_comercial := true;
  v_cfg.bloquear_duplicado_de_otro_usuario    := true;
  v_cfg.updated_by                            := null;
  v_cfg.created_at                            := '-infinity'::timestamptz;
  v_cfg.updated_at                            := '-infinity'::timestamptz;

  return v_cfg;
end;
$$;

comment on function app.content_integrity_settings(uuid) is
  'Umbrales de integridad de un tenant, o los defaults si nunca se configuró. Existe para que "no hay fila" y "hay fila" no sean dos caminos distintos en quien la consume. SECURITY INVOKER: la RLS decide qué configuración se puede leer, así que pasar un tenant ajeno no filtra nada — devuelve los defaults. Desde la 0088 arma la fila de defaults campo por campo y no con un row() posicional: agregar una columna a la tabla ya no la rompe en silencio.';

revoke execute on function app.content_integrity_settings(uuid) from public, anon;
grant execute on function app.content_integrity_settings(uuid) to authenticated, service_role;

-- El envoltorio público no cambia de firma ni de cuerpo: devuelve el ROWTYPE de
-- la tabla, así que las columnas nuevas viajan solas. Se vuelve a declarar para
-- que su comentario no mienta y para que un `create or replace` posterior sobre
-- app.* no deje esta definición apuntando a una versión vieja del rowtype.
-- La app lee por NOMBRE de columna (`row.max_distance_similar_bits` en
-- src/lib/integrity/settings.ts), nunca por posición: sumar columnas no le rompe
-- nada a la versión desplegada, sólo le agrega campos que todavía ignora.
create or replace function public.get_content_integrity_settings()
returns public.content_integrity_settings
language sql
stable
security invoker
set search_path = ''
as $$
  select app.content_integrity_settings((select app.current_tenant_id()));
$$;

comment on function public.get_content_integrity_settings() is
  'Umbrales de integridad del tenant de la sesión actual. NUNCA devuelve NULL ni falla: sin fila (o sin tenant en el JWT) devuelve los defaults, para que la app no tenga que tener un camino "por si no está configurado". No recibe tenant_id por parámetro a propósito — lo deriva de app.current_tenant_id(), que sale del JWT y no del cliente. Desde la 0088 incluye max_distance_video_bits y max_distance_audio_bits: el umbral es por algoritmo porque las tres huellas no miden lo mismo.';

revoke execute on function public.get_content_integrity_settings() from public, anon;
grant execute on function public.get_content_integrity_settings() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. find_similar_content: un umbral por huella
-- ---------------------------------------------------------------------------
-- La firma cambia de arity, así que hay que DROPEAR la vieja. Si se dejaran las
-- dos, una llamada de 3 argumentos sería ambigua entre (uuid,int,int) y
-- (uuid,int,int,int,int) con defaults, Postgres devolvería
--   42725 — function ... is not unique
-- y PostgREST fallaría al resolver la RPC. Una sola función, cero ambigüedad.
drop function if exists public.find_similar_content(uuid, int, int);

create or replace function public.find_similar_content(
  p_asset_id           uuid,
  p_max_distance       int default null,
  p_limit              int default 20,
  p_max_distance_video int default null,
  p_max_distance_audio int default null
)
returns table (
  asset_id     uuid,
  uploader_id  uuid,
  subject_kind text,
  subject_id   uuid,
  distance     int,
  algorithm    text,
  uploaded_at  timestamptz
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_probe record;
  v_cfg   public.content_integrity_settings;
  v_limit int := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_img   int;
  v_vid   int;
  v_aud   int;
begin
  select a.tenant_id, a.media_kind, a.phash, a.video_phash, a.audio_phash
    into v_probe
    from public.content_assets a
   where a.id = p_asset_id;

  if not found then
    return;  -- sin asset (o sin permiso de verlo por RLS): sin resultados
  end if;

  -- Los umbrales salen de la configuración DEL TENANT DEL ASSET, que se deriva
  -- del propio asset y nunca de un parámetro: el que llama no elige contra qué
  -- comunidad se compara ni con qué sensibilidad. Un parámetro explícito sólo
  -- puede pisar el número, jamás el tenant.
  v_cfg := app.content_integrity_settings(v_probe.tenant_id);

  -- p_max_distance es el umbral de la IMAGEN. Es lo que ese parámetro significó
  -- siempre —la app le manda 10, que es el valor calibrado sobre 64 bits— y
  -- reinterpretarlo ahora como "umbral de todo" es justamente el defecto que esta
  -- migración corrige. NULL = usar la configuración del tenant.
  v_img := least(greatest(coalesce(p_max_distance,       v_cfg.max_distance_similar_bits, 10), 0),  64);
  v_vid := least(greatest(coalesce(p_max_distance_video, v_cfg.max_distance_video_bits,   40), 0), 256);
  v_aud := least(greatest(coalesce(p_max_distance_audio, v_cfg.max_distance_audio_bits,   32), 0), 256);

  -- Se ordena por distancia y se corta con LIMIT: ésa es la forma que el
  -- índice HNSW sabe servir. El filtro por umbral se aplica después, sobre el
  -- puñado de candidatos, porque un `where distancia <= N` no usa el índice.
  return query
  -- Cada rama va entre paréntesis: un brazo de UNION con su propio ORDER BY /
  -- LIMIT es un error de sintaxis sin ellos. Y el ORDER BY por rama es lo que
  -- hace que cada índice HNSW se use (uno por huella).
  with candidatos as (
    (select a.id, a.uploader_id, a.subject_kind, a.subject_id, a.first_uploaded_at,
            'phash'::text as algo,
            (a.phash OPERATOR(extensions.<~>) v_probe.phash)::int as dist
       from public.content_assets a
      where v_probe.phash is not null
        and a.phash is not null
        and a.id <> p_asset_id
        and a.tenant_id = v_probe.tenant_id
      order by a.phash OPERATOR(extensions.<~>) v_probe.phash
      limit v_limit)

    union all

    (select a.id, a.uploader_id, a.subject_kind, a.subject_id, a.first_uploaded_at,
            'video_phash'::text,
            (a.video_phash OPERATOR(extensions.<~>) v_probe.video_phash)::int
       from public.content_assets a
      where v_probe.video_phash is not null
        and a.video_phash is not null
        and a.id <> p_asset_id
        and a.tenant_id = v_probe.tenant_id
      order by a.video_phash OPERATOR(extensions.<~>) v_probe.video_phash
      limit v_limit)

    union all

    (select a.id, a.uploader_id, a.subject_kind, a.subject_id, a.first_uploaded_at,
            'audio_phash'::text,
            (a.audio_phash OPERATOR(extensions.<~>) v_probe.audio_phash)::int
       from public.content_assets a
      where v_probe.audio_phash is not null
        and a.audio_phash is not null
        and a.id <> p_asset_id
        and a.tenant_id = v_probe.tenant_id
      order by a.audio_phash OPERATOR(extensions.<~>) v_probe.audio_phash
      limit v_limit)
  )
  select c.id, c.uploader_id, c.subject_kind, c.subject_id, c.dist, c.algo, c.first_uploaded_at
    from candidatos c
   -- ACÁ ESTÁ EL ARREGLO: cada candidato se mide contra el umbral de SU huella.
   -- El ORDER BY sigue siendo por distancia cruda entre algoritmos, que no es
   -- estrictamente comparable (10/64 es "más lejos" que 20/256) pero es el mismo
   -- orden que la función tenía y lo que consume el escaneo es el conjunto, no
   -- el ranking. Ordenar por distancia RELATIVA cambiaría qué corta el LIMIT y
   -- es una decisión aparte, con su propia medición.
   where (c.algo = 'phash'       and c.dist <= v_img)
      or (c.algo = 'video_phash' and c.dist <= v_vid)
      or (c.algo = 'audio_phash' and c.dist <= v_aud)
   order by c.dist asc, c.first_uploaded_at asc
   limit v_limit;
end;
$$;

comment on function public.find_similar_content(uuid, int, int, int, int) is
  'Coincidencias perceptuales de un asset dentro de SU tenant, por distancia de Hamming (operador `<~>` de pgvector, índice HNSW). Devuelve las k más cercanas por debajo del umbral DE CADA ALGORITMO: phash es bit(64) y video_phash/audio_phash son bit(256), así que un único umbral o apagaba el audio (10 sobre 256 está por debajo del piso de "mismo audio", medido en 23) o hacía matchear cualquier imagen (32 sobre 64 es la mitad de los bits, o sea azar). p_max_distance es el umbral de IMAGEN, que es lo que ese parámetro significó siempre; los otros dos van al final y con default NULL para no romper a quien ya la llamaba. NULL en cualquiera = el valor configurado por el tenant (content_integrity_settings, 0086). HNSW es aproximado: un miss es "una alerta que no se levantó", nunca una acusación falsa — el camino determinístico es el de sha256. SECURITY INVOKER: la RLS de content_assets ya decide quién ve qué.';

revoke all    on function public.find_similar_content(uuid, int, int, int, int) from public, anon;
grant execute on function public.find_similar_content(uuid, int, int, int, int) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. scan_content_asset: mismo cuerpo, umbral por algoritmo
-- ---------------------------------------------------------------------------
-- Todo lo que la 0061 decidió sigue igual y a propósito: el duplicado exacto por
-- sha256, el filtro por tenant, "sólo contra assets ANTERIORES", los mismos
-- `kind` de alerta, el mismo registro en content_matches con su `algorithm` y su
-- `distance`, el mismo SECURITY DEFINER con search_path vacío y el mismo EXECUTE
-- restringido a service_role. Lo único que cambia es de dónde sale el umbral.
--
-- Se dropea la firma vieja por el mismo motivo que arriba: dos overloads donde
-- una es prefijo de la otra con defaults es una llamada ambigua esperando a
-- pasar. El envoltorio de la 0070 se dropea primero porque queda apuntando a una
-- función que deja de existir (es `language sql` con cuerpo en string, así que
-- Postgres no registra la dependencia y no lo avisa: se rompería recién al
-- llamarlo).
drop function if exists public.scan_content_asset(uuid, integer);
drop function if exists app.scan_content_asset(uuid, int);

create or replace function app.scan_content_asset(
  p_asset_id           uuid,
  p_max_distance       int default null,
  p_max_distance_video int default null,
  p_max_distance_audio int default null
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_asset  record;
  v_cfg    public.content_integrity_settings;
  v_img    int;
  v_vid    int;
  v_aud    int;
  v_nuevas int := 0;
begin
  select * into v_asset from public.content_assets where id = p_asset_id;
  if not found then
    return 0;
  end if;

  -- tenant SIEMPRE derivado del asset, nunca de un parámetro (invariante del
  -- módulo desde la 0061). Los umbrales, de la configuración de ESE tenant.
  v_cfg := app.content_integrity_settings(v_asset.tenant_id);

  v_img := least(greatest(coalesce(p_max_distance,       v_cfg.max_distance_similar_bits, 10), 0),  64);
  v_vid := least(greatest(coalesce(p_max_distance_video, v_cfg.max_distance_video_bits,   40), 0), 256);
  v_aud := least(greatest(coalesce(p_max_distance_audio, v_cfg.max_distance_audio_bits,   32), 0), 256);

  -- (a) Duplicado EXACTO por sha256. Determinístico. Sólo contra assets
  --     anteriores: el que llegó primero es el original y no se le levanta
  --     alerta a él por la llegada del segundo.
  insert into public.content_matches (tenant_id, asset_id, matched_asset_id, match_type, algorithm, distance)
  select v_asset.tenant_id, v_asset.id, a.id, 'exacto', 'sha256', 0
    from public.content_assets a
   where a.tenant_id = v_asset.tenant_id
     and a.sha256 = v_asset.sha256
     and a.id <> v_asset.id
     and a.first_uploaded_at <= v_asset.first_uploaded_at
  on conflict (asset_id, matched_asset_id, algorithm) do nothing;

  get diagnostics v_nuevas = row_count;

  -- (b) Coincidencias SIMILARES por huella perceptual, cada una contra el umbral
  --     de SU algoritmo. Los tres se pasan explícitos: si se dejaran en NULL,
  --     find_similar_content volvería a leer la configuración del tenant y una
  --     edición del panel en el medio del escaneo daría dos criterios distintos
  --     dentro de la misma transacción.
  insert into public.content_matches (tenant_id, asset_id, matched_asset_id, match_type, algorithm, distance)
  select v_asset.tenant_id, v_asset.id, s.asset_id, 'similar', s.algorithm, s.distance
    from public.find_similar_content(p_asset_id, v_img, 50, v_vid, v_aud) s
    join public.content_assets a2 on a2.id = s.asset_id
   where a2.first_uploaded_at <= v_asset.first_uploaded_at
     and s.distance > 0
  on conflict (asset_id, matched_asset_id, algorithm) do nothing;

  -- (c) Alerta por cada match nuevo que todavía no tenga una.
  --
  --     La severidad también era un número único (`distance <= 5`) aplicado a
  --     las tres escalas, o sea el mismo defecto en chiquito: 5 sobre 256 no lo
  --     alcanza ningún audio ni ningún video reales, así que ninguna coincidencia
  --     de esos dos medios podía ser 'alta' jamás. Ahora es la MITAD del umbral
  --     aplicable — con la configuración por defecto de imagen (10) da 5, o sea
  --     exactamente el comportamiento de la 0061 para el medio que hoy funciona.
  insert into public.content_integrity_alerts (tenant_id, asset_id, match_id, kind, severity, detail)
  select m.tenant_id, m.asset_id, m.id,
         case when m.match_type = 'exacto' then 'duplicado_exacto' else 'coincidencia_similar' end,
         case when m.match_type = 'exacto' then 'alta'
              when m.distance <= (case m.algorithm
                                    when 'video_phash' then v_vid
                                    when 'audio_phash' then v_aud
                                    else v_img
                                  end) / 2 then 'alta'
              else 'media' end,
         'Coincidencia ' || m.match_type || ' por ' || m.algorithm || ' (distancia ' || m.distance || ')'
    from public.content_matches m
   where m.asset_id = v_asset.id
     and not exists (
       select 1 from public.content_integrity_alerts al where al.match_id = m.id
     );

  -- (d) Alerta de licencia: subir sin declarar nada no es un delito, pero es
  --     exactamente el caso que después nadie puede defender.
  if v_asset.license_kind = 'desconocido' and not v_asset.originality_declared then
    insert into public.content_integrity_alerts (tenant_id, asset_id, kind, severity, detail)
    select v_asset.tenant_id, v_asset.id, 'licencia_faltante', 'baja',
           'Se cargó sin declarar originalidad ni licencia'
     where not exists (
       select 1 from public.content_integrity_alerts al
        where al.asset_id = v_asset.id and al.kind = 'licencia_faltante'
     );
  end if;

  update public.content_assets
     set review_status = case
           when exists (select 1 from public.content_integrity_alerts al
                         where al.asset_id = v_asset.id and al.status = 'abierta')
           then 'en_investigacion'
           else 'aprobado' end
   where id = v_asset.id
     and review_status = 'pendiente';

  return v_nuevas;
end;
$$;

comment on function app.scan_content_asset(uuid, int, int, int) is
  'Corre el análisis de integridad de un asset recién registrado: duplicado exacto por sha256, coincidencias similares por huella perceptual y las alertas correspondientes. La regla de "qué es un duplicado" vive acá, una sola vez, en vez de repetirse en cada camino de la app. Sólo matchea contra assets ANTERIORES: al que subió primero no se le abre alerta por la llegada del segundo. Desde la 0088 el umbral es POR ALGORITMO — p_max_distance sigue siendo el de IMAGEN (64 bits), y video y audio tienen el suyo (256 bits cada uno) porque una distancia de Hamming no se compara entre anchos distintos. Los tres aceptan NULL = el valor configurado por el tenant. EXECUTE únicamente para service_role.';

revoke execute on function app.scan_content_asset(uuid, int, int, int) from public, anon, authenticated;
grant execute on function app.scan_content_asset(uuid, int, int, int) to service_role;

-- Envoltorio en public: PostgREST sólo expone `public` (ver 0070). SECURITY
-- INVOKER a propósito — el cuerpo real ya corre como su dueño, declararlo definer
-- sería privilegio de más y un advisory nuevo sin ninguna ganancia.
--
-- Los parámetros nuevos van AL FINAL y con default: la llamada que hoy hace
-- src/lib/integrity/scan.ts —{ p_asset_id, p_max_distance }— sigue resolviendo a
-- esta función y sin ambigüedad, porque después del drop de arriba hay una sola
-- `public.scan_content_asset` en la base.
create or replace function public.scan_content_asset(
  p_asset_id           uuid,
  p_max_distance       integer default null,
  p_max_distance_video integer default null,
  p_max_distance_audio integer default null
)
returns integer
language sql
security invoker
set search_path = ''
as $$
  select app.scan_content_asset(p_asset_id, p_max_distance, p_max_distance_video, p_max_distance_audio);
$$;

comment on function public.scan_content_asset(uuid, integer, integer, integer) is
  'Envoltorio de app.scan_content_asset para que la aplicación pueda llamarla por PostgREST (que sólo expone public). EXECUTE sólo para service_role: el escaneo se dispara del lado del servidor, nunca desde el navegador. Desde la 0088 acepta un umbral por algoritmo; los tres son opcionales y NULL significa "usá la configuración del tenant". La llamada de dos argumentos que hace la app hoy sigue siendo válida y su p_max_distance se aplica a la huella de IMAGEN.';

revoke all    on function public.scan_content_asset(uuid, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.scan_content_asset(uuid, integer, integer, integer) to service_role;

-- ---------------------------------------------------------------------------
-- 5. El comentario de la 0061 que quedó viejo
-- ---------------------------------------------------------------------------
-- Decía que el umbral "NO está fijado en la base a propósito, lo elige quien
-- llama". Dejó de ser cierto en dos pasos: la 0086 lo puso en la configuración
-- del tenant y la 0088 lo partió por algoritmo. Un comentario que describe una
-- decisión que ya no rige es peor que no tener comentario: manda a leer mal el
-- código a quien confía en él.
comment on column public.content_matches.distance is
  'Distancia de Hamming entre las dos huellas. 0 en los matches por sha256. Cuanto más chica, más parecidas. El umbral vive en content_integrity_settings (por tenant desde la 0086) y es UNO POR ALGORITMO desde la 0088: phash es bit(64) y video_phash/audio_phash son bit(256), así que este número SÓLO se puede interpretar junto con la columna `algorithm` — 20 es lejísimos para una imagen y muy cerca para un audio. Quien llama puede pisar el umbral por parámetro, pero ya no elige el criterio por defecto.';

commit;
