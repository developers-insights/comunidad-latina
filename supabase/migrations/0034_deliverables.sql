-- =============================================================================
-- 0034_deliverables.sql — Comunidad Latina
-- Entregables + estados NO-MONETARIOS del contrato (§32).
--   * job_deliverables — cada envío del creador, versionado.
--   * job_revisions    — cada "Cambios solicitados" del cliente.
--   * gig_contracts.status — se EXTIENDE el CHECK (forward-only, patrón 0026)
--     con los estados no-monetarios: changes_requested, final_delivery,
--     approved, closed (+ timestamps). Los estados MONETARIOS (Pago
--     procesándose/Pagado/Reembolsado) quedan Connect-ready (Hito 1).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- gig_contracts.status: + estados no-monetarios (forward-only, todas las filas
-- actuales ya caen dentro del conjunto nuevo).
-- ---------------------------------------------------------------------------
alter table public.gig_contracts
  drop constraint if exists gig_contracts_status_check;

alter table public.gig_contracts
  add constraint gig_contracts_status_check
  check (status in (
    'proposed', 'accepted', 'funded', 'delivered',
    'changes_requested', 'final_delivery', 'approved',
    'released', 'closed', 'canceled', 'disputed', 'rejected'
  ));

alter table public.gig_contracts
  add column if not exists changes_requested_at timestamptz,
  add column if not exists final_delivery_at    timestamptz,
  add column if not exists approved_at           timestamptz,
  add column if not exists closed_at             timestamptz;

comment on column public.gig_contracts.changes_requested_at is
  'El cliente pidió cambios (Cambios solicitados, §32). Estado no-monetario.';
comment on column public.gig_contracts.final_delivery_at is
  'El creador subió la entrega final (§32).';
comment on column public.gig_contracts.approved_at is
  'El cliente aprobó la entrega (§32). Con Connect esto habilita el release del dinero.';
comment on column public.gig_contracts.closed_at is
  'Contrato cerrado (§32), estado terminal no-monetario.';

-- ---------------------------------------------------------------------------
-- job_deliverables — envíos del creador, versionados. Privado a las partes + staff.
-- ---------------------------------------------------------------------------
create table public.job_deliverables (
  id           uuid primary key default app.uuid_v7(),
  tenant_id    uuid not null references public.tenants(id),
  contract_id  uuid not null references public.gig_contracts(id) on delete cascade,
  submitted_by uuid not null references public.profiles(id) on delete cascade,
  kind         text not null default 'file' check (kind in ('file', 'link', 'note', 'final')),
  files        text[] not null default '{}'::text[],
  note         text,
  version      int not null default 1 check (version > 0),
  is_final     boolean not null default false,
  created_at   timestamptz not null default now()
);

comment on table public.job_deliverables is
  'Cada envío del creador para un contrato (§32), versionado. Inmutable (nueva versión = nueva fila). Privado a las partes del contrato + staff. Lo sube el creador (parte correspondiente) vía server.';

create index job_deliverables_contract_idx on public.job_deliverables (tenant_id, contract_id, version);

alter table public.job_deliverables enable row level security;
alter table public.job_deliverables force row level security;

create policy job_deliverables_select on public.job_deliverables
for select to authenticated
using (
  (
    tenant_id = (select app.current_tenant_id())
    and (
      (select app.is_staff())
      or exists (
        select 1 from public.gig_contracts c
        where c.id = job_deliverables.contract_id
          and c.tenant_id = job_deliverables.tenant_id
          and (c.client_id = (select auth.uid()) or c.creator_id = (select auth.uid()))
      )
    )
  )
  or (select app.is_global_admin())
);

-- Inserta el CREADOR del contrato (entrega), en primera persona.
create policy job_deliverables_insert on public.job_deliverables
for insert to authenticated
with check (
  tenant_id = (select app.current_tenant_id())
  and submitted_by = (select auth.uid())
  and exists (
    select 1 from public.gig_contracts c
    where c.id = job_deliverables.contract_id
      and c.tenant_id = job_deliverables.tenant_id
      and c.creator_id = (select auth.uid())
  )
);

create policy job_deliverables_update on public.job_deliverables
for update to authenticated
using (false)
with check (false);

create policy job_deliverables_delete on public.job_deliverables
for delete to authenticated
using (false);

create trigger job_deliverables_enforce_account_active
before insert on public.job_deliverables
for each row execute function app.enforce_account_active();

-- ---------------------------------------------------------------------------
-- job_revisions — "Cambios solicitados" del cliente. Privado a las partes + staff.
-- ---------------------------------------------------------------------------
create table public.job_revisions (
  id           uuid primary key default app.uuid_v7(),
  tenant_id    uuid not null references public.tenants(id),
  contract_id  uuid not null references public.gig_contracts(id) on delete cascade,
  requested_by uuid not null references public.profiles(id) on delete cascade,
  note         text not null,
  created_at   timestamptz not null default now()
);

comment on table public.job_revisions is
  'Cada solicitud de cambios del cliente sobre un contrato (§32). Privado a las partes + staff. Lo inserta el cliente del contrato.';

create index job_revisions_contract_idx on public.job_revisions (tenant_id, contract_id, created_at desc);

alter table public.job_revisions enable row level security;
alter table public.job_revisions force row level security;

create policy job_revisions_select on public.job_revisions
for select to authenticated
using (
  (
    tenant_id = (select app.current_tenant_id())
    and (
      (select app.is_staff())
      or exists (
        select 1 from public.gig_contracts c
        where c.id = job_revisions.contract_id
          and c.tenant_id = job_revisions.tenant_id
          and (c.client_id = (select auth.uid()) or c.creator_id = (select auth.uid()))
      )
    )
  )
  or (select app.is_global_admin())
);

-- Inserta el CLIENTE del contrato (pide cambios), en primera persona.
create policy job_revisions_insert on public.job_revisions
for insert to authenticated
with check (
  tenant_id = (select app.current_tenant_id())
  and requested_by = (select auth.uid())
  and exists (
    select 1 from public.gig_contracts c
    where c.id = job_revisions.contract_id
      and c.tenant_id = job_revisions.tenant_id
      and c.client_id = (select auth.uid())
  )
);

create policy job_revisions_update on public.job_revisions
for update to authenticated
using (false)
with check (false);

create policy job_revisions_delete on public.job_revisions
for delete to authenticated
using (false);

create trigger job_revisions_enforce_account_active
before insert on public.job_revisions
for each row execute function app.enforce_account_active();
