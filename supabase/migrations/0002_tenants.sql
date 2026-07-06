-- =============================================================================
-- 0002_tenants.sql — Comunidad Latina
-- tenants + tenant_domains: identidad, routing por Host y branding white-label.
-- `tenants` NO lleva tenant_id (la fila ES el tenant) → whitelisted en el
-- enumerador RLS, pero con RLS FORCE + 4 policies igual que todas.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- tenants
-- ---------------------------------------------------------------------------
create table public.tenants (
  id            uuid primary key default app.uuid_v7(),
  slug          text not null unique,
  name          text not null,
  brand_hex     text not null default '#1A5EDB' check (brand_hex ~* '^#[0-9a-f]{6}$'),
  logo_url      text,
  locale        text not null default 'es',
  currency      text not null default 'USD',
  country_focus text,
  city_seed     text,
  status        text not null default 'active' check (status in ('active', 'paused')),
  modules       jsonb not null default '{}'::jsonb,
  theme         jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.tenants is
  'Un tenant = una comunidad (dominicanos.com, comunidadlatina.com). Global por diseño: sin tenant_id. Lectura pública de tenants activos (branding pre-login); escritura solo global_admin.';
comment on column public.tenants.brand_hex is
  'ÚNICO input de marca del tenant (§4.2): pasa por el pipeline de tokens; jamás se usa crudo como fondo masivo.';
comment on column public.tenants.modules is
  'Flags de módulos on/off por tenant: {"properties":true,"businesses":true,"events":true,...}.';
comment on column public.tenants.theme is
  'Tokens derivados del pipeline de marca (escala tonal + contraste WCAG). Lo escribe el pipeline, no un humano.';

create trigger tenants_set_updated_at
before update on public.tenants
for each row execute function extensions.moddatetime(updated_at);

alter table public.tenants enable row level security;
alter table public.tenants force row level security;

create policy tenants_select on public.tenants
for select to anon, authenticated
using (
  status = 'active'
  or (select app.is_global_admin())
);

create policy tenants_insert on public.tenants
for insert to authenticated
with check ((select app.is_global_admin()));

create policy tenants_update on public.tenants
for update to authenticated
using ((select app.is_global_admin()))
with check ((select app.is_global_admin()));

create policy tenants_delete on public.tenants
for delete to authenticated
using ((select app.is_global_admin()));

-- ---------------------------------------------------------------------------
-- tenant_domains — resolución Host → tenant (1:N: apex, www, alias)
-- ---------------------------------------------------------------------------
create table public.tenant_domains (
  id         uuid primary key default app.uuid_v7(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  domain     text not null unique,
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);

comment on table public.tenant_domains is
  'Hostnames de cada tenant (dominicanos.com, www.dominicanos.com). Lectura pública: el middleware resuelve Host→tenant pre-login. Escritura solo global_admin.';

create index tenant_domains_tenant_idx on public.tenant_domains (tenant_id);

alter table public.tenant_domains enable row level security;
alter table public.tenant_domains force row level security;

-- SELECT público de solo-lectura: mapping dominio→tenant es información pública
-- (necesaria antes de cualquier sesión). Las policies de escritura son estrictas.
create policy tenant_domains_select on public.tenant_domains
for select to anon, authenticated
using (true);

create policy tenant_domains_insert on public.tenant_domains
for insert to authenticated
with check ((select app.is_global_admin()));

create policy tenant_domains_update on public.tenant_domains
for update to authenticated
using ((select app.is_global_admin()))
with check ((select app.is_global_admin()));

create policy tenant_domains_delete on public.tenant_domains
for delete to authenticated
using ((select app.is_global_admin()));
