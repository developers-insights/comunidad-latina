-- =============================================================================
-- 0061_content_integrity.sql — Comunidad Latina
--
-- Módulo Content Integrity completo (pliego): SHA-256 del original, huella
-- perceptual de imagen/video/audio, duplicado exacto, coincidencia similar,
-- fecha de primera carga, usuario, contenido, dominio de origen, archivo
-- original, historial de versiones, declaración de originalidad, declaración
-- de licencias, alertas para moderadores y acciones aprobar/bloquear/investigar.
--
-- -----------------------------------------------------------------------------
-- DECISIÓN DE DISEÑO 1 — cómo se busca "parecido" de forma indexable
-- -----------------------------------------------------------------------------
-- El requisito real es: dada la huella de un archivo nuevo, encontrar las
-- huellas cercanas en distancia de Hamming, rápido. Las opciones eran:
--
--   (a) `bigint` + popcount(a # b). Simple, pero sólo sirve para 64 bits y NO
--       es indexable: toda búsqueda es un seq scan completo. Muere apenas el
--       catálogo crece.
--   (b) BK-tree/tabla de bandas (LSH) armada a mano en SQL. Indexable, pero es
--       estructura de datos casera: hay que mantenerla con triggers, se
--       desincroniza, y nadie más en el repo la entiende.
--   (c) `vector(64)` de floats con distancia euclídea. La métrica es LA
--       INCORRECTA (un pHash no es un punto en R^64) y ocupa 8× más.
--   (d) `bit(N)` + pgvector: operador `extensions.<~>` = distancia de Hamming
--       EXACTA, con índice HNSW `bit_hamming_ops`.
--
-- Se eligió (d). pgvector 0.8.2 ya está instalado en este proyecto (verificado
-- con list_extensions), y desde 0.7 soporta el tipo `bit` nativo con opclass
-- de Hamming — o sea que no se agrega dependencia nueva ni se inventa nada:
-- la métrica es la correcta, el almacenamiento es el mínimo (64 bits = 8 bytes)
-- y el ORDER BY ... LIMIT k lo sirve el índice.
--
-- Advertencia honesta sobre HNSW: es ANN, o sea aproximado. El recall no es
-- 100%. Acá eso es aceptable y es la razón por la que el módulo está partido
-- en dos caminos:
--   * DUPLICADO EXACTO  → `sha256` con índice btree. Es determinístico y no
--     falla nunca. Es el camino que importa legalmente.
--   * COINCIDENCIA SIMILAR → huella perceptual con HNSW. Un miss significa
--     "una alerta que no se levantó", nunca "una acusación falsa". Y si algún
--     día hace falta recall total, se sube `hnsw.ef_search` o se corre el scan
--     exacto (el operador `<~>` funciona igual sin índice).
--
-- -----------------------------------------------------------------------------
-- DECISIÓN DE DISEÑO 2 — el matching NO cruza tenants
-- -----------------------------------------------------------------------------
-- Tentador buscar duplicados en toda la plataforma. No se hace: mostrarle a un
-- moderador de dominicanos.com que una foto coincide con contenido de
-- comunidadlatina.com ES una fuga cross-tenant, sin importar lo útil que suene.
-- Todas las búsquedas filtran por tenant y la RLS lo vuelve a exigir.
--
-- -----------------------------------------------------------------------------
-- DECISIÓN DE DISEÑO 3 — quién ve las coincidencias
-- -----------------------------------------------------------------------------
-- `content_matches` y `content_integrity_alerts` las lee SOLO staff del tenant.
-- Decirle al usuario A "tu foto coincide con la de B" le revela a A que existe
-- B y qué subió: convierte una herramienta de moderación en un buscador
-- inverso de contenido ajeno. El dueño ve su propio asset y su estado, no con
-- quién matcheó.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. content_assets — un registro por archivo cargado
-- ---------------------------------------------------------------------------
create table if not exists public.content_assets (
  id                     uuid primary key default app.uuid_v7(),
  tenant_id              uuid not null references public.tenants(id),
  uploader_id            uuid not null references public.profiles(id) on delete cascade,

  -- Qué contenido es (el "ID de contenido" del pliego). Sin FK física: el
  -- sujeto puede ser un post, un aviso o un ítem de portafolio — mismo patrón
  -- polimórfico que `reactions` (0007) y `saves` (0038).
  subject_kind           text not null
                           check (subject_kind in ('post','listing','portfolio','avatar','cover','guide','otro')),
  subject_id             uuid,

  media_kind             text not null
                           check (media_kind in ('imagen','video','audio','documento')),

  -- El archivo original
  storage_bucket         text not null,
  storage_path           text not null,
  original_filename      text,
  mime_type              text,
  byte_size              bigint check (byte_size is null or byte_size >= 0),

  -- Huellas
  sha256                 bytea not null check (octet_length(sha256) = 32),
  phash                  bit(64),
  video_phash            bit(256),
  audio_phash            bit(256),

  -- Procedencia
  source_host            text not null,
  source_domain_id       uuid references public.tenant_domains(id) on delete set null,
  first_uploaded_at      timestamptz not null default now(),

  -- Versionado
  version                int not null default 1 check (version >= 1),
  supersedes_id          uuid references public.content_assets(id) on delete set null,

  -- Declaraciones del que sube
  originality_declared   boolean not null default false,
  originality_statement  text,
  license_kind           text not null default 'desconocido'
                           check (license_kind in ('propio','licencia_comercial','creative_commons','dominio_publico','con_permiso','desconocido')),
  license_statement      text,
  license_url            text,

  -- Estado efectivo de moderación
  review_status          text not null default 'pendiente'
                           check (review_status in ('pendiente','aprobado','bloqueado','en_investigacion')),
  reviewed_by            uuid references public.profiles(id) on delete set null,
  reviewed_at            timestamptz,
  review_note            text,

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

comment on table public.content_assets is
  'Registro de integridad de cada archivo cargado: quién lo subió, cuándo por primera vez, desde qué dominio, con qué declaración de originalidad y licencia, y sus huellas (SHA-256 exacta + perceptuales). Es el libro de procedencia del contenido — por eso NO se borra al borrar el post: el asset sobrevive para que una reclamación posterior siga teniendo evidencia. Sólo cascadea si se borra la cuenta que lo subió.';
comment on column public.content_assets.sha256 is
  'SHA-256 del archivo ORIGINAL, en bytea (32 bytes, no hex: la mitad de espacio y comparación binaria directa). Es el camino determinístico de duplicado exacto — no aproxima, no falla. Índice (tenant_id, sha256).';
comment on column public.content_assets.phash is
  'Huella perceptual de imagen (pHash DCT, 64 bits). Sobrevive a recompresión, reescalado y recorte leve, que es exactamente lo que el SHA-256 no detecta. Se busca por distancia de Hamming con el operador `extensions.<~>` de pgvector, acelerado por índice HNSW.';
comment on column public.content_assets.video_phash is
  'Huella perceptual de video: concatenación de las huellas de keyframes muestreados, 256 bits. Misma métrica de Hamming que la imagen — se eligió largo fijo (y no un array de huellas por frame) para que sea indexable con el mismo mecanismo en vez de exigir una tabla hija y un join por comparación.';
comment on column public.content_assets.audio_phash is
  'Huella acústica reducida a 256 bits (Hamming), presente sólo cuando el medio tiene pista de audio. NULL no significa "sin analizar": eso lo dice review_status = pendiente.';
comment on column public.content_assets.source_host is
  'Dominio de origen COMO TEXTO, congelado al momento de la carga. Se guarda además de source_domain_id a propósito: si el dominio se archiva o se borra de tenant_domains, la evidencia de "esto se subió desde X" no puede evaporarse.';
comment on column public.content_assets.first_uploaded_at is
  'Fecha/hora de la PRIMERA carga de este contenido. En una cadena de versiones, cada versión nueva la hereda de la que reemplaza: es la fecha que sirve para decidir quién publicó primero, y por eso no se pisa con now() en cada reemplazo.';
comment on column public.content_assets.supersedes_id is
  'Versión anterior de este mismo archivo. La cadena completa (con las huellas de cada paso) vive en content_asset_versions; esta columna es el atajo para "cuál era la anterior".';
comment on column public.content_assets.originality_declared is
  'Declaración de originalidad del que sube. Es una AFIRMACIÓN DEL USUARIO, no un hecho verificado: nunca debe mostrarse en UI como si la plataforma la hubiera comprobado (mismo criterio legal que verification_checks §11).';
comment on column public.content_assets.license_kind is
  'Declaración de licencia del que sube. `desconocido` es el default a propósito: no declarar nada no puede leerse como "es propio".';
comment on column public.content_assets.review_status is
  'Estado EFECTIVO del asset. Las acciones del moderador (aprobar/bloquear/investigar) lo escriben acá; el rastro de la decisión queda en content_integrity_alerts. Espejo del patrón listings.tier ← listing_premiums (0054).';

create index if not exists content_assets_sha_idx
  on public.content_assets (tenant_id, sha256);
create index if not exists content_assets_uploader_idx
  on public.content_assets (uploader_id, first_uploaded_at desc);
create index if not exists content_assets_subject_idx
  on public.content_assets (tenant_id, subject_kind, subject_id);
create index if not exists content_assets_pendientes_idx
  on public.content_assets (tenant_id, created_at desc)
  where review_status <> 'aprobado';
create index if not exists content_assets_source_domain_idx
  on public.content_assets (source_domain_id);
create index if not exists content_assets_supersedes_idx
  on public.content_assets (supersedes_id);
create index if not exists content_assets_reviewed_by_idx
  on public.content_assets (reviewed_by);

-- Índices de similitud. `bit_hamming_ops` es de pgvector (extensions).
create index if not exists content_assets_phash_hnsw
  on public.content_assets using hnsw (phash extensions.bit_hamming_ops);
create index if not exists content_assets_video_phash_hnsw
  on public.content_assets using hnsw (video_phash extensions.bit_hamming_ops);
create index if not exists content_assets_audio_phash_hnsw
  on public.content_assets using hnsw (audio_phash extensions.bit_hamming_ops);

drop trigger if exists content_assets_set_updated_at on public.content_assets;
create trigger content_assets_set_updated_at
before update on public.content_assets
for each row execute function extensions.moddatetime(updated_at);

alter table public.content_assets enable row level security;
alter table public.content_assets force row level security;

-- El dueño ve lo suyo; el staff del tenant ve todo lo del tenant (es su cola
-- de trabajo). Nadie más, y nunca anon: esto es metadata forense, no producto.
create policy content_assets_select on public.content_assets
for select to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and (
    uploader_id = (select auth.uid())
    or (select app.is_staff())
  )
);

-- Las huellas se calculan server-side y se escriben con service_role: un
-- cliente que pudiera insertar su propio sha256/phash podría declararse autor
-- de cualquier cosa, que es justo lo que este módulo existe para impedir.
create policy content_assets_insert on public.content_assets
for insert to authenticated
with check (false);

create policy content_assets_update on public.content_assets
for update to authenticated
using (false)
with check (false);

create policy content_assets_delete on public.content_assets
for delete to authenticated
using (false);

-- ---------------------------------------------------------------------------
-- 2. content_asset_versions — historial de versiones
-- ---------------------------------------------------------------------------
create table if not exists public.content_asset_versions (
  id            uuid primary key default app.uuid_v7(),
  tenant_id     uuid not null references public.tenants(id),
  asset_id      uuid not null references public.content_assets(id) on delete cascade,
  version       int not null check (version >= 1),
  sha256        bytea not null check (octet_length(sha256) = 32),
  phash         bit(64),
  storage_path  text not null,
  byte_size     bigint,
  changed_by    uuid references public.profiles(id) on delete set null,
  change_reason text,
  created_at    timestamptz not null default now(),
  unique (asset_id, version)
);

comment on table public.content_asset_versions is
  'Historial de versiones de un asset: una fila por estado anterior, con SU huella. Es una tabla aparte y no un jsonb dentro de content_assets porque cada versión necesita su propio sha256 indexable — si alguien vuelve a subir la versión 1 de un archivo que ya fue reemplazado, tiene que matchear igual.';
comment on column public.content_asset_versions.change_reason is
  'Por qué se reemplazó (corrección, mejor calidad, pedido de moderación). Texto del usuario o del staff: es contexto, no un valor de máquina.';

create index if not exists content_asset_versions_asset_idx
  on public.content_asset_versions (asset_id, version desc);
create index if not exists content_asset_versions_sha_idx
  on public.content_asset_versions (tenant_id, sha256);
create index if not exists content_asset_versions_changed_by_idx
  on public.content_asset_versions (changed_by);

alter table public.content_asset_versions enable row level security;
alter table public.content_asset_versions force row level security;

create policy content_asset_versions_select on public.content_asset_versions
for select to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and (
    (select app.is_staff())
    or exists (
      select 1 from public.content_assets a
       where a.id = content_asset_versions.asset_id
         and a.uploader_id = (select auth.uid())
    )
  )
);

