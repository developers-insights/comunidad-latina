-- =============================================================================
-- 0021_account_sanctions.sql — Comunidad Latina
-- Suspensión y baja de cuentas (moderación §8):
--   * profiles.account_status ('active'|'suspended'|'banned') + suspended_until.
--   * account_sanctions — historial auditable (quién, qué, por qué, hasta cuándo).
--   * app.account_active() + trigger app.enforce_account_active(): una cuenta
--     suspendida/baneada NO publica ni envía mensajes, en la capa de datos —
--     ninguna UI ni cliente API la puede evadir.
--   * RPCs admin_suspend_user / admin_ban_user / admin_reactivate_user:
--     rol contra el claim del JWT (app.current_user_role()), jamás profiles.role.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- profiles: estado de cuenta
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column account_status text not null default 'active'
    check (account_status in ('active', 'suspended', 'banned')),
  add column suspended_until timestamptz;

comment on column public.profiles.account_status is
  'active | suspended | banned. Enforcement en DB via app.account_active() + triggers BEFORE INSERT (una suspensión vencida se considera activa sin necesidad de cron). Escriben las RPCs admin_* (staff) o service_role; el dueño NO se auto-reactiva (guarda en app.protect_profile_columns()).';
comment on column public.profiles.suspended_until is
  'Fin de la suspensión temporal. null cuando account_status es active o banned. Vencida (<= now()) la cuenta vuelve a operar sola.';

-- Guarda ampliada: account_status/suspended_until no son auto-editables.
-- Sin esto, la RLS de profiles (el dueño edita su fila) dejaría que un
-- suspendido se ponga account_status='active' con un UPDATE directo.
-- Staff pasa (las RPCs admin_* corren con el JWT del moderador); el resto de
-- las columnas protegidas de 0003 siguen siendo solo-service_role.
create or replace function app.protect_profile_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Sin claims (postgres directo, pg_cron, seeds) o service_role: permitido.
  if coalesce(auth.jwt() ->> 'role', 'service_role') = 'service_role' then
    return new;
  end if;

  if new.role is distinct from old.role
     or new.identity_verified is distinct from old.identity_verified
     or new.identity_verified_at is distinct from old.identity_verified_at
     or new.tenant_id is distinct from old.tenant_id then
    raise exception 'PROTECTED_COLUMNS: role/identity_verified/tenant_id de profiles solo se modifican via service_role';
  end if;

  if (new.account_status is distinct from old.account_status
      or new.suspended_until is distinct from old.suspended_until)
     and not app.is_staff() then
    raise exception 'PROTECTED_COLUMNS: account_status/suspended_until solo se modifican via moderación';
  end if;

  return new;
end;
$$;

comment on function app.protect_profile_columns() is
  'Impide que un usuario autenticado se auto-asigne rol, flag de verificación o cambio de tenant por UPDATE directo. Desde 0021 también guarda account_status/suspended_until (los muta solo staff — via RPCs admin_* — o service_role): nadie se auto-levanta una suspensión.';

-- ---------------------------------------------------------------------------
-- account_sanctions — historial auditable de sanciones
-- ---------------------------------------------------------------------------
create table public.account_sanctions (
  id         uuid primary key default app.uuid_v7(),
  tenant_id  uuid not null references public.tenants(id),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  actor_id   uuid references public.profiles(id) on delete set null,
  kind       text not null check (kind in ('suspend', 'ban', 'reactivate')),
  reason     text not null,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.account_sanctions is
  'Historial de sanciones de cuenta (suspensión/baja/reactivación) con actor y motivo: la decisión de moderación queda auditable. Escriben SOLO las RPCs admin_* (security definer) o service_role; lectura exclusiva de staff del tenant. El estado vigente vive en profiles.account_status; esto es el registro histórico.';
comment on column public.account_sanctions.actor_id is
  'Staff que aplicó la sanción. on delete set null: si el actor borra su cuenta, la sanción persiste como evidencia.';
comment on column public.account_sanctions.expires_at is
  'Fin de la suspensión (solo kind=suspend). null en ban/reactivate.';

create index account_sanctions_profile_idx on public.account_sanctions (tenant_id, profile_id, created_at desc);

alter table public.account_sanctions enable row level security;
alter table public.account_sanctions force row level security;

-- Solo staff del tenant (y global_admin) ve el historial de sanciones.
create policy account_sanctions_select on public.account_sanctions
for select to authenticated
using (
  (
    tenant_id = (select app.current_tenant_id())
    and (select app.is_staff())
  )
  or (select app.is_global_admin())
);

-- Escriben las RPCs admin_* / service_role (bypassa): nadie por API con JWT.
create policy account_sanctions_insert on public.account_sanctions
for insert to authenticated
with check (false);

create policy account_sanctions_update on public.account_sanctions
for update to authenticated
using (false)
with check (false);

-- El historial es evidencia: no se borra por API.
create policy account_sanctions_delete on public.account_sanctions
for delete to authenticated
using (false);

-- ---------------------------------------------------------------------------
-- app.account_active — ¿la cuenta puede operar?
-- ---------------------------------------------------------------------------
create or replace function app.account_active(p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select p.account_status = 'active'
             or (
               p.account_status = 'suspended'
               and p.suspended_until is not null
               and p.suspended_until <= now()
             )
        from public.profiles p
       where p.id = p_profile
    ),
    true  -- perfil inexistente: no romper flujos service_role/seed
  );
