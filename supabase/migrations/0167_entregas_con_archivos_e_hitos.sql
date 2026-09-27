begin;

-- =============================================================================
-- 0167 — Entregas con archivos, hitos de avance y revisiones con cupo.
--
-- job_deliverables y job_revisions existían desde 0034 sin pantalla. Pasan a
-- escribirse SÓLO desde el server (la entrega cambia el estado del contrato y
-- abre la ventana de revisión; una fila insertada directo por PostgREST
-- quedaría como entrega sin transición). Los archivos van a un bucket privado
-- sin policies de escritura: se suben con URL firmada que emite el server
-- después de verificar que quien sube es el creador del contrato.
-- =============================================================================

drop policy if exists job_deliverables_insert on public.job_deliverables;
create policy job_deliverables_insert on public.job_deliverables
for insert to authenticated
with check (false);

drop policy if exists job_revisions_insert on public.job_revisions;
create policy job_revisions_insert on public.job_revisions
for insert to authenticated
with check (false);

revoke all on table public.job_deliverables from anon, authenticated;
grant select on table public.job_deliverables to authenticated;
grant all on table public.job_deliverables to service_role;

revoke all on table public.job_revisions from anon, authenticated;
grant select on table public.job_revisions to authenticated;
grant all on table public.job_revisions to service_role;

alter table public.job_deliverables
  drop constraint if exists job_deliverables_files_tope,
  add constraint job_deliverables_files_tope check (cardinality(files) <= 20),
  drop constraint if exists job_deliverables_note_tope,
  add constraint job_deliverables_note_tope check (note is null or char_length(note) <= 2000);

alter table public.job_revisions
  drop constraint if exists job_revisions_note_tope,
  add constraint job_revisions_note_tope check (char_length(note) between 10 and 2000);

create unique index if not exists job_deliverables_version_uniq
  on public.job_deliverables (contract_id, version);

-- -----------------------------------------------------------------------------
-- Hitos de avance del creador.
-- -----------------------------------------------------------------------------
create table if not exists public.gig_contract_milestones (
  id          uuid primary key default app.uuid_v7(),
  tenant_id   uuid not null references public.tenants(id),
  contract_id uuid not null references public.gig_contracts(id) on delete restrict,
  title       text not null check (char_length(title) between 2 and 80),
  position    int not null check (position between 0 and 9),
  done_at     timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint gig_contract_milestones_posicion_uniq unique (contract_id, position)
);

comment on table public.gig_contract_milestones is
  'Hitos que el creador marca mientras trabaja (máximo 10 por contrato). Privados a las partes + staff. Los escribe el server con service_role.';

create index if not exists gig_contract_milestones_contract_idx
  on public.gig_contract_milestones (tenant_id, contract_id, position);

drop trigger if exists gig_contract_milestones_set_updated_at on public.gig_contract_milestones;
create trigger gig_contract_milestones_set_updated_at
before update on public.gig_contract_milestones
for each row execute function extensions.moddatetime(updated_at);

alter table public.gig_contract_milestones enable row level security;
alter table public.gig_contract_milestones force row level security;

drop policy if exists gig_contract_milestones_select on public.gig_contract_milestones;
create policy gig_contract_milestones_select on public.gig_contract_milestones
for select to authenticated
using (
  (
    tenant_id = (select app.current_tenant_id())
    and (
      (select app.is_staff())
      or exists (
        select 1 from public.gig_contracts c
        where c.id = gig_contract_milestones.contract_id
          and c.tenant_id = gig_contract_milestones.tenant_id
          and (c.client_id = (select auth.uid()) or c.creator_id = (select auth.uid()))
      )
    )
  )
  or (select app.is_global_admin())
);

revoke all on table public.gig_contract_milestones from anon, authenticated;
grant select on table public.gig_contract_milestones to authenticated;
grant all on table public.gig_contract_milestones to service_role;

-- -----------------------------------------------------------------------------
-- Bucket privado de entregas: {tenant_id}/{contract_id}/v{version}/{archivo}.
-- Lectura directa sólo para las partes (y staff para resolver disputas); la app
-- igual sirve los archivos con URLs firmadas de 10 minutos.
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'gig-deliveries', 'gig-deliveries', false, 209715200,
  array[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic',
    'video/mp4', 'video/quicktime', 'video/webm',
    'audio/mpeg', 'audio/mp4', 'audio/wav',
    'application/pdf', 'application/zip', 'application/x-zip-compressed'
  ]
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists gig_deliveries_select on storage.objects;
create policy gig_deliveries_select on storage.objects
for select to authenticated
using (
  bucket_id = 'gig-deliveries'
  and (storage.foldername(name))[1] = ((select app.current_tenant_id()))::text
  and (
    (select app.is_staff())
    or exists (
      select 1 from public.gig_contracts c
      where c.id::text = (storage.foldername(name))[2]
        and c.tenant_id = (select app.current_tenant_id())
        and (c.client_id = (select auth.uid()) or c.creator_id = (select auth.uid()))
    )
  )
);

commit;