create policy content_asset_versions_insert on public.content_asset_versions
for insert to authenticated
with check (false);

create policy content_asset_versions_update on public.content_asset_versions
for update to authenticated
using (false)
with check (false);

create policy content_asset_versions_delete on public.content_asset_versions
for delete to authenticated
using (false);

-- ---------------------------------------------------------------------------
-- 3. content_matches — duplicados exactos y coincidencias similares
-- ---------------------------------------------------------------------------
create table if not exists public.content_matches (
  id               uuid primary key default app.uuid_v7(),
  tenant_id        uuid not null references public.tenants(id),
  asset_id         uuid not null references public.content_assets(id) on delete cascade,
  matched_asset_id uuid not null references public.content_assets(id) on delete cascade,
  match_type       text not null check (match_type in ('exacto','similar')),
  algorithm        text not null check (algorithm in ('sha256','phash','video_phash','audio_phash')),
  distance         int not null default 0 check (distance >= 0),
  detected_at      timestamptz not null default now(),
  constraint content_matches_no_self check (asset_id <> matched_asset_id),
  unique (asset_id, matched_asset_id, algorithm)
);

comment on table public.content_matches is
  'Coincidencias detectadas entre dos assets del MISMO tenant. `exacto` sale de sha256 (distance = 0, determinístico); `similar` sale de una huella perceptual con su distancia de Hamming. La lee sólo el staff: decirle a un usuario con qué contenido ajeno matcheó lo suyo convertiría la moderación en un buscador inverso de material de otros.';
