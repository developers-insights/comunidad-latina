-- =============================================================================
-- 0003_profiles_trust.sql — Comunidad Latina
-- profiles (1:1 auth.users) + profiles_private (sensible, solo-dueño) + trust_scores.
-- MINIMIZACIÓN §5.4 (anti-honeypot, reglas duras):
--   * SIN columna de teléfono (login email/passkey). No agregar phone jamás sin
--     pasar el checklist legal de exposure.
--   * SIN documento/identidad: Stripe Identity procesa FUERA de la DB y solo
--     devuelve identity_verified (flag) + fecha.
--   * area_label = zona aproximada, nunca dirección.
--   * trust_scores.signals = contadores agregados, NUNCA grafo de avales.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table public.profiles (
  id                   uuid primary key references auth.users(id) on delete cascade,
  tenant_id            uuid not null references public.tenants(id),
  display_name         text not null,
  avatar_url           text,
  country_origin       text,
  area_label           text,
  bio                  text,
  role                 text not null default 'member'
                         check (role in ('member', 'moderator', 'domain_admin', 'global_admin')),
  identity_verified    boolean not null default false,
  identity_verified_at timestamptz,
  locale               text not null default 'es',
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

comment on table public.profiles is
  'Perfil público 1:1 con auth.users. Minimización §5.4: sin teléfono, sin documento, sin dirección exacta. El perfil es contenido público (SEO); lo sensible NO vive acá.';
comment on column public.profiles.role is
  'INFORMATIVA (UI). El enforcement real es app_metadata.role del JWT (app.current_user_role()). Cambios de rol: solo service_role (trigger de guarda).';
comment on column public.profiles.identity_verified is
  'Flag booleano. El documento se procesa en Stripe Identity y NUNCA toca esta base (§5.4): sin imagen, sin número, sin nombre legal.';
comment on column public.profiles.area_label is
  'Zona/barrio aproximado elegido por el usuario ("Corona, Queens"). Nunca dirección exacta ni point.';
-- NOTA §5.4: las respuestas del onboarding "Recién Llegado" (needs) NO viven
-- acá — profiles es público (SEO) y using(true). Viven en profiles_private
-- (abajo), RLS solo-dueño: un select anónimo jamás devuelve el dossier de
-- vulnerabilidad de nadie.

create index profiles_tenant_created_idx on public.profiles (tenant_id, created_at desc);

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function extensions.moddatetime(updated_at);

-- Guarda de columnas protegidas: role / identity_verified / tenant_id solo se
-- tocan con service_role (o sin JWT: cron, seed, funciones definer internas).
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

  return new;
end;
$$;

comment on function app.protect_profile_columns() is
  'Impide que un usuario autenticado se auto-asigne rol, flag de verificación o cambio de tenant por UPDATE directo.';

create trigger profiles_protect_columns
before update on public.profiles
for each row execute function app.protect_profile_columns();

alter table public.profiles enable row level security;
alter table public.profiles force row level security;

-- Perfil = contenido público (contrato: perfiles públicos legibles por anon/auth).
create policy profiles_select on public.profiles
for select to anon, authenticated
using (true);

-- El dueño crea su propio perfil, en su propio tenant, sin rol elevado ni flags.
create policy profiles_insert on public.profiles
for insert to authenticated
with check (
  id = (select auth.uid())
  and tenant_id = (select app.current_tenant_id())
  and role = 'member'
  and identity_verified = false
  and identity_verified_at is null
);

-- El dueño edita lo suyo (columnas protegidas guardadas por trigger).
create policy profiles_update on public.profiles
for update to authenticated
using (
  id = (select auth.uid())
  and tenant_id = (select app.current_tenant_id())
)
with check (
  id = (select auth.uid())
  and tenant_id = (select app.current_tenant_id())
);

-- Borrado de cuenta = borrar auth.users via service (cascade). Nunca directo.
create policy profiles_delete on public.profiles
for delete to authenticated
using (false);

-- ---------------------------------------------------------------------------
-- profiles_private — lo sensible del perfil, separado a propósito (§5.4)
-- Patrón idéntico a listing_private_details: RLS FORCE solo-dueño.
-- ---------------------------------------------------------------------------
create table public.profiles_private (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  tenant_id  uuid not null references public.tenants(id),
  needs      jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles_private is
  'Datos sensibles del perfil, separados de public.profiles (que es público por diseño SEO). RLS solo-dueño: ni anon, ni otros miembros, ni staff, ni global_admin leen esto (minimización §5.4 > conveniencia). Sin esta separación, needs sería un dataset de targeting de población vulnerable.';
comment on column public.profiles_private.needs is
  'Respuestas del onboarding "Recién Llegado" (array de claves: itin, vivienda, ayuda legal, ...). SENSIBLE: puede codificar estatus migratorio o necesidad de ayuda. Solo el dueño lo lee/escribe por RLS. PROHIBIDO copiarlo a profiles o exponerlo en vistas públicas.';

create trigger profiles_private_set_updated_at
before update on public.profiles_private
for each row execute function extensions.moddatetime(updated_at);

alter table public.profiles_private enable row level security;
alter table public.profiles_private force row level security;

-- Solo el dueño, en su tenant. Sin rama de staff/global: no se husmea.
create policy profiles_private_select on public.profiles_private
for select to authenticated
using (
  profile_id = (select auth.uid())
  and tenant_id = (select app.current_tenant_id())
);

create policy profiles_private_insert on public.profiles_private
for insert to authenticated
with check (
  profile_id = (select auth.uid())
  and tenant_id = (select app.current_tenant_id())
);

create policy profiles_private_update on public.profiles_private
for update to authenticated
using (
  profile_id = (select auth.uid())
  and tenant_id = (select app.current_tenant_id())
)
with check (
  profile_id = (select auth.uid())
  and tenant_id = (select app.current_tenant_id())
);

-- El dueño puede borrar lo suyo (menos datos retenidos = mejor, §5.4).
create policy profiles_private_delete on public.profiles_private
for delete to authenticated
using (
  profile_id = (select auth.uid())
  and tenant_id = (select app.current_tenant_id())
);

-- ---------------------------------------------------------------------------
-- trust_scores — reputación agregada y explicable, SIN dossier subpoenable
-- ---------------------------------------------------------------------------
create table public.trust_scores (
  profile_id  uuid primary key references public.profiles(id) on delete cascade,
  tenant_id   uuid not null references public.tenants(id),
  score       int not null default 0 check (score between 0 and 100),
  level       text not null default 'nuevo'
                check (level in ('nuevo', 'verificado', 'confiable', 'premium', 'diamante')),
  signals     jsonb not null default '{}'::jsonb,
  computed_at timestamptz not null default now()
);

comment on table public.trust_scores is
  'Trust Score 0-100 + nivel, computado server-side (service_role). DECISIÓN §5.4: las señales son CONTADORES agregados; NO existe (ni debe existir) tabla de aristas usuario→usuario de avales. Un aval incrementa signals.endorsements_count y el vínculo quién-avaló-a-quién NO se persiste: sin grafo reconstruible no hay dossier que entregar ante subpoena.';
comment on column public.trust_scores.signals is
  'Contadores explicables: {"months_in_community":N,"transactions_ok":N,"endorsements_count":N,"reports_upheld":N,...}. Nunca IDs de otros usuarios.';

create index trust_scores_tenant_score_idx on public.trust_scores (tenant_id, score desc);

alter table public.trust_scores enable row level security;
alter table public.trust_scores force row level security;

-- Lectura pública: el score es parte del sistema de confianza visible (§4.3).
create policy trust_scores_select on public.trust_scores
for select to anon, authenticated
using (true);

-- Escritura EXCLUSIVA de service_role (bypassa RLS). Policies en false para
-- cumplir el contrato del enumerador (4 policies nombradas, ninguna implícita).
create policy trust_scores_insert on public.trust_scores
for insert to authenticated
with check (false);

create policy trust_scores_update on public.trust_scores
for update to authenticated
using (false)
with check (false);

create policy trust_scores_delete on public.trust_scores
for delete to authenticated
using (false);
