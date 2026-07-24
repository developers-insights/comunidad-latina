-- =============================================================================
-- 0032_creator_activation.sql — Comunidad Latina
-- Activación de creador: máquina de 9 estados (§12/§74) + gate de requisitos
-- (§11) + portafolio rico (§8). creator_profiles ya existe (0024); se le suma
-- status + categories, y se agrega creator_portfolio_items.
--   * 'not_requested' = ausencia de fila (implícito). Tocar "Convertirme en
--     creador" crea la fila en 'application_started' (NO cuenta nueva — §8).
--   * 'approved' lo setea staff/service, NUNCA el creador (guarda de columna).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- creator_profiles: estado de activación + categorías (§8)
-- ---------------------------------------------------------------------------
alter table public.creator_profiles
  add column if not exists status text not null default 'application_started'
    check (status in (
      'not_requested', 'application_started', 'documents_pending',
      'stripe_review_pending', 'platform_review_pending', 'approved',
      'needs_info', 'suspended', 'rejected')),
  add column if not exists status_updated_at timestamptz,
  add column if not exists categories text[] not null default '{}'::text[];

comment on column public.creator_profiles.status is
  'Ciclo de activación (§74): not_requested (=sin fila) → application_started → documents_pending/stripe_review_pending/platform_review_pending → approved/needs_info/suspended/rejected. "approved" lo setea staff/service (guarda protect_creator_reputation). El detalle prende la entrada "Panel de creador" del switcher (user_roles).';
comment on column public.creator_profiles.categories is
  'Categorías del creador (§8, multi). JUICIO PENDIENTE: el design pide un CHECK del set de 23 valores, pero el doc no enumera la lista canónica → se deja text[] SIN CHECK de elementos (forward-compatible: agregar el CHECK es un alter posterior). CONFIRMAR la lista antes de exponer el selector.';

-- Backfill: los creator_profiles YA existentes son creadores activos del demo
-- (ya opt-in y listados) → 'approved', no 'application_started'. JUICIO: sin
-- esto quedarían como "recién solicitado" y Fase 2 los ocultaría. (Analogía del
-- recompute de niveles de 0029: backfill consciente de filas existentes.)
update public.creator_profiles
   set status = 'approved', status_updated_at = now()
 where status = 'application_started';

-- Guarda ampliada: creator_profiles.status es service (RPC de activación via
-- admin client) o staff (aprobación) — nunca el creador por UPDATE directo.
-- Extiende protect_creator_reputation (0024), que ya guarda completed_jobs/rating_*.
create or replace function app.protect_creator_reputation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;
  if coalesce(auth.jwt() ->> 'role', 'service_role') = 'service_role' then
    return new;
  end if;
  if new.completed_jobs is distinct from old.completed_jobs
     or new.rating_avg is distinct from old.rating_avg
     or new.rating_count is distinct from old.rating_count then
    raise exception 'PROTECTED_COLUMNS: la reputación la escriben solo los triggers de contratos/reviews';
  end if;
  -- Estado de activación: service (RPC self-service via admin client) o staff
  -- (aprobación). El creador no salta su propia revisión.
  if new.status is distinct from old.status and not app.is_staff() then
    raise exception 'PROTECTED_COLUMNS: creator_profiles.status lo mueven la RPC de activación (service) o el staff';
  end if;
  return new;
end;
$$;

comment on function app.protect_creator_reputation() is
  'Bloquea que un creador se infle completed_jobs/rating_* o se auto-apruebe (status) editando su perfil. status → solo service (RPC de activación) o staff (aprobación).';

-- La fila de alta se crea en 'application_started' (no 'approved'): se reemplaza
-- la policy INSERT de 0024 (mismo nombre, forward-only) sumando la restricción
-- de status, para que el alta no pueda auto-aprobarse.
drop policy if exists creator_profiles_insert on public.creator_profiles;
create policy creator_profiles_insert on public.creator_profiles
for insert to authenticated
with check (
  tenant_id = (select app.current_tenant_id())
  and profile_id = (select auth.uid())
  and completed_jobs = 0
  and rating_avg is null
  and rating_count = 0
  and status in ('not_requested', 'application_started')
);

-- ---------------------------------------------------------------------------
-- creator_portfolio_items — portafolio rico (§8): fotos, videos, reels,
-- campañas, enlaces, trabajos verificados, testimonios. El gate ≥3 los cuenta.
-- Público-lectura, dueño-escritura. (portfolio_photos de 0024 se conserva para
-- compat/samples rápidos.)
-- ---------------------------------------------------------------------------
create table public.creator_portfolio_items (
  id               uuid primary key default app.uuid_v7(),
  tenant_id        uuid not null references public.tenants(id),
  creator_id       uuid not null references public.creator_profiles(profile_id) on delete cascade,
  kind             text not null check (kind in ('photo', 'video', 'reel', 'link', 'onplatform', 'testimonial')),
  url              text,
  caption          text,
  is_verified_work boolean not null default false,
  sort_order       int not null default 0,
  created_at       timestamptz not null default now()
);