comment on column public.content_matches.distance is
  'Distancia de Hamming entre las dos huellas. 0 en los matches por sha256. Cuanto más chica, más parecidas: el umbral operativo NO está fijado en la base a propósito, lo elige quien llama a find_similar_content() porque depende del medio (una foto tolera ~10/64, un video mucho menos).';
comment on column public.content_matches.algorithm is
  'Con qué huella se detectó. Se guarda porque el mismo par de assets puede matchear por audio y no por imagen (video reeditado), y esa diferencia es justamente lo que el moderador necesita ver.';

create index if not exists content_matches_asset_idx
  on public.content_matches (asset_id, detected_at desc);
create index if not exists content_matches_matched_idx
  on public.content_matches (matched_asset_id);
create index if not exists content_matches_tenant_idx
  on public.content_matches (tenant_id, detected_at desc);

alter table public.content_matches enable row level security;
alter table public.content_matches force row level security;

create policy content_matches_select on public.content_matches
for select to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and (select app.is_staff())
);

create policy content_matches_insert on public.content_matches
for insert to authenticated
with check (false);

create policy content_matches_update on public.content_matches
for update to authenticated
using (false)
with check (false);

create policy content_matches_delete on public.content_matches
for delete to authenticated
using (false);

-- ---------------------------------------------------------------------------
-- 4. content_integrity_alerts — la cola del moderador y sus acciones
-- ---------------------------------------------------------------------------
create table if not exists public.content_integrity_alerts (
  id              uuid primary key default app.uuid_v7(),
  tenant_id       uuid not null references public.tenants(id),
  asset_id        uuid not null references public.content_assets(id) on delete cascade,
  match_id        uuid references public.content_matches(id) on delete set null,
  kind            text not null
                    check (kind in ('duplicado_exacto','coincidencia_similar','licencia_faltante','originalidad_dudosa')),
  severity        text not null default 'media' check (severity in ('baja','media','alta')),
  detail          text,
  status          text not null default 'abierta'
                    check (status in ('abierta','aprobado','bloqueado','en_investigacion','descartada')),
  resolved_by     uuid references public.profiles(id) on delete set null,
  resolved_at     timestamptz,
  resolution_note text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.content_integrity_alerts is
  'Alertas de integridad para moderadores, con las tres acciones del pliego: aprobar, bloquear, investigar (status aprobado/bloqueado/en_investigacion) más `descartada` para el falso positivo. Es tabla aparte de moderation_queue (0009) porque la decisión acá es de AUTORÍA y licencia, no de si el contenido es aceptable — un archivo puede ser perfectamente publicable y aun así no ser tuyo.';
comment on column public.content_integrity_alerts.status is
  'Estado de la alerta. Al resolverla, el server espeja el resultado en content_assets.review_status: la alerta es el rastro de la decisión, el asset es el estado vigente.';
comment on column public.content_integrity_alerts.match_id is
  'La coincidencia que disparó la alerta. NULL en las alertas que no nacen de un match (licencia faltante, originalidad dudosa). `on delete set null` para que borrar el match no borre el rastro de que hubo una decisión.';

create index if not exists content_integrity_alerts_abiertas_idx
  on public.content_integrity_alerts (tenant_id, severity, created_at desc)
  where status = 'abierta';
create index if not exists content_integrity_alerts_asset_idx
  on public.content_integrity_alerts (asset_id, created_at desc);
create index if not exists content_integrity_alerts_match_idx
  on public.content_integrity_alerts (match_id);
create index if not exists content_integrity_alerts_resolved_by_idx
  on public.content_integrity_alerts (resolved_by);
create index if not exists content_integrity_alerts_tenant_idx
  on public.content_integrity_alerts (tenant_id, created_at desc);

drop trigger if exists content_integrity_alerts_set_updated_at on public.content_integrity_alerts;
create trigger content_integrity_alerts_set_updated_at
before update on public.content_integrity_alerts
for each row execute function extensions.moddatetime(updated_at);

alter table public.content_integrity_alerts enable row level security;
alter table public.content_integrity_alerts force row level security;

create policy content_integrity_alerts_select on public.content_integrity_alerts
for select to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and (select app.is_staff())
);

