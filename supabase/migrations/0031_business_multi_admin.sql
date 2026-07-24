-- =============================================================================
-- 0031_business_multi_admin.sql — Comunidad Latina
-- Negocio como entidad MULTI-ADMIN, colgado de business_accounts (OQ#3: se
-- REUSA business_accounts como ancla — NO se crea tabla `businesses`). La cara
-- pública sigue siendo el listing kind='business'; business_accounts es el ancla
-- estable de identidad+billing.
--   * business_members      — multi-admin (§101) + app.business_role().
--   * business_verifications— 5 niveles (§103), Stripe (financiero) vs CL (comunitario).
--   * business_audit_log    — log por-negocio (§101) + TTL cron (365d).
--   * espejo del owner_id como fila business_members (propietario) = una sola
--     fuente de permisos.
--   * mantiene la bandera user_roles 'business' (presencia) por trigger.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- business_members — multi-admin (§101)
-- ---------------------------------------------------------------------------
create table public.business_members (
  id          uuid primary key default app.uuid_v7(),
  tenant_id   uuid not null references public.tenants(id),
  business_id uuid not null references public.business_accounts(id) on delete cascade,
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  role        text not null check (role in ('propietario', 'administrador', 'editor', 'atencion', 'analista')),
  status      text not null default 'active' check (status in ('active', 'invited', 'revoked')),
  invited_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint business_members_one_per_business unique (business_id, profile_id)
);

comment on table public.business_members is
  'Membresías de administración de un negocio (§101): una persona puede administrar varios negocios, con rol distinto en cada uno. El owner_id de business_accounts se ESPEJA acá como fila propietario (una sola fuente de permisos). Escribe RPC/service; la lectura es de los miembros del negocio + staff.';

create index business_members_business_idx on public.business_members (tenant_id, business_id, status);
create index business_members_profile_idx on public.business_members (tenant_id, profile_id, status);

create trigger business_members_set_updated_at
before update on public.business_members
for each row execute function extensions.moddatetime(updated_at);