comment on table public.creator_portfolio_items is
  'Ítems del portafolio de un creador (§8). Público-lectura, dueño-escritura. is_verified_work lo setea SOLO el server (no el creador). El gate de activación ≥3 ejemplos (§11) cuenta estos ítems.';
comment on column public.creator_portfolio_items.is_verified_work is
  'Trabajo verificado (transacción real en la plataforma). Lo setea service/server, nunca el creador (guarda protect_portfolio_verified).';

create index creator_portfolio_items_creator_idx
  on public.creator_portfolio_items (tenant_id, creator_id, sort_order);

alter table public.creator_portfolio_items enable row level security;
alter table public.creator_portfolio_items force row level security;

create policy creator_portfolio_items_select on public.creator_portfolio_items
for select to anon, authenticated
using (true);

create policy creator_portfolio_items_insert on public.creator_portfolio_items
for insert to authenticated
with check (
  tenant_id = (select app.current_tenant_id())
  and creator_id = (select auth.uid())
  and is_verified_work = false
);

create policy creator_portfolio_items_update on public.creator_portfolio_items
for update to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and (creator_id = (select auth.uid()) or (select app.is_staff()))
)
with check (
  tenant_id = (select app.current_tenant_id())
  and (creator_id = (select auth.uid()) or (select app.is_staff()))
);

create policy creator_portfolio_items_delete on public.creator_portfolio_items
for delete to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and (
    creator_id = (select auth.uid())
    or (select app.current_user_role()) in ('domain_admin', 'global_admin')
  )
);

-- is_verified_work no es auto-editable por el creador (solo service/staff).
create or replace function app.protect_portfolio_verified()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.jwt() ->> 'role', 'service_role') = 'service_role' then
    return new;
  end if;
  if new.is_verified_work is distinct from old.is_verified_work and not app.is_staff() then
    raise exception 'PROTECTED_COLUMNS: is_verified_work lo marca solo el server/staff';
  end if;
  return new;
end;
$$;

comment on function app.protect_portfolio_verified() is
  'Impide que el creador se auto-marque un ítem como trabajo verificado.';

create trigger creator_portfolio_items_protect_verified
before update on public.creator_portfolio_items
for each row execute function app.protect_portfolio_verified();

create trigger creator_portfolio_items_enforce_account_active
before insert on public.creator_portfolio_items
for each row execute function app.enforce_account_active();

