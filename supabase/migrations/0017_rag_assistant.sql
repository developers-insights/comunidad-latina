-- =============================================================================
-- 0017_rag_assistant.sql — Comunidad Latina
-- R3 (moat de IA) — capa de datos: rag_chunks + match_chunks (RAG del
-- Asistente) y assistant_queries (telemetría MÍNIMA del asistente).
-- NOTA integración R3: la tabla boosts vive en 0016_boosts.sql (módulo
-- Stripe, ya aplicada) — el bloque boosts que este archivo traía se retiró
-- para no duplicar tabla ni jobs de cron.
--
-- MINIMIZACIÓN §5.4 aplicada a la IA:
--   * rag_chunks indexa SOLO contenido que YA es público (guides/listings
--     published + FAQ curada por service). Nada privado entra al índice.
--   * El acceso de lectura NO es por SELECT directo (policies en false):
--     es SIEMPRE por la RPC match_chunks (security definer), que re-chequea
--     en el momento de la consulta que la fuente siga publicada y devuelve
--     como máximo un puñado de chunks por similitud. Sin dump masivo de
--     embeddings ni de contenido despublicado.
--   * assistant_queries guarda un HMAC keyed (secreto FUERA de la base) de la
--     pregunta, jamás el texto: la pregunta de un recién llegado puede revelar
--     estatus migratorio. TTL 30 días vía pg_cron (estilo 0013).
--   * match_chunks es EXECUTE solo-service_role: nadie hace búsquedas
--     vectoriales por PostgREST salteando la moderación y el rate limit del
--     route handler del asistente (fiscal R3).
--
-- Dependencias: 0001 (extensión vector en schema extensions, app.uuid_v7,
-- helpers de tenancy, pg_cron), 0004 (listings), 0007 (guides), 0003 (profiles).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- rag_chunks — índice vectorial del contenido público (guías, avisos, FAQ)
-- tenant_id NULLABLE: null = contenido global (ej. guías multi-comunidad),
-- visible para todos los tenants en match_chunks (mismo criterio que guides).
-- ---------------------------------------------------------------------------
create table public.rag_chunks (
  id           uuid primary key default app.uuid_v7(),
  tenant_id    uuid references public.tenants(id),
  source_kind  text not null check (source_kind in ('guide', 'listing', 'faq')),
  source_id    uuid not null,
  chunk_index  int not null default 0 check (chunk_index >= 0),
  content      text not null,
  embedding    extensions.vector(1536) not null,
  metadata     jsonb not null default '{}'::jsonb,
  content_hash text not null,
  created_at   timestamptz not null default now()
);

comment on table public.rag_chunks is
  'Índice RAG del Asistente (R3): chunks + embeddings (text-embedding-3-small, 1536 dims) de contenido YA público — guides/listings published y FAQ curada. Lo escribe SOLO el pipeline scripts/embed-content.mjs (service_role); se lee SOLO vía match_chunks (policies de SELECT en false: sin dump de embeddings/contenido por PostgREST). tenant_id null = contenido global.';
comment on column public.rag_chunks.source_id is
  'id de la fuente (guides.id / listings.id / id sintético de FAQ). Sin FK a propósito: la fuente puede borrarse y el pipeline limpia los huérfanos en la siguiente corrida; match_chunks igual re-chequea published en vivo.';
comment on column public.rag_chunks.content_hash is
  'sha256 del content: idempotencia del pipeline (no re-embeddear lo que no cambió = no re-pagar OpenAI).';
comment on column public.rag_chunks.metadata is
  'Contexto citable para el asistente (title/slug/section/kind/zona…). SOLO datos ya públicos del contenido — jamás PII ni datos de contacto (anti-honeypot §5.4).';

-- Upsert idempotente del pipeline: un chunk se identifica por fuente + posición.
create unique index rag_chunks_source_chunk_uniq
  on public.rag_chunks (source_kind, source_id, chunk_index);
create index rag_chunks_tenant_source_idx
  on public.rag_chunks (tenant_id, source_kind, source_id);
