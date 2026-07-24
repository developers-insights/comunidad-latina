-- =============================================================================
-- 0029_score_infra.sql — Comunidad Latina
-- Infraestructura de los TRES scores independientes (spec §45) + historial +
-- penalizaciones + funciones de NIVEL PURAS (sin dependencias de tablas).
--
--   1. User Score   = EXTENDER trust_scores in-place (ya es el User Score) +
--                     RE-MAPEO de niveles (nuevo/activo/confiable/verificado/
--                     destacado) recomputando el nivel DESDE el score.
--   2. Creator Score = creator_scores (nueva), niveles 0-5 por función.
--   3. Business Score= business_scores (nueva), niveles 1-5 por función.
--   + score_history  (genérica, privada) y score_penalties (auditable, privada).
--
-- El MOTOR autoritativo (recalc_* + triggers + cron) se define en 0037, cuando
-- ya existen todas las tablas de insumo. Acá van SOLO tablas + funciones de
-- nivel puras. Las funciones de nivel son CANON (fijas, no por-tenant) — igual
-- doctrina que los Trust levels — por eso son lógica SQL, no tabla de config.
--
-- INVARIANTE DE PRIVACIDAD (§35): factors/signals contienen SOLO lo positivo y
-- no delicado. Los negativos (penalizaciones, disputas, rechazos) viven en
-- tablas privadas (score_penalties, verificaciones). Prohibido para el motor
-- escribir negativos en factors/signals — así el score público sigue
-- select using(true) sin filtrar nada.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Funciones de NIVEL puras (sin tablas). Definidas primero: el recompute del
-- User Score de abajo usa app.user_level.
-- ---------------------------------------------------------------------------

-- User Score → nivel (spec §7). Umbrales CANON, espejo de src/lib/trust/levels.ts.
create or replace function app.user_level(p_score int)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_score >= 85 then 'destacado'
    when p_score >= 70 then 'verificado'
    when p_score >= 50 then 'confiable'
    when p_score >= 30 then 'activo'
    else 'nuevo'
  end;
$$;

comment on function app.user_level(int) is
  'User Score → nivel (spec §7): nuevo 0-29 / activo 30-49 / confiable 50-69 / verificado 70-84 / destacado 85-100. CANON, espejo exacto de TRUST_LEVELS en src/lib/trust/levels.ts. El nivel se RECOMPUTA desde el score, nunca se re-mapea el string.';

-- Creator Score → nivel 0-5 (spec §17). Nivel 0 "Aspirante" = activó pero sin
-- cobros habilitados (Stripe Connect). Nivel ≥1 EXIGE charges_enabled.
create or replace function app.creator_level(p_score int, p_charges_enabled boolean)
returns int
language sql
immutable
set search_path = ''
as $$
  select case
    when not coalesce(p_charges_enabled, false) then 0  -- Aspirante: sin cobros (Connect)
    when p_score >= 90 then 5
    when p_score >= 75 then 4
    when p_score >= 60 then 3
    when p_score >= 40 then 2
    else 1
  end;
$$;

comment on function app.creator_level(int, boolean) is
  'Creator Score → nivel 0-5 (spec §17). 0 = Aspirante (activó, sin charges_enabled de Connect → no cobra). ≥1 exige charges_enabled. Connect está DIFERIDO (decisión de Manuel) → charges_enabled es false en demo → todos topean en 0; las bandas 1-5 quedan LATENTES. NOTA: los umbrales exactos de las bandas 1-5 no están en el design doc; se usan de stand-in los mismos cortes que business_level (40/60/75/90) — CONFIRMAR contra spec §17 antes de habilitar Connect.';

-- Business Score → nivel 1-5 (spec §107).
create or replace function app.business_level(p_score int)
returns int
language sql
immutable
set search_path = ''
as $$
  select case
    when p_score >= 90 then 5  -- Destacado 90-100
    when p_score >= 75 then 4  -- Confiable  75-89
    when p_score >= 60 then 3  -- Verificado 60-74
    when p_score >= 40 then 2  -- Activo     40-59
    else 1                     -- Nuevo       0-39
  end;
$$;

comment on function app.business_level(int) is
  'Business Score → nivel 1-5 (spec §107): Nuevo 0-39 / Activo 40-59 / Verificado 60-74 / Confiable 75-89 / Destacado 90-100. CANON.';

