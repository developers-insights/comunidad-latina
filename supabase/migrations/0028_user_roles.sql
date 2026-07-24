-- =============================================================================
-- 0028_user_roles.sql — Comunidad Latina
-- Perfiles con MÚLTIPLES ROLES DE PRODUCTO (spec §1): una cuenta puede ser
-- usuaria / creadora / administradora de negocio a la vez, con un selector de
-- dashboard. Este es un TERCER eje ortogonal — NO toca:
--   * profiles.role (jerarquía de staff, informativa)
--   * app_metadata.role del JWT (claim de seguridad; el gating de staff sigue
--     100% por app.current_user_role()).
-- Estado autoritativo = tabla escrita solo por service_role / RPC / trigger
-- (patrón trust_scores/account_sanctions): nadie se auto-asigna una capacidad.
--   * 'user'     — lo tiene TODA cuenta (trigger AFTER INSERT + backfill).
--   * 'creator'  — lo prende la RPC de activación (0032) al entrar al ciclo.
--   * 'business' — bandera de presencia "administra ≥1 negocio" (trigger sobre
--                  business_members, 0031).
-- =============================================================================

create table public.user_roles (
  id           uuid primary key default app.uuid_v7(),
  tenant_id    uuid not null references public.tenants(id),
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  role         text not null check (role in ('user', 'creator', 'business')),
  status       text not null default 'active'
                 check (status in ('active', 'pending', 'revoked')),
  source       text not null default 'system'
                 check (source in ('system', 'self', 'rpc', 'trigger')),
  activated_at timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint user_roles_one_per_role unique (profile_id, role)
);

comment on table public.user_roles is
  'Capacidades de PRODUCTO de una cuenta (user|creator|business) para el selector de dashboard (spec §1). Tercer eje ORTOGONAL a profiles.role (staff) y a app_metadata.role (seguridad): no los lee ni los escribe. Estado autoritativo = solo service_role/RPC/trigger; el cliente nunca se auto-asigna una capacidad. El detalle del rol creador vive en creator_profiles.status; los negocios concretos de la capacidad "business" se listan desde business_members.';
comment on column public.user_roles.status is
  'active = visible en el switcher. pending/revoked = capacidad solicitada o retirada. Para "creator" refleja groseramente el ciclo de creator_profiles.status; el detalle canónico vive allá.';
comment on column public.user_roles.source is
  'Quién sembró la fila: system (trigger de alta), rpc (activación de creador), trigger (presencia de negocio), self (reservado).';

create index user_roles_profile_idx on public.user_roles (tenant_id, profile_id, status);
create index user_roles_role_idx on public.user_roles (tenant_id, role, status);

create trigger user_roles_set_updated_at
before update on public.user_roles
for each row execute function extensions.moddatetime(updated_at);

alter table public.user_roles enable row level security;
alter table public.user_roles force row level security;

-- Lectura: el dueño de sus capacidades + staff del tenant (+ global). NO es
-- pública (la lista de capacidades de una cuenta no necesita ser anónima; el
-- rol creador ya es visible vía creator_profiles).
create policy user_roles_select on public.user_roles
for select to authenticated
using (
  (
    tenant_id = (select app.current_tenant_id())
    and (
      profile_id = (select auth.uid())
      or (select app.is_staff())
    )
  )
  or (select app.is_global_admin())
);

-- Escritura EXCLUSIVA de service_role / RPC / trigger (bypassan RLS). Policies
-- en false para cumplir el contrato del enumerador (4 policies, ninguna implícita).
create policy user_roles_insert on public.user_roles
for insert to authenticated
with check (false);

create policy user_roles_update on public.user_roles
for update to authenticated
using (false)
with check (false);

create policy user_roles_delete on public.user_roles
for delete to authenticated
using (false);

-- ---------------------------------------------------------------------------
-- 'user' por defecto: toda cuenta nueva recibe la capacidad base al crear su
-- perfil. security definer (escribe una tabla service-only por trigger).
-- ---------------------------------------------------------------------------
create or replace function app.grant_default_user_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.user_roles (tenant_id, profile_id, role, status, source)
  values (new.tenant_id, new.id, 'user', 'active', 'system')
  on conflict (profile_id, role) do nothing;
  return new;
end;
$$;

comment on function app.grant_default_user_role() is
  'Siembra la capacidad de producto "user" al crear un perfil. Idempotente (on conflict do nothing).';

create trigger profiles_grant_default_user_role
after insert on public.profiles
for each row execute function app.grant_default_user_role();

-- Backfill de los perfiles existentes (17 al momento de esta migración).
insert into public.user_roles (tenant_id, profile_id, role, status, source)
select p.tenant_id, p.id, 'user', 'active', 'system'
  from public.profiles p
on conflict (profile_id, role) do nothing;
