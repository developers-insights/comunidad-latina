-- =============================================================================
-- 0009_moderation.sql — Comunidad Latina
-- moderation_queue (ruteo 3 niveles §8) + cola pgmq 'moderation'.
-- El pipeline (Edge Function con service_role) encola y puntúa; el humano
-- (moderator+ del tenant) resuelve. Los usuarios comunes NUNCA la ven.
-- =============================================================================

create table public.moderation_queue (
  id           uuid primary key default app.uuid_v7(),
  tenant_id    uuid not null references public.tenants(id),
  subject_kind text not null check (subject_kind in ('post', 'comment', 'listing', 'message', 'profile', 'photo')),
  subject_id   uuid not null,
  tier         int not null check (tier between 1 and 3),
  ai_score     numeric check (ai_score is null or (ai_score >= 0 and ai_score <= 100)),
  reasons      jsonb not null default '[]'::jsonb,
  status       text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'escalated')),
  assigned_to  uuid references public.profiles(id),
  resolved_by  uuid references public.profiles(id),
  resolved_at  timestamptz,
  created_at   timestamptz not null default now()
);

comment on table public.moderation_queue is
  'Cola de moderación 3 niveles (tier 1 auto / 2 monitoreo / 3 humano). Encola el pipeline server-side (service_role); resuelve moderator+ del tenant. Sin Vision configurado, las fotos entran DIRECTO acá como tier 3 (§5.6: nunca publicar imagen sin moderar). RETENCIÓN §5.4: resueltas (approved/rejected) se purgan a los 365 días vía pg_cron (0013, purge-resolved-moderation-queue), alineado con audit_log; pending/escalated no expiran.';
comment on column public.moderation_queue.ai_score is
  'Score 0-100 de la fusión ponderada (70% IA + 20% Trust + 10% reincidencia).';

create index moderation_queue_open_idx on public.moderation_queue (tenant_id, status, tier, created_at)
  where status in ('pending', 'escalated');
create index moderation_queue_subject_idx on public.moderation_queue (tenant_id, subject_kind, subject_id);

alter table public.moderation_queue enable row level security;
alter table public.moderation_queue force row level security;

-- Solo staff del tenant (y global_admin) ve su cola.
create policy moderation_queue_select on public.moderation_queue
for select to authenticated
using (
  (
    tenant_id = (select app.current_tenant_id())
    and (select app.is_staff())
  )
  or (select app.is_global_admin())
);

-- Encola el pipeline (service_role bypassa): nadie inserta por API con JWT.
create policy moderation_queue_insert on public.moderation_queue
for insert to authenticated
with check (false);

-- Resuelve moderator+ del tenant; si firma la resolución, firma como él mismo.
create policy moderation_queue_update on public.moderation_queue
for update to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and (select app.is_staff())
)
with check (
  tenant_id = (select app.current_tenant_id())
  and (select app.is_staff())
  and (resolved_by is null or resolved_by = (select auth.uid()))
);

-- La cola es evidencia operativa: no se borra por API (TTL/archivado = service).
create policy moderation_queue_delete on public.moderation_queue
for delete to authenticated
using (false);

-- ---------------------------------------------------------------------------
-- Cola asíncrona pgmq para el pipeline de moderación (fan-in de eventos)
-- ---------------------------------------------------------------------------
do $$
begin
  perform pgmq.create('moderation');
exception
  when duplicate_table then null; -- ya existe: idempotente
end;
$$;

-- El worker (Edge Function) opera la cola con service_role.
grant usage on schema pgmq to service_role;
grant select, insert, update, delete on all tables in schema pgmq to service_role;
grant execute on all functions in schema pgmq to service_role;
