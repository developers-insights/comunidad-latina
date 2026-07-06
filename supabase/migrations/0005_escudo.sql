-- =============================================================================
-- 0005_escudo.sql — Comunidad Latina
-- Escudo Anti-Estafa (moat §3, desde R1):
--   * verification_checks — verificación DETERMINÍSTICA contra fuente oficial
--     fechada. Copy legal §11: descriptor literal + fecha, NUNCA aval.
--   * scam_reports — señales de la comunidad ponderadas por Trust Score.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- verification_checks
-- ---------------------------------------------------------------------------
create table public.verification_checks (
  id                 uuid primary key default app.uuid_v7(),
  tenant_id          uuid not null references public.tenants(id),
  subject_kind       text not null check (subject_kind in ('listing', 'profile', 'license')),
  subject_id         uuid,
  license_number     text,
  registry           text not null,
  registry_url       text,
  result             text not null check (result in ('found_active', 'not_found', 'expired', 'mismatch')),
  checked_at         timestamptz not null default now(),
  evidence           jsonb not null default '{}'::jsonb,
  disclaimer_version text not null default '2026-07-v1',
  created_at         timestamptz not null default now()
);

comment on table public.verification_checks is
  'Verificación determinística contra registros OFICIALES, fechada. COPY LEGAL OBLIGATORIO (§11): la UI muestra el descriptor literal — "licencia activa según [registro oficial] al [fecha]" — MÁS el disclaimer "esto NO garantiza conducta; nunca envíes dinero por adelantado". PROHIBIDO un badge mudo "Verificado" o lenguaje de aval ("de confianza", "seguro"): crea deber de cuidado y expone a negligent misrepresentation (Roommates.com). Lectura pública = transparencia del moat.';
comment on column public.verification_checks.result is
  'found_active | not_found | expired | mismatch — resultado literal del registro consultado, sin interpretación.';
comment on column public.verification_checks.evidence is
  'Snapshot citable de la consulta (query usada, nombre matcheado, estado textual del registro). Nunca documentos de identidad.';
comment on column public.verification_checks.disclaimer_version is
  'Versión del disclaimer legal vigente cuando se hizo el check (auditabilidad ante litigio).';

create index verification_checks_subject_idx on public.verification_checks (tenant_id, subject_kind, subject_id);
create index verification_checks_checked_idx on public.verification_checks (tenant_id, checked_at desc);

alter table public.verification_checks enable row level security;
alter table public.verification_checks force row level security;

-- Transparencia: cualquiera puede leer los checks (parte del producto de confianza).
create policy verification_checks_select on public.verification_checks
for select to anon, authenticated
using (true);

-- Solo el verificador server-side (service_role) escribe: un check emitido por
-- un usuario sería un aval falsificable.
create policy verification_checks_insert on public.verification_checks
for insert to authenticated
with check (false);

create policy verification_checks_update on public.verification_checks
for update to authenticated
using (false)
with check (false);

create policy verification_checks_delete on public.verification_checks
for delete to authenticated
using (false);

-- ---------------------------------------------------------------------------
-- scam_reports
-- ---------------------------------------------------------------------------
create table public.scam_reports (
  id          uuid primary key default app.uuid_v7(),
  tenant_id   uuid not null references public.tenants(id),
  reporter_id uuid not null references public.profiles(id),
  target_kind text not null check (target_kind in ('listing', 'profile', 'message')),
  target_id   uuid not null,
  reason      text not null,
  details     text,
  weight      numeric not null default 1 check (weight between 0 and 3),
  status      text not null default 'open' check (status in ('open', 'reviewing', 'upheld', 'dismissed')),
  created_at  timestamptz not null default now()
);

comment on table public.scam_reports is
  'Reportes de estafa de la comunidad. weight se deriva del Trust Score del reportante por trigger server-side (no forjable por el cliente). Alimenta señales del Escudo y la cola de moderación. RETENCIÓN §5.4: resueltos (upheld/dismissed) se purgan a los 365 días de creados vía pg_cron (0013, purge-resolved-scam-reports), alineado con moderation_queue/audit_log — el grafo reporter→target con texto libre no es indefinido; open/reviewing se conservan.';
comment on column public.scam_reports.weight is
  'Peso 1-3 calculado por app.scam_report_set_weight() según trust del reportante. El valor enviado por el cliente se ignora.';

create index scam_reports_tenant_status_idx on public.scam_reports (tenant_id, status, created_at desc);
create index scam_reports_target_idx on public.scam_reports (tenant_id, target_kind, target_id);
create index scam_reports_reporter_idx on public.scam_reports (tenant_id, reporter_id);

-- Peso derivado del Trust Score del reportante — SIEMPRE recalculado en DB.
create or replace function app.scam_report_set_weight()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_score int;
begin
  select ts.score into v_score
  from public.trust_scores ts
  where ts.profile_id = new.reporter_id;

  new.weight := case
    when coalesce(v_score, 0) >= 80 then 3
    when coalesce(v_score, 0) >= 50 then 2
    else 1
  end;

  return new;
end;
$$;

comment on function app.scam_report_set_weight() is
  'BEFORE INSERT en scam_reports: pisa weight con el derivado del Trust Score del reportante (>=80→3, >=50→2, resto→1).';

create trigger scam_reports_set_weight
before insert on public.scam_reports
for each row execute function app.scam_report_set_weight();

alter table public.scam_reports enable row level security;
alter table public.scam_reports force row level security;

-- Lo ve el propio reportante y el staff del tenant (y global_admin).
create policy scam_reports_select on public.scam_reports
for select to authenticated
using (
  (
    tenant_id = (select app.current_tenant_id())
    and (
      reporter_id = (select auth.uid())
      or (select app.is_staff())
    )
  )
  or (select app.is_global_admin())
);

-- Reportar: cualquier autenticado, en SU tenant, como él mismo, siempre "open".
create policy scam_reports_insert on public.scam_reports
for insert to authenticated
with check (
  tenant_id = (select app.current_tenant_id())
  and reporter_id = (select auth.uid())
  and status = 'open'
);

-- Resolver: moderator+ del tenant. WITH CHECK repite tenant (no mover filas).
create policy scam_reports_update on public.scam_reports
for update to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and (select app.is_staff())
)
with check (
  tenant_id = (select app.current_tenant_id())
  and (select app.is_staff())
);

create policy scam_reports_delete on public.scam_reports
for delete to authenticated
using ((select app.is_global_admin()));
