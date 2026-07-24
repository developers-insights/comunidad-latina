-- =============================================================================
-- 0033_reviews_appeals_suspensions.sql — Comunidad Latina
-- Reseñas doble-ciego · apelaciones · suspensiones granulares.
--
-- ⚠️ business_reviews (reseñas COMUNITARIAS de negocio) fue DIFERIDA
-- (decisión Manuel OQ#4): NO se construye en este ciclo. El factor "reseñas
-- verificadas" del Business Score se alimenta solo de reseñas de contrato
-- (gig_reviews, transacción released). business_reviews queda documentada como
-- capa posterior (con moderación anti review-bombing).
--
-- Contenido: gig_reviews doble-ciego (alter + reveal on-both + reveal on-timeout)
-- · appeals (§43) · account_restrictions + account_sanctions.scope (§42) + RPCs
-- + triggers scoped.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 7.1 Reseñas doble-ciego (§33) — alter de gig_reviews
-- ---------------------------------------------------------------------------
alter table public.gig_reviews
  add column if not exists visible    boolean not null default false,
  add column if not exists visible_at timestamptz;

comment on column public.gig_reviews.visible is
  'Doble-ciego (§33): una reseña es invisible a la contraparte hasta que ambos calificaron (reveal on-both) o pasan 14 días del contrato released (reveal on-timeout). Cada parte ve SIEMPRE la suya. Lo escribe solo el trigger/cron (service).';

-- Backfill: las reseñas ya existentes eran públicas (policy using(true) de 0024)
-- → se preservan visibles. El doble-ciego aplica a las nuevas.
update public.gig_reviews set visible = true, visible_at = coalesce(visible_at, created_at)
 where visible = false;

-- Se REEMPLAZA gig_reviews_select (mismo nombre, forward-only): cada parte ve su
-- propia reseña siempre; el resto solo cuando visible. anon (sin auth.uid) ve
-- solo visible=true.
drop policy if exists gig_reviews_select on public.gig_reviews;
create policy gig_reviews_select on public.gig_reviews
for select to anon, authenticated
using (
  visible = true
  or reviewer_id = (select auth.uid())
  or (select app.is_staff())
  or (select app.is_global_admin())
);

-- Reveal ON-BOTH: al insertarse la reseña de la contraparte del mismo contrato,
-- ambas se hacen visibles. security definer (el update de gig_reviews es service).
create or replace function app.gig_reviews_reveal_on_both()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.gig_reviews r
     where r.contract_id = new.contract_id
       and r.reviewer_id <> new.reviewer_id
  ) then
    update public.gig_reviews
       set visible = true, visible_at = now()
     where contract_id = new.contract_id
       and visible = false;
  end if;
  return new;
end;
$$;

comment on function app.gig_reviews_reveal_on_both() is
  'Doble-ciego: cuando llega la segunda reseña de un contrato, revela ambas.';

create trigger gig_reviews_reveal_on_both
after insert on public.gig_reviews
for each row execute function app.gig_reviews_reveal_on_both();

-- Reveal ON-TIMEOUT: contratos released hace > 14 días → sus reseñas se hacen
-- visibles aunque la contraparte no haya calificado (evita represalias sin
-- congelar la reputación). 05:00 UTC diario, idempotente.
do $$
begin
  perform cron.unschedule('reveal-stale-gig-reviews');
exception
  when others then null;
end;
$$;

select cron.schedule(
  'reveal-stale-gig-reviews',
  '0 5 * * *',
  $$update public.gig_reviews r
       set visible = true, visible_at = now()
      from public.gig_contracts c
     where c.id = r.contract_id
       and r.visible = false
       and c.status = 'released'
       and c.released_at is not null
       and c.released_at < now() - interval '14 days'$$
);