$$;

comment on function app.account_active(uuid) is
  'true si la cuenta está active o con suspensión VENCIDA (no hace falta cron para reactivar); false si está banned o suspendida vigente. Perfil inexistente → true (no romper flujos de service_role/seed).';

-- ---------------------------------------------------------------------------
-- app.enforce_account_active — BEFORE INSERT en todo lo que "publica"
-- ---------------------------------------------------------------------------
create or replace function app.enforce_account_active()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- auth.uid() null = service_role / seed / cron: pasa.
  if auth.uid() is not null and not app.account_active(auth.uid()) then
    raise exception 'ACCOUNT_SUSPENDED: tu cuenta está suspendida y no puede publicar ni enviar mensajes por ahora.';
  end if;

  return new;
end;
$$;

comment on function app.enforce_account_active() is
  'BEFORE INSERT: corta en la capa de datos la creación de contenido (posts, comments, messages, conversations, listings, scam_reports) de cuentas suspendidas o baneadas. Sin JWT (service_role/seed/cron) pasa.';

create trigger posts_enforce_account_active
before insert on public.posts
for each row execute function app.enforce_account_active();

create trigger comments_enforce_account_active
before insert on public.comments
for each row execute function app.enforce_account_active();

create trigger messages_enforce_account_active
before insert on public.messages
for each row execute function app.enforce_account_active();

create trigger conversations_enforce_account_active
before insert on public.conversations
for each row execute function app.enforce_account_active();

create trigger listings_enforce_account_active
before insert on public.listings
for each row execute function app.enforce_account_active();

create trigger scam_reports_enforce_account_active
before insert on public.scam_reports
for each row execute function app.enforce_account_active();

-- ---------------------------------------------------------------------------
-- admin_suspend_user — suspensión temporal (moderator+)
-- ---------------------------------------------------------------------------
create or replace function public.admin_suspend_user(
  p_profile_id uuid,
  p_days       int,
  p_reason     text
)
returns void
language plpgsql
volatile
security definer
set search_path = public, app
as $$
declare
  v_uid    uuid := auth.uid();
  v_tenant uuid := app.current_tenant_id();
  v_target record;
  v_until  timestamptz;
begin
  if v_uid is null or v_tenant is null then
    raise exception 'AUTH_REQUIRED: necesitás una cuenta.';
  end if;

  -- Rol SIEMPRE contra el claim del JWT, nunca profiles.role.
  if not app.is_staff() then
    raise exception 'FORBIDDEN: necesitás permisos de moderación.';
  end if;

  if p_days is null or p_days < 1 or p_days > 90 then
    raise exception 'INVALID_DAYS: la suspensión va de 1 a 90 días.';
  end if;

  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'REASON_REQUIRED: dejá registrado el motivo de la sanción.';
  end if;

  select p.id, p.role into v_target
    from public.profiles p
   where p.id = p_profile_id
     and p.tenant_id = v_tenant;

  if not found then
    raise exception 'PROFILE_NOT_FOUND: el perfil no existe en tu comunidad.';
  end if;

  if v_target.role <> 'member' then
    raise exception 'CANNOT_SANCTION_STAFF: no se puede sancionar a un miembro del staff desde acá.';
  end if;

  v_until := now() + make_interval(days => p_days);

  update public.profiles
     set account_status = 'suspended',
         suspended_until = v_until
   where id = p_profile_id;

  insert into public.account_sanctions (tenant_id, profile_id, actor_id, kind, reason, expires_at)
  values (v_tenant, p_profile_id, v_uid, 'suspend', btrim(p_reason), v_until);