-- Helper: rol del miembro ACTIVO de un negocio, o null (análogo de app.is_staff
-- para un negocio). security definer → base del gating en RLS de las satélites
-- sin recursión sobre business_members.
create or replace function app.business_role(p_business uuid, p_profile uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select bm.role
    from public.business_members bm
   where bm.business_id = p_business
     and bm.profile_id = p_profile
     and bm.status = 'active'
   limit 1;
$$;

comment on function app.business_role(uuid, uuid) is
  'Rol del miembro ACTIVO (propietario/administrador/editor/atencion/analista) o null. security definer: usable dentro de policies de las tablas satélite sin recursión de RLS.';

alter table public.business_members enable row level security;
alter table public.business_members force row level security;

-- Ven la membresía: el propio miembro (su fila), cualquier miembro activo del
-- negocio (toda la lista) y staff.
create policy business_members_select on public.business_members
for select to authenticated
using (
  (
    tenant_id = (select app.current_tenant_id())
    and (
      profile_id = (select auth.uid())
      or app.business_role(business_id, (select auth.uid())) is not null
      or (select app.is_staff())
    )
  )
  or (select app.is_global_admin())
);

-- La membresía la gestionan RPCs/server (invitaciones, altas, bajas): service.
create policy business_members_insert on public.business_members
for insert to authenticated
with check (false);

create policy business_members_update on public.business_members
for update to authenticated
using (false)
with check (false);

create policy business_members_delete on public.business_members
for delete to authenticated
using (false);

-- Espejo del propietario: al crear un negocio, su owner_id entra como fila
-- business_members (propietario, active) → una sola fuente de permisos.
create or replace function app.mirror_business_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.business_members (tenant_id, business_id, profile_id, role, status)
  values (new.tenant_id, new.id, new.owner_id, 'propietario', 'active')
  on conflict (business_id, profile_id) do nothing;
  return new;
end;
$$;

comment on function app.mirror_business_owner() is
  'Al crear un business_accounts, espeja su owner_id como fila business_members (propietario). Idempotente.';

create trigger business_accounts_mirror_owner
after insert on public.business_accounts
for each row execute function app.mirror_business_owner();

-- Backfill: negocios ya existentes → fila propietario (0 al momento de escribir,
-- pero idempotente por si se aplica tarde).
insert into public.business_members (tenant_id, business_id, profile_id, role, status)
select ba.tenant_id, ba.id, ba.owner_id, 'propietario', 'active'
  from public.business_accounts ba
on conflict (business_id, profile_id) do nothing;

-- Presencia 'business' en user_roles (§1): primera membership activa → agrega
-- la capacidad; baja de la última → la quita.
create or replace function app.sync_business_user_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile uuid := coalesce(new.profile_id, old.profile_id);
  v_tenant  uuid;
  v_has_active boolean;
begin
  select exists (
    select 1 from public.business_members bm
     where bm.profile_id = v_profile and bm.status = 'active'
  ) into v_has_active;

  if v_has_active then
    select p.tenant_id into v_tenant from public.profiles p where p.id = v_profile;
    if v_tenant is not null then
      insert into public.user_roles (tenant_id, profile_id, role, status, source)
      values (v_tenant, v_profile, 'business', 'active', 'trigger')
      on conflict (profile_id, role) do update set status = 'active';
    end if;
  else
    delete from public.user_roles
     where profile_id = v_profile and role = 'business';
  end if;

  return coalesce(new, old);
end;
$$;

comment on function app.sync_business_user_role() is
  'Mantiene la capacidad de producto "business" en user_roles como bandera de presencia ("administra ≥1 negocio").';

create trigger business_members_sync_user_role
after insert or update or delete on public.business_members
for each row execute function app.sync_business_user_role();

-- ---------------------------------------------------------------------------
-- business_verifications — 5 niveles (§103), una fila por negocio. Modela la
-- separación Stripe (financiero/legal) vs CL (comunitario) de §104.
-- ---------------------------------------------------------------------------
create table public.business_verifications (
  business_id             uuid primary key references public.business_accounts(id) on delete cascade,
  tenant_id               uuid not null references public.tenants(id),
  account_verified        boolean not null default false,
  commercial_info_status  text not null default 'pending'
                            check (commercial_info_status in ('pending', 'submitted', 'verified', 'rejected')),
  documental_status       text not null default 'pending'
                            check (documental_status in ('pending', 'submitted', 'verified', 'rejected')),
  stripe_status           text not null default 'pending'
                            check (stripe_status in ('pending', 'submitted', 'verified', 'restricted', 'rejected')),
  platform_review_status  text not null default 'pending'
                            check (platform_review_status in ('pending', 'in_review', 'approved', 'rejected')),
  verification_status     text not null default 'unverified'
                            check (verification_status in ('unverified', 'partial', 'verified')),
  verification_updated_at timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

comment on table public.business_verifications is
  'Estado de verificación de un negocio, 5 niveles (§103). Columnas separadas para Stripe (financiero/legal) y CL (comunitario) — son dos verificaciones distintas (§104). Service-escritura; lectura de miembros + staff.';

create trigger business_verifications_set_updated_at
before update on public.business_verifications
for each row execute function extensions.moddatetime(updated_at);

alter table public.business_verifications enable row level security;
alter table public.business_verifications force row level security;

create policy business_verifications_select on public.business_verifications
for select to authenticated
using (
  (
    tenant_id = (select app.current_tenant_id())
    and (
      app.business_role(business_id, (select auth.uid())) is not null
      or (select app.is_staff())
    )
  )
  or (select app.is_global_admin())
);

create policy business_verifications_insert on public.business_verifications
for insert to authenticated
with check (false);

create policy business_verifications_update on public.business_verifications
for update to authenticated
using (false)
with check (false);

create policy business_verifications_delete on public.business_verifications
for delete to authenticated
using (false);

-- ---------------------------------------------------------------------------
-- business_audit_log — log de acciones admin por-negocio (§101). DISTINTO del
-- audit_log global (que es de staff de plataforma). TTL 365d por cron.
-- ---------------------------------------------------------------------------
create table public.business_audit_log (
  id          uuid primary key default app.uuid_v7(),
  tenant_id   uuid not null references public.tenants(id),
  business_id uuid not null references public.business_accounts(id) on delete cascade,
  actor_id    uuid references public.profiles(id) on delete set null,
  action      text not null,
  target_type text,
  target_ref  text,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

comment on table public.business_audit_log is
  'Registro de acciones administrativas de un negocio (§101: "todas las acciones admin quedan registradas"). Distinto del audit_log global. Lectura: miembros admin+ del negocio + staff; escribe service/RPC. TTL 365 días (alineado con audit_log).';

create index business_audit_log_business_idx on public.business_audit_log (tenant_id, business_id, created_at desc);

alter table public.business_audit_log enable row level security;
alter table public.business_audit_log force row level security;

create policy business_audit_log_select on public.business_audit_log
for select to authenticated
using (
  (
    tenant_id = (select app.current_tenant_id())
    and (
      app.business_role(business_id, (select auth.uid())) in ('propietario', 'administrador')
      or (select app.is_staff())
    )
  )
  or (select app.is_global_admin())
);

create policy business_audit_log_insert on public.business_audit_log
for insert to authenticated
with check (false);

create policy business_audit_log_update on public.business_audit_log
for update to authenticated
using (false)
with check (false);

create policy business_audit_log_delete on public.business_audit_log
for delete to authenticated
using (false);

-- TTL 365 días (04:30 UTC diario). Idempotente (patrón 0013).
do $$
begin
  perform cron.unschedule('purge-old-business-audit-log');
exception
  when others then null;
end;
$$;

select cron.schedule(
  'purge-old-business-audit-log',
  '30 4 * * *',
  $$delete from public.business_audit_log where created_at < now() - interval '365 days'$$
);