-- ---------------------------------------------------------------------------
-- 7.3 appeals — ciclo de 7 estados (§43). "No apelado" = ausencia de fila.
-- ---------------------------------------------------------------------------
create table public.appeals (
  id              uuid primary key default app.uuid_v7(),
  tenant_id       uuid not null references public.tenants(id),
  profile_id      uuid not null references public.profiles(id) on delete cascade,
  subject_type    text not null check (subject_type in (
                    'sanction', 'penalty', 'score', 'creator_rejection',
                    'business_rejection', 'content_removal')),
  subject_ref     uuid,
  reason          text not null,
  evidence_urls   text[] not null default '{}'::text[],
  status          text not null default 'presentada'
                    check (status in ('presentada', 'en_revision', 'info_solicitada',
                                      'aprobada', 'rechazada', 'cerrada')),
  resolution_note text,
  resolved_by     uuid references public.profiles(id) on delete set null,
  resolved_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.appeals is
  'Apelaciones (§43), 6 estados. El apelante presenta; el staff transiciona por RPC. Aprobar una apelación de penalización → revierte la score_penalty y recomputa (Fase 2). Lectura: apelante + staff.';

create index appeals_profile_idx on public.appeals (tenant_id, profile_id, created_at desc);
create index appeals_status_idx on public.appeals (tenant_id, status, created_at desc);

create trigger appeals_set_updated_at
before update on public.appeals
for each row execute function extensions.moddatetime(updated_at);

alter table public.appeals enable row level security;
alter table public.appeals force row level security;

create policy appeals_select on public.appeals
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

-- El apelante presenta en primera persona, en estado inicial.
create policy appeals_insert on public.appeals
for insert to authenticated
with check (
  tenant_id = (select app.current_tenant_id())
  and profile_id = (select auth.uid())
  and status = 'presentada'
);

-- Las transiciones las hace el staff por RPC (service).
create policy appeals_update on public.appeals
for update to authenticated
using (false)
with check (false);

create policy appeals_delete on public.appeals
for delete to authenticated
using (false);

create trigger appeals_enforce_account_active
before insert on public.appeals
for each row execute function app.enforce_account_active();

-- ---------------------------------------------------------------------------
-- 7.4 Suspensiones granulares (§42) — eje por-scope, sin tocar el global.
-- ---------------------------------------------------------------------------
alter table public.account_sanctions
  add column if not exists scope text not null default 'total'
    check (scope in ('social', 'marketplace', 'pagos', 'publicidad', 'total'));

comment on column public.account_sanctions.scope is
  'Scope de la sanción (§42). "total" = la sanción global histórica de 0021 (default, sin cambio de comportamiento). Los otros scopes los registran las restricciones granulares.';

create table public.account_restrictions (
  id         uuid primary key default app.uuid_v7(),
  tenant_id  uuid not null references public.tenants(id),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  scope      text not null check (scope in ('social', 'marketplace', 'pagos', 'publicidad', 'total')),
  reason     text not null,
  expires_at timestamptz,
  applied_by uuid references public.profiles(id) on delete set null,
  lifted_at  timestamptz,
  lifted_by  uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.account_restrictions is
  'Restricción por-scope (§42), análogo scoped de profiles.account_status. Activa si lifted_at is null y (expires_at is null o > now()). El global enforce_account_active (total/banned) queda intacto; §42: "social no bloquea pagos ya ganados salvo investigación" → los scopes son independientes. Lectura: dueño + staff; escribe RPC admin.';

create index account_restrictions_profile_idx
  on public.account_restrictions (tenant_id, profile_id, scope);

alter table public.account_restrictions enable row level security;
alter table public.account_restrictions force row level security;

create policy account_restrictions_select on public.account_restrictions
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

create policy account_restrictions_insert on public.account_restrictions
for insert to authenticated
with check (false);

create policy account_restrictions_update on public.account_restrictions
for update to authenticated
using (false)
with check (false);

create policy account_restrictions_delete on public.account_restrictions
for delete to authenticated
using (false);

-- Helper: ¿el perfil tiene una restricción vigente de este scope (o total)?
create or replace function app.has_restriction(p_profile uuid, p_scope text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.account_restrictions ar
     where ar.profile_id = p_profile
       and ar.scope in (p_scope, 'total')
       and ar.lifted_at is null
       and (ar.expires_at is null or ar.expires_at > now())
  );
$$;

comment on function app.has_restriction(uuid, text) is
  'true si el perfil tiene una restricción vigente del scope pedido o "total". Base de los triggers de enforcement scoped.';

-- Enforcement SOCIAL: posts/comments/reactions.
create or replace function app.enforce_social_active()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null and app.has_restriction(auth.uid(), 'social') then
    raise exception 'RESTRICTED_SOCIAL: tu cuenta tiene una restricción social temporal.';
  end if;
  return new;
end;
$$;

comment on function app.enforce_social_active() is
  'BEFORE INSERT: corta contenido social (posts/comments/reactions) de cuentas con restricción de scope social o total. Sin JWT (service/seed/cron) pasa.';

create trigger posts_enforce_social_active
before insert on public.posts
for each row execute function app.enforce_social_active();

create trigger comments_enforce_social_active
before insert on public.comments
for each row execute function app.enforce_social_active();

create trigger reactions_enforce_social_active
before insert on public.reactions
for each row execute function app.enforce_social_active();

-- Enforcement MARKETPLACE: gig_applications (los contratos van por server).
create or replace function app.enforce_marketplace_active()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null and app.has_restriction(auth.uid(), 'marketplace') then
    raise exception 'RESTRICTED_MARKETPLACE: tu cuenta tiene una restricción de marketplace temporal.';
  end if;
  return new;
end;
$$;

comment on function app.enforce_marketplace_active() is
  'BEFORE INSERT: corta la actividad de marketplace (aplicaciones a gigs) de cuentas con restricción de scope marketplace o total. pagos/publicidad se cablearán donde fluya el dinero/boosts (Connect-ready).';

create trigger gig_applications_enforce_marketplace_active
before insert on public.gig_applications
for each row execute function app.enforce_marketplace_active();

-- RPC admin: restringir por scope (espejo de admin_suspend_user, 0021).
create or replace function public.admin_restrict_user(
  p_profile_id uuid,
  p_scope      text,
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
  v_uid     uuid := auth.uid();
  v_tenant  uuid := app.current_tenant_id();
  v_target  record;
  v_expires timestamptz;
begin
  if v_uid is null or v_tenant is null then
    raise exception 'AUTH_REQUIRED: necesitás una cuenta.';
  end if;
  if not app.is_staff() then
    raise exception 'FORBIDDEN: necesitás permisos de moderación.';
  end if;
  if p_scope not in ('social', 'marketplace', 'pagos', 'publicidad', 'total') then
    raise exception 'INVALID_SCOPE: social | marketplace | pagos | publicidad | total.';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'REASON_REQUIRED: dejá registrado el motivo.';
  end if;
  if p_days is not null and (p_days < 1 or p_days > 365) then
    raise exception 'INVALID_DAYS: la restricción va de 1 a 365 días (o null = indefinida).';
  end if;

  select p.id, p.role into v_target
    from public.profiles p
   where p.id = p_profile_id and p.tenant_id = v_tenant;
  if not found then
    raise exception 'PROFILE_NOT_FOUND: el perfil no existe en tu comunidad.';
  end if;
  if v_target.role <> 'member' then
    raise exception 'CANNOT_SANCTION_STAFF: no se puede sancionar a un miembro del staff desde acá.';
  end if;

  v_expires := case when p_days is null then null else now() + make_interval(days => p_days) end;

  insert into public.account_restrictions (tenant_id, profile_id, scope, reason, expires_at, applied_by)
  values (v_tenant, p_profile_id, p_scope, btrim(p_reason), v_expires, v_uid);

  -- Historial en account_sanctions (con scope).
  insert into public.account_sanctions (tenant_id, profile_id, actor_id, kind, reason, expires_at, scope)
  values (v_tenant, p_profile_id, v_uid, 'suspend', btrim(p_reason), v_expires, p_scope);
end;
$$;

comment on function public.admin_restrict_user(uuid, text, int, text) is
  'Restringe por scope (§42) a un member del MISMO tenant (moderator+, rol contra el JWT). 1-365 días o null = indefinida. Registra en account_restrictions + account_sanctions.';

revoke execute on function public.admin_restrict_user(uuid, text, int, text) from public, anon;
grant execute on function public.admin_restrict_user(uuid, text, int, text) to authenticated, service_role;

-- RPC admin: levantar una restricción.
create or replace function public.admin_lift_restriction(
  p_profile_id uuid,
  p_scope      text
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
begin
  if v_uid is null or v_tenant is null then
    raise exception 'AUTH_REQUIRED: necesitás una cuenta.';
  end if;
  if not app.is_staff() then
    raise exception 'FORBIDDEN: necesitás permisos de moderación.';
  end if;

  update public.account_restrictions
     set lifted_at = now(), lifted_by = v_uid
   where profile_id = p_profile_id
     and tenant_id = v_tenant
     and scope = p_scope
     and lifted_at is null;

  insert into public.account_sanctions (tenant_id, profile_id, actor_id, kind, reason, scope)
  values (v_tenant, p_profile_id, v_uid, 'reactivate', 'levantar restricción ' || p_scope, p_scope);
end;
$$;

comment on function public.admin_lift_restriction(uuid, text) is
  'Levanta las restricciones vigentes de un scope para un perfil del MISMO tenant (moderator+). Registra kind=reactivate con scope en account_sanctions.';

revoke execute on function public.admin_lift_restriction(uuid, text) from public, anon;
grant execute on function public.admin_lift_restriction(uuid, text) to authenticated, service_role;