end;
$$;

comment on function public.admin_suspend_user(uuid, int, text) is
  'Suspende una cuenta member del MISMO tenant por 1-90 días (rol mínimo moderator, validado contra el JWT). Staff no es sancionable por acá. Registra la sanción en account_sanctions con actor y motivo.';

revoke execute on function public.admin_suspend_user(uuid, int, text) from public, anon;
grant execute on function public.admin_suspend_user(uuid, int, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- admin_ban_user — baja permanente (domain_admin+)
-- ---------------------------------------------------------------------------
create or replace function public.admin_ban_user(
  p_profile_id uuid,
  p_reason     text
)
returns void
language plpgsql
volatile
security definer
set search_path = public, app
as $$
declare
  v_uid    uuid := auth.uid();
  v_tenant uuid := app.current_tenant_id();
  v_target record;
begin
  if v_uid is null or v_tenant is null then
    raise exception 'AUTH_REQUIRED: necesitás una cuenta.';
  end if;

  -- Ban = irreversible salvo reactivación explícita: pide domain_admin+.
  if app.current_user_role() not in ('domain_admin', 'global_admin') then
    raise exception 'FORBIDDEN: dar de baja una cuenta requiere permisos de administración.';
  end if;

  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'REASON_REQUIRED: dejá registrado el motivo de la sanción.';
  end if;

  select p.id, p.role into v_target
    from public.profiles p
   where p.id = p_profile_id
     and p.tenant_id = v_tenant;

  if not found then
    raise exception 'PROFILE_NOT_FOUND: el perfil no existe en tu comunidad.';
  end if;

  if v_target.role <> 'member' then
    raise exception 'CANNOT_SANCTION_STAFF: no se puede sancionar a un miembro del staff desde acá.';
  end if;

  update public.profiles
     set account_status = 'banned',
         suspended_until = null
   where id = p_profile_id;

  insert into public.account_sanctions (tenant_id, profile_id, actor_id, kind, reason)
  values (v_tenant, p_profile_id, v_uid, 'ban', btrim(p_reason));
end;
$$;

comment on function public.admin_ban_user(uuid, text) is
  'Baja permanente de una cuenta member del MISMO tenant (rol mínimo domain_admin, validado contra el JWT). Staff no es sancionable por acá. Registra la sanción en account_sanctions.';

revoke execute on function public.admin_ban_user(uuid, text) from public, anon;
grant execute on function public.admin_ban_user(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- admin_reactivate_user — levantar sanción (moderator+)
-- ---------------------------------------------------------------------------
create or replace function public.admin_reactivate_user(p_profile_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public, app
as $$
declare
  v_uid    uuid := auth.uid();
  v_tenant uuid := app.current_tenant_id();
begin
  if v_uid is null or v_tenant is null then
    raise exception 'AUTH_REQUIRED: necesitás una cuenta.';
  end if;

  if not app.is_staff() then
    raise exception 'FORBIDDEN: necesitás permisos de moderación.';
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.id = p_profile_id and p.tenant_id = v_tenant
  ) then
    raise exception 'PROFILE_NOT_FOUND: el perfil no existe en tu comunidad.';
  end if;

  update public.profiles
     set account_status = 'active',
         suspended_until = null
   where id = p_profile_id;

  insert into public.account_sanctions (tenant_id, profile_id, actor_id, kind, reason)
  values (v_tenant, p_profile_id, v_uid, 'reactivate', 'reactivación manual');
end;
$$;

comment on function public.admin_reactivate_user(uuid) is
  'Reactiva una cuenta suspendida o baneada del MISMO tenant (rol mínimo moderator, validado contra el JWT). Registra kind=reactivate en account_sanctions.';

revoke execute on function public.admin_reactivate_user(uuid) from public, anon;
grant execute on function public.admin_reactivate_user(uuid) to authenticated, service_role;