-- ---------------------------------------------------------------------------
-- Gate de requisitos (§11): la data ya existe, se cablea. Devuelve
-- (eligible, reasons[]) — reasons vacío = elegible.
-- ---------------------------------------------------------------------------
create or replace function app.creator_activation_eligible(
  p_profile uuid,
  out eligible boolean,
  out reasons text[]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_profile        record;
  v_dob            date;
  v_age_ok         boolean;
  v_score          int;
  v_portfolio_count int;
  v_reasons        text[] := '{}';
begin
  select p.identity_verified, coalesce(p.phone_verified, false) as phone_verified,
         coalesce(p.email_verified, false) as email_verified, p.account_status,
         p.age_confirmed_at
    into v_profile
    from public.profiles p
   where p.id = p_profile;

  if not found then
    eligible := false;
    reasons  := array['perfil_inexistente'];
    return;
  end if;

  -- 18+ ← user_phones.birthdate o profiles.age_confirmed_at.
  select up.birthdate into v_dob from public.user_phones up where up.profile_id = p_profile;
  v_age_ok := (v_dob is not null and v_dob <= (current_date - interval '18 years'))
              or v_profile.age_confirmed_at is not null;
  if not v_age_ok then v_reasons := v_reasons || 'edad_18'; end if;

  -- User Score ≥ 50 ← trust_scores.score.
  select ts.score into v_score from public.trust_scores ts where ts.profile_id = p_profile;
  if coalesce(v_score, 0) < 50 then v_reasons := v_reasons || 'user_score_50'; end if;

  -- Teléfono / correo / identidad verificados.
  if not v_profile.phone_verified then v_reasons := v_reasons || 'telefono'; end if;
  if not v_profile.email_verified then v_reasons := v_reasons || 'correo'; end if;
  if not v_profile.identity_verified then v_reasons := v_reasons || 'identidad'; end if;

  -- Sin suspensiones: cuenta activa + sin restricción de scope marketplace.
  if v_profile.account_status <> 'active' then
    v_reasons := v_reasons || 'cuenta_activa';
  elsif to_regclass('public.account_restrictions') is not null then
    -- account_restrictions se crea en 0033 (posterior): guarda late-binding.
    if exists (
      select 1 from public.account_restrictions ar
       where ar.profile_id = p_profile
         and ar.scope in ('marketplace', 'total')
         and ar.lifted_at is null
         and (ar.expires_at is null or ar.expires_at > now())
    ) then
      v_reasons := v_reasons || 'restriccion_marketplace';
    end if;
  end if;

  -- ≥3 ejemplos de portafolio (§11). NO exige mínimo de seguidores.
  select count(*) into v_portfolio_count
    from public.creator_portfolio_items where creator_id = p_profile;
  if v_portfolio_count < 3 then v_reasons := v_reasons || 'portafolio_3'; end if;

  eligible := (array_length(v_reasons, 1) is null);
  reasons  := v_reasons;
end;
$$;

comment on function app.creator_activation_eligible(uuid) is
  'Gate de requisitos de activación de creador (§11): 18+, User Score ≥50, teléfono/correo/identidad verificados, cuenta activa sin restricción marketplace, ≥3 ítems de portafolio. NO exige seguidores. Devuelve (eligible, reasons[]).';

-- ---------------------------------------------------------------------------
-- RPC self-service: solicita la activación (valida el gate y transiciona).
-- INVOCACIÓN: server-side con el admin client (service_role) tras verificar que
-- la sesión es dueña de p_profile_id — doctrina de escritura privilegiada del
-- repo (ARQUITECTURA §6, como escrow/signup/webhooks). Bajo admin client
-- auth.uid() es null, por eso el id va por parámetro; la escritura de status
-- pasa la guarda por ser service_role.
-- ---------------------------------------------------------------------------
create or replace function public.request_creator_activation(p_profile_id uuid)
returns text
language plpgsql
volatile
security definer
set search_path = public, app
as $$
declare
  v_tenant   uuid;
  v_eligible boolean;
  v_reasons  text[];
begin
  select cp.tenant_id into v_tenant
    from public.creator_profiles cp
   where cp.profile_id = p_profile_id;

  if not found then
    raise exception 'NO_CREATOR_PROFILE: primero se crea el perfil de creador (application_started).';
  end if;

  select eligible, reasons into v_eligible, v_reasons
    from app.creator_activation_eligible(p_profile_id);

  if not v_eligible then
    raise exception 'NOT_ELIGIBLE: faltan requisitos: %', array_to_string(v_reasons, ', ');
  end if;

  update public.creator_profiles
     set status = 'platform_review_pending', status_updated_at = now()
   where profile_id = p_profile_id;

  -- Refleja el rol creador en el switcher (user_roles).
  insert into public.user_roles (tenant_id, profile_id, role, status, source)
  values (v_tenant, p_profile_id, 'creator', 'active', 'rpc')
  on conflict (profile_id, role) do update set status = 'active';

  return 'platform_review_pending';
end;
$$;

comment on function public.request_creator_activation(uuid) is
  'Solicita la activación de creador: valida el gate (§11) y transiciona application_started → platform_review_pending, + prende user_roles creator. Invocar server-side con admin client tras verificar ownership de la sesión.';

revoke execute on function public.request_creator_activation(uuid) from public, anon;
grant execute on function public.request_creator_activation(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RPC staff: aprobar / resolver la activación (§74 paso 3). Rol contra el JWT.
-- ---------------------------------------------------------------------------
create or replace function public.admin_resolve_creator_activation(
  p_profile_id uuid,
  p_decision   text,   -- 'approved' | 'needs_info' | 'rejected' | 'suspended'
  p_note       text default null
)
returns text
language plpgsql
volatile
security definer
set search_path = public, app
as $$
declare
  v_tenant uuid := app.current_tenant_id();
begin
  if auth.uid() is null or v_tenant is null then
    raise exception 'AUTH_REQUIRED: necesitás una cuenta.';
  end if;
  if not app.is_staff() then
    raise exception 'FORBIDDEN: necesitás permisos de moderación.';
  end if;
  if p_decision not in ('approved', 'needs_info', 'rejected', 'suspended') then
    raise exception 'INVALID_DECISION: approved | needs_info | rejected | suspended.';
  end if;

  if not exists (
    select 1 from public.creator_profiles cp
     where cp.profile_id = p_profile_id and cp.tenant_id = v_tenant
  ) then
    raise exception 'NO_CREATOR_PROFILE: el creador no existe en tu comunidad.';
  end if;

  update public.creator_profiles
     set status = p_decision, status_updated_at = now()
   where profile_id = p_profile_id and tenant_id = v_tenant;

  update public.user_roles
     set status = case when p_decision in ('rejected', 'suspended') then 'revoked' else 'active' end
   where profile_id = p_profile_id and role = 'creator';

  return p_decision;
end;
$$;

comment on function public.admin_resolve_creator_activation(uuid, text, text) is
  'Staff (moderator+) resuelve la activación de un creador del MISMO tenant (§74). Rol validado contra el JWT. La escritura de status pasa la guarda por la rama is_staff.';

revoke execute on function public.admin_resolve_creator_activation(uuid, text, text) from public, anon;
grant execute on function public.admin_resolve_creator_activation(uuid, text, text) to authenticated, service_role;