-- ---------------------------------------------------------------------------
-- User Score = EXTENDER trust_scores (§2.1). Agrega desglose por factor,
-- score_previous, score_version, y RE-MAPEA los niveles.
-- ---------------------------------------------------------------------------
alter table public.trust_scores
  add column if not exists score_previous int,
  add column if not exists score_version  int not null default 1,
  add column if not exists factors        jsonb not null default '{}'::jsonb;

comment on column public.trust_scores.factors is
  'Desglose POSITIVO por factor (los 6 de spec §5): identity_security, tenure_activity, profile_completion, positive_participation, behavior_history, transactional_trust. Cada uno su subtotal. SOLO positivos/no-delicados (§35) — los negativos viven en score_penalties. Distinto de signals (contadores crudos que consume la UI).';
comment on column public.trust_scores.score_previous is
  'Score anterior al último recálculo (§36), para mostrar el delta. null en la primera pasada.';

-- Re-mapeo de niveles: bajamos el CHECK viejo, RECOMPUTAMOS el nivel de cada
-- fila desde su score con los umbrales nuevos (así ninguna fila viola el CHECK
-- nuevo — spec REUSA verificado/confiable en umbrales distintos, hay que
-- recomputar, no re-mapear el string), y subimos el CHECK nuevo.
alter table public.trust_scores
  drop constraint if exists trust_scores_level_check;

update public.trust_scores
   set level = app.user_level(score);

alter table public.trust_scores
  add constraint trust_scores_level_check
  check (level in ('nuevo', 'activo', 'confiable', 'verificado', 'destacado'));

-- El default de 0003 ('nuevo') sigue siendo válido en la taxonomía nueva.

-- ---------------------------------------------------------------------------
-- score_history — genérica para los 3 scores (§36). PRIVADA (incluye motivos
-- de penalización → §35 negativos privados).
-- ---------------------------------------------------------------------------
create table public.score_history (
  id           uuid primary key default app.uuid_v7(),
  tenant_id    uuid not null references public.tenants(id),
  subject_type text not null check (subject_type in ('user', 'creator', 'business')),
  subject_id   uuid not null,  -- polimórfico (user/creator→profiles.id; business→business_accounts.id): sin FK física (patrón reactions/follows)
  score_before int,
  score_after  int not null,
  level_before text,
  level_after  text,
  delta        int,
  reason       text,
  source       text not null default 'recalc'
                 check (source in ('recalc', 'penalty', 'admin', 'event')),
  actor_id     uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);

comment on table public.score_history is
  'Historial por cambio de score (§36: fecha, razón, puntos antes/después, auto/manual, admin) para los 3 scores. Habilita apelaciones (§7). PRIVADA (§35): dueño de su propio sujeto user/creator + staff; los admins de un negocio lo ven vía RPC (Fase 2). subject_id es polimórfico y SIN FK física.';

create index score_history_subject_idx on public.score_history (tenant_id, subject_type, subject_id, created_at desc);

alter table public.score_history enable row level security;
alter table public.score_history force row level security;

-- Lectura: dueño de su sujeto user/creator + staff del tenant (+ global). Los
-- admins de un negocio lo ven vía RPC security definer (Fase 2), que valida
-- membership — NO se embebe acá para no anticipar app.business_role (0031).
create policy score_history_select on public.score_history
for select to authenticated
using (
  (
    tenant_id = (select app.current_tenant_id())
    and (
      (subject_type in ('user', 'creator') and subject_id = (select auth.uid()))
      or (select app.is_staff())
    )
  )
  or (select app.is_global_admin())
);

create policy score_history_insert on public.score_history
for insert to authenticated
with check (false);

create policy score_history_update on public.score_history
for update to authenticated
using (false)
with check (false);

create policy score_history_delete on public.score_history
for delete to authenticated
using (false);

-- ---------------------------------------------------------------------------
-- score_penalties — penalizaciones auditables (§7). El factor "historial de
-- comportamiento" = base − Σ penalizaciones activas. Filas discretas
-- (auditable, apelable), no un número opaco. PRIVADA.
-- ---------------------------------------------------------------------------
create table public.score_penalties (
  id           uuid primary key default app.uuid_v7(),
  tenant_id    uuid not null references public.tenants(id),
  subject_type text not null check (subject_type in ('user', 'creator', 'business')),
  subject_id   uuid not null,  -- polimórfico, sin FK física
  points       int not null check (points > 0),  -- MAGNITUD a restar (el motor la sustrae)
  reason       text not null,
  category     text not null check (category in (
                 'spam', 'harassment', 'fake_review', 'impersonation', 'fraud',
                 'follower_manipulation', 'abusive_dispute', 'other')),
  applied_by   uuid references public.profiles(id) on delete set null,
  source       text not null default 'manual' check (source in ('auto', 'manual')),
  is_reverted  boolean not null default false,
  reverted_by  uuid references public.profiles(id) on delete set null,
  reverted_at  timestamptz,
  created_at   timestamptz not null default now()
);