-- Las levanta el pipeline (service_role), no una persona.
create policy content_integrity_alerts_insert on public.content_integrity_alerts
for insert to authenticated
with check (false);

-- Resolver SÍ es acción humana: el staff del tenant la ejerce por API.
create policy content_integrity_alerts_update on public.content_integrity_alerts
for update to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and (select app.is_staff())
)
with check (
  tenant_id = (select app.current_tenant_id())
  and (select app.is_staff())
);

-- Una alerta no se borra: se descarta (status = 'descartada'). Borrarla sería
-- borrar el rastro de que alguien decidió.
create policy content_integrity_alerts_delete on public.content_integrity_alerts
for delete to authenticated
using (false);

-- ---------------------------------------------------------------------------
-- 5. Búsqueda de coincidencias similares
-- ---------------------------------------------------------------------------
-- SECURITY INVOKER a propósito: la RLS de content_assets ya dice quién ve qué
-- (dueño o staff del tenant), así que la función no necesita elevar privilegios
-- y no suma un advisory de definer expuesto. Un moderador ve el catálogo de su
-- tenant; un usuario común sólo se ve a sí mismo, que es inútil pero inofensivo.
create or replace function public.find_similar_content(
  p_asset_id     uuid,
  p_max_distance int default 10,
  p_limit        int default 20
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
  v_probe   record;
  v_limit   int := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_maxdist int := greatest(coalesce(p_max_distance, 10), 0);
begin
  select a.tenant_id, a.media_kind, a.phash, a.video_phash, a.audio_phash
    into v_probe
    from public.content_assets a
   where a.id = p_asset_id;

  if not found then
    return;  -- sin asset (o sin permiso de verlo por RLS): sin resultados
  end if;

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
   where c.dist <= v_maxdist
   order by c.dist asc, c.first_uploaded_at asc
   limit v_limit;
end;
$$;

comment on function public.find_similar_content(uuid, int, int) is
  'Coincidencias perceptuales de un asset dentro de SU tenant, por distancia de Hamming (operador `<~>` de pgvector, índice HNSW). Devuelve las k más cercanas por debajo del umbral. HNSW es aproximado: un miss es "una alerta que no se levantó", nunca una acusación falsa — el camino que sí es determinístico es el de sha256. SECURITY INVOKER: la RLS de content_assets ya decide quién ve qué.';

revoke execute on function public.find_similar_content(uuid, int, int) from public;
grant execute on function public.find_similar_content(uuid, int, int) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. El escaneo que llena matches y alertas (pipeline, service_role)
-- ---------------------------------------------------------------------------
-- Vive en la base y no en la app para que la regla "qué cuenta como duplicado"
-- exista UNA sola vez. SECURITY DEFINER porque tiene que ver TODO el catálogo
-- del tenant, incluido lo que el que subió no puede ver — pero el EXECUTE está
-- concedido sólo a service_role, así que no queda expuesta por PostgREST y no
-- genera advisory de definer alcanzable.
create or replace function app.scan_content_asset(
  p_asset_id       uuid,
  p_max_distance   int default 10
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_asset   record;
  v_nuevas  int := 0;
begin
  select * into v_asset from public.content_assets where id = p_asset_id;
  if not found then
    return 0;
  end if;

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

  -- (b) Coincidencias SIMILARES por huella perceptual.
  insert into public.content_matches (tenant_id, asset_id, matched_asset_id, match_type, algorithm, distance)
  select v_asset.tenant_id, v_asset.id, s.asset_id, 'similar', s.algorithm, s.distance
    from public.find_similar_content(p_asset_id, p_max_distance, 50) s
    join public.content_assets a2 on a2.id = s.asset_id
   where a2.first_uploaded_at <= v_asset.first_uploaded_at
     and s.distance > 0
  on conflict (asset_id, matched_asset_id, algorithm) do nothing;

  -- (c) Alerta por cada match nuevo que todavía no tenga una.
  insert into public.content_integrity_alerts (tenant_id, asset_id, match_id, kind, severity, detail)
  select m.tenant_id, m.asset_id, m.id,
         case when m.match_type = 'exacto' then 'duplicado_exacto' else 'coincidencia_similar' end,
         case when m.match_type = 'exacto' then 'alta'
              when m.distance <= 5        then 'alta'
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

comment on function app.scan_content_asset(uuid, int) is
  'Corre el análisis de integridad de un asset recién registrado: duplicado exacto por sha256, coincidencias similares por huella perceptual, y las alertas correspondientes. La regla de "qué es un duplicado" vive acá, una sola vez, en vez de repetirse en cada camino de la app. Sólo matchea contra assets ANTERIORES: al que subió primero no se le abre alerta por la llegada del segundo. EXECUTE únicamente para service_role.';

revoke execute on function app.scan_content_asset(uuid, int) from public, anon, authenticated;
grant execute on function app.scan_content_asset(uuid, int) to service_role;

commit;