-- HNSW coseno: la métrica que usa match_chunks (<=>). A esta escala el filtro
-- por tenant/published se aplica post-scan y alcanza de sobra; si el índice
-- crece a millones de chunks, mover el check de published a una columna
-- refrescada por el pipeline.
create index rag_chunks_embedding_hnsw_idx
  on public.rag_chunks using hnsw (embedding extensions.vector_cosine_ops);

alter table public.rag_chunks enable row level security;
alter table public.rag_chunks force row level security;

-- Lectura SOLO vía match_chunks (security definer): el SELECT directo queda en
-- false incluso para authenticated — un embedding es reconstruible y el índice
-- entero no debe poder volcarse por PostgREST.
create policy rag_chunks_select on public.rag_chunks
for select to anon, authenticated
using (false);

-- Escrituras: solo el pipeline con service_role (bypassa RLS).
create policy rag_chunks_insert on public.rag_chunks
for insert to authenticated
with check (false);

create policy rag_chunks_update on public.rag_chunks
for update to authenticated
using (false)
with check (false);

create policy rag_chunks_delete on public.rag_chunks
for delete to authenticated
using (false);

-- ---------------------------------------------------------------------------
-- match_chunks — la ÚNICA puerta de lectura del índice RAG
-- security definer (owner postgres, BYPASSRLS en Supabase — mismo mecanismo
-- documentado en 0013): las policies en false de rag_chunks no la frenan.
-- search_path suma `extensions` (desvío consciente del estilo 0014) para que
-- el operador <=> de pgvector resuelva sin calificar cada uso.
-- ---------------------------------------------------------------------------
create or replace function public.match_chunks(
  p_query_embedding extensions.vector(1536),
  p_tenant_id       uuid,
  p_match_count     int default 6,
  p_min_similarity  float default 0.75
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
  -- Inputs clampeados aunque la RPC sea solo-service_role (defensa en
  -- profundidad) — nadie pide 10.000 chunks ni similitud negativa.
  v_count int   := least(greatest(coalesce(p_match_count, 6), 1), 20);
  v_min   float := least(greatest(coalesce(p_min_similarity, 0.75), 0), 1);
begin
  if p_query_embedding is null then
    return;
  end if;

  return query
  select c.content,
         c.metadata,
         c.source_kind,
         c.source_id,
         (1 - (c.embedding <=> p_query_embedding))::float as similarity
    from public.rag_chunks c
   where (c.tenant_id = p_tenant_id or c.tenant_id is null)
     -- Doble gate anti-fuga: aunque el pipeline solo embeddea published, acá
     -- se re-chequea EN VIVO — un aviso despublicado ayer no se cita hoy,
     -- aunque su chunk siga en el índice hasta la próxima corrida.
     and (
       (c.source_kind = 'guide' and exists (
         select 1 from public.guides g
          where g.id = c.source_id and g.status = 'published'
       ))
       or (c.source_kind = 'listing' and exists (
         select 1 from public.listings l
          where l.id = c.source_id and l.status = 'published'
       ))
       -- FAQ no tiene tabla fuente: la cura el service_role y solo existe
       -- en el índice mientras el pipeline la mantenga.
       or c.source_kind = 'faq'
     )
     and (1 - (c.embedding <=> p_query_embedding)) >= v_min
   order by c.embedding <=> p_query_embedding
   limit v_count;
end;
$$;

comment on function public.match_chunks(extensions.vector, uuid, int, float) is
  'Búsqueda semántica del Asistente RAG: chunks del tenant + globales (tenant_id null), SOLO de fuentes aún publicadas, orden por similitud coseno, máx 20. p_min_similarity alto por diseño (default 0.75): sin fuentes fuertes el asistente dice "no sé" en vez de inventar (guardrails §3). EXECUTE SOLO service_role (fiscal R3): se invoca únicamente server-side desde /api/assistant (admin client en src/lib/rag), que aplica moderación + rate limit por IP/sesión ANTES de buscar — con EXECUTE a anon, cualquiera podía hacer búsquedas vectoriales cross-tenant ilimitadas por PostgREST (p_tenant_id arbitrario, compute HNSW gratis, chunks faq sin re-chequeo). p_tenant_id null → devuelve solo contenido global.';

-- ⚠️ Los DEFAULT PRIVILEGES de Supabase otorgan EXECUTE a anon/authenticated
-- al CREAR la función — el revoke explícito por rol es OBLIGATORIO (revocar
-- solo de `public` no toca esos grants por-rol).
revoke execute on function public.match_chunks(extensions.vector, uuid, int, float) from public;
revoke execute on function public.match_chunks(extensions.vector, uuid, int, float) from anon, authenticated;
grant execute on function public.match_chunks(extensions.vector, uuid, int, float) to service_role;

-- ---------------------------------------------------------------------------
-- assistant_queries — telemetría mínima del Asistente (feedback + calidad RAG)
-- ---------------------------------------------------------------------------
create table public.assistant_queries (
  id            uuid primary key default app.uuid_v7(),
  tenant_id     uuid not null references public.tenants(id),
  profile_id    uuid references public.profiles(id) on delete set null,
  question_hash text not null,
  sources_used  jsonb not null default '[]'::jsonb,
  helpful       boolean,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null default now() + interval '30 days'
);

comment on table public.assistant_queries is
  'Telemetría MÍNIMA del Asistente RAG: qué fuentes se citaron y si la respuesta ayudó — para medir calidad del moat, no para perfilar gente. Solo service_role lee/escribe (policies en false); TTL 30 días vía pg_cron. profile_id null = consulta anónima (permitida: el asistente es público-suave).';
comment on column public.assistant_queries.question_hash is
  'HMAC-SHA256 de la pregunta normalizada, con secreto FUERA de la base (ASSISTANT_QUERY_SECRET, fallback CRON_SECRET — ver src/lib/rag hashQuestion). NUNCA el texto en claro (anti-honeypot §5.4): la pregunta de un recién llegado puede revelar estatus migratorio, salud o vivienda. Determinístico → detecta preguntas repetidas/frecuentes sin poder leerlas. Garantía honesta (fiscal R3): un sha256 SIN clave se revierte por diccionario offline (espacio de preguntas chico + normalización pública), así que un dump solo-DB habría revelado exactamente las preguntas sensibles; con la clave fuera de la base, el dump solo no alcanza, y quien además tenga el secreto del server puede confirmar una pregunta CONOCIDA, no leer arbitrarias.';
comment on column public.assistant_queries.sources_used is
  'Fuentes citadas en la respuesta: [{"source_kind","source_id","similarity"}]. Ids de contenido público — sin texto de la pregunta ni de la respuesta.';
comment on column public.assistant_queries.helpful is
  'Feedback del usuario ("¿Te sirvió?"): true/false, null = sin respuesta.';

create index assistant_queries_expires_idx on public.assistant_queries (expires_at);
create index assistant_queries_tenant_created_idx on public.assistant_queries (tenant_id, created_at desc);

alter table public.assistant_queries enable row level security;
alter table public.assistant_queries force row level security;

-- Todo en false: escribe/lee SOLO el server privilegiado (lib/rag logQuery con
-- admin client + panel admin server-side). Ni siquiera el propio usuario lee
-- su historial: no existe "historial de preguntas" como feature, por diseño.
create policy assistant_queries_select on public.assistant_queries
for select to authenticated
using (false);

create policy assistant_queries_insert on public.assistant_queries
for insert to authenticated
with check (false);

create policy assistant_queries_update on public.assistant_queries
for update to authenticated
using (false)
with check (false);

create policy assistant_queries_delete on public.assistant_queries
for delete to authenticated
using (false);

-- ---------------------------------------------------------------------------
-- pg_cron (estilo 0013: unschedule tolerante + schedule). Slot 04:50 para no
-- chocar con los jobs 03:10–04:20 existentes ni con los de 0016_boosts
-- (expire-finished-boosts 04:30, purge-abandoned-boosts 04:40).
-- ---------------------------------------------------------------------------

-- assistant_queries: TTL 30 días (04:50 UTC diario)
do $$
begin
  perform cron.unschedule('purge-expired-assistant-queries');
exception
  when others then null; -- no existía: primera corrida
end;
$$;

select cron.schedule(
  'purge-expired-assistant-queries',
  '50 4 * * *',
  $$delete from public.assistant_queries where expires_at < now()$$
);