comment on table public.score_penalties is
  'Penalizaciones al score, auditables y apelables (§7): filas discretas (motivo, categoría, actor, auto/manual) en vez de un número opaco. points = magnitud POSITIVA que el motor RESTA. Revertir (apelación aprobada) = is_reverted=true → el motor recomputa y restaura. PRIVADA: el dueño ve las propias (para apelar) + staff; escribe service/RPC.';

create index score_penalties_subject_idx on public.score_penalties (tenant_id, subject_type, subject_id, is_reverted);

alter table public.score_penalties enable row level security;
alter table public.score_penalties force row level security;

create policy score_penalties_select on public.score_penalties
for select to authenticated
using (
  (
    tenant_id = (select app.current_tenant_id())
    and (
      (subject_type in ('user', 'creator') and subject_id = (select auth.uid()))
      or (select app.is_staff())
    )
  )
  or (select app.is_global_admin())
);

create policy score_penalties_insert on public.score_penalties
for insert to authenticated
with check (false);

create policy score_penalties_update on public.score_penalties
for update to authenticated
using (false)
with check (false);

create policy score_penalties_delete on public.score_penalties
for delete to authenticated
using (false);

-- ---------------------------------------------------------------------------
-- creator_scores — Creator Score (§16/§17). Público-lectura, service-escritura.
-- Eje independiente de trust_scores (§45): NO se reusa.
-- ---------------------------------------------------------------------------
create table public.creator_scores (
  profile_id     uuid primary key references public.creator_profiles(profile_id) on delete cascade,
  tenant_id      uuid not null references public.tenants(id),
  score          int not null default 0 check (score between 0 and 100),
  score_previous int,
  level          int not null default 0 check (level between 0 and 5),
  factors        jsonb not null default '{}'::jsonb,
  is_provisional boolean not null default true,
  score_version  int not null default 1,
  computed_at    timestamptz not null default now()
);

comment on table public.creator_scores is
  'Creator Score 0-100 + nivel 0-5 (spec §16/§17), computado server-side (motor 0037). Eje independiente del User Score (§45). is_provisional=true mientras completed_jobs<3 → la UI muestra 50 y "creador nuevo". factors: 7 componentes de §16 (experience NO se serializa en la parte pública). Público-lectura (§35), service-escritura.';
comment on column public.creator_scores.is_provisional is
  'true mientras completed_jobs<3: la UI muestra 50 provisional (§17). El score real se persiste igual; el flag decide qué muestra la UI.';

create index creator_scores_tenant_score_idx on public.creator_scores (tenant_id, score desc);

alter table public.creator_scores enable row level security;
alter table public.creator_scores force row level security;

create policy creator_scores_select on public.creator_scores
for select to anon, authenticated
using (true);

create policy creator_scores_insert on public.creator_scores
for insert to authenticated
with check (false);

create policy creator_scores_update on public.creator_scores
for update to authenticated
using (false)
with check (false);

create policy creator_scores_delete on public.creator_scores
for delete to authenticated
using (false);

-- ---------------------------------------------------------------------------
-- business_scores — Business Score (§106/§107). Público-lectura, service-escritura.
-- ---------------------------------------------------------------------------
create table public.business_scores (
  business_id    uuid primary key references public.business_accounts(id) on delete cascade,
  tenant_id      uuid not null references public.tenants(id),
  score          int not null default 0 check (score between 0 and 100),
  score_previous int,
  level          int not null default 1 check (level between 1 and 5),
  factors        jsonb not null default '{}'::jsonb,
  score_version  int not null default 1,
  computed_at    timestamptz not null default now()
);

comment on table public.business_scores is
  'Business Score 0-100 + nivel 1-5 (spec §106/§107), computado server-side (motor 0037). factors: 7 componentes de §106. Público-lectura, service-escritura.';

create index business_scores_tenant_score_idx on public.business_scores (tenant_id, score desc);

alter table public.business_scores enable row level security;
alter table public.business_scores force row level security;

create policy business_scores_select on public.business_scores
for select to anon, authenticated
using (true);

create policy business_scores_insert on public.business_scores
for insert to authenticated
with check (false);

create policy business_scores_update on public.business_scores
for update to authenticated
using (false)
with check (false);

create policy business_scores_delete on public.business_scores
for delete to authenticated
using (false);
