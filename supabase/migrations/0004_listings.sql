-- =============================================================================
-- 0004_listings.sql — Comunidad Latina
-- listings (5 verticales en una tabla) + listing_private_details.
-- MINIMIZACIÓN §5.4:
--   * Geo SIEMPRE aproximada en la tabla pública: area_label + geo_zone
--     (geohash truncado a ≤5 chars ≈ celda de ~4.9 km — precisión > 2 km).
--     PROHIBIDO point exacto o dirección en columnas públicas.
--   * La dirección exacta (opcional) vive en listing_private_details,
--     RLS solo-dueño, y se revela tras contacto vía RPC — sin persistir
--     historial de "quién vio qué dirección".
-- =============================================================================

create table public.listings (
  id                uuid primary key default app.uuid_v7(),
  tenant_id         uuid not null references public.tenants(id),
  kind              text not null check (kind in ('property', 'business', 'professional', 'event', 'job')),
  title             text not null,
  description       text,
  price_amount      numeric(12,2) check (price_amount is null or price_amount >= 0),
  price_currency    text not null default 'USD',
  price_period      text check (price_period is null or price_period in ('hour', 'day', 'week', 'month', 'year', 'one_time')),
  attrs             jsonb not null default '{}'::jsonb,
  area_label        text,
  geo_zone          text check (geo_zone is null or char_length(geo_zone) between 1 and 5),
  photos            text[] not null default '{}'::text[],
  status            text not null default 'draft'
                      check (status in ('draft', 'pending_review', 'published', 'paused', 'removed')),
  created_by        uuid references public.profiles(id),
  publisher_name    text,
  publisher_kind    text,
  source            text not null default 'user' check (source in ('user', 'seed', 'api')),
  contact_protected boolean not null default true,
  published_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  search            tsvector generated always as (
                      setweight(to_tsvector('spanish', coalesce(title, '')), 'A') ||
                      setweight(to_tsvector('spanish', coalesce(description, '')), 'B') ||
                      setweight(to_tsvector('spanish', coalesce(area_label, '')), 'C')
                    ) stored
);

comment on table public.listings is
  'Avisos de los 5 verticales (property/business/professional/event/job). Publicado = contenido público (SEO): el SELECT público filtra status=published y el tenant lo aplica la app por query.';
comment on column public.listings.geo_zone is
  'Geohash TRUNCADO a ≤5 caracteres (~4.9 km): §5.4 geolocalización siempre aproximada. Nunca guardar point exacto acá.';
comment on column public.listings.area_label is
  'Etiqueta humana de zona ("Jackson Heights, Queens"). Nunca calle+número.';
comment on column public.listings.publisher_name is
  'Para seed LEGAL (opt-in/API oficial §9.1) sin cuenta: nombre visible del publicador real. Con cuenta, usar created_by.';
comment on column public.listings.contact_protected is
  'true = el contacto pasa por request_contact() dentro de la app (§9.2): nunca se expone teléfono/dirección en el aviso.';
comment on column public.listings.search is
  'FTS config spanish explícita (inmutable). SIN unaccent en la columna generada: unaccent() no es immutable. Normalizar acentos en app/queries si hace falta.';

create index listings_tenant_created_idx on public.listings (tenant_id, created_at desc, id desc);
create index listings_tenant_kind_status_idx on public.listings (tenant_id, kind, status, created_at desc, id desc);
create index listings_public_feed_idx on public.listings (tenant_id, kind, published_at desc, id desc) where status = 'published';
create index listings_tenant_owner_idx on public.listings (tenant_id, created_by);
create index listings_search_idx on public.listings using gin (search);
create index listings_title_trgm_idx on public.listings using gin (title extensions.gin_trgm_ops);

create trigger listings_set_updated_at
before update on public.listings
for each row execute function extensions.moddatetime(updated_at);

alter table public.listings enable row level security;
alter table public.listings force row level security;

-- Público: SOLO published (anon+auth, cross-tenant por diseño SEO — la app
-- filtra tenant por query). Privado: dueño ve sus borradores; staff del tenant
-- ve todos los estados de SU tenant; global_admin ve todo.
create policy listings_select on public.listings
for select to anon, authenticated
using (
  status = 'published'
  or (
    tenant_id = (select app.current_tenant_id())
    and (
      created_by = (select auth.uid())
      or (select app.is_staff())
    )
  )
  or (select app.is_global_admin())
);

-- INSERT de usuario: ownership forzado, source user, jamás nace published
-- (publicar pasa por moderación/staff). Seed/API entran por service_role.
create policy listings_insert on public.listings
for insert to authenticated
with check (
  tenant_id = (select app.current_tenant_id())
  and created_by = (select auth.uid())
  and source = 'user'
  and status in ('draft', 'pending_review')
  and publisher_name is null
  and publisher_kind is null
  and published_at is null
);

-- UPDATE: dueño o staff del tenant. El dueño NO puede setear status=published
-- (editar un aviso publicado lo devuelve a draft/pending_review: anti
-- bait-and-switch post-verificación). El WITH CHECK repite el tenant → imposible
-- mudar filas de tenant.
create policy listings_update on public.listings
for update to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and (
    created_by = (select auth.uid())
    or (select app.is_staff())
  )
)
with check (
  tenant_id = (select app.current_tenant_id())
  and (
    (
      created_by = (select auth.uid())
      and source = 'user'
      and status in ('draft', 'pending_review', 'paused', 'removed')
    )
    or (select app.is_staff())
  )
);

create policy listings_delete on public.listings
for delete to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and (
    created_by = (select auth.uid())
    or (select app.current_user_role()) in ('domain_admin', 'global_admin')
  )
);

-- ---------------------------------------------------------------------------
-- listing_private_details — lo que NO es público, separado a propósito
-- ---------------------------------------------------------------------------
create table public.listing_private_details (
  listing_id    uuid primary key references public.listings(id) on delete cascade,
  tenant_id     uuid not null references public.tenants(id),
  exact_address text,
  contact_notes text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.listing_private_details is
  '§5.4: la dirección exacta es OPCIONAL, vive separada de la tabla pública y solo la lee su dueño por RLS. La revelación a un interesado ocurre tras contacto aceptado vía RPC futura (server-side, respuesta efímera) y NO se persiste registro de quién vio qué dirección — ese log está prohibido por diseño.';
comment on column public.listing_private_details.exact_address is
  'Dirección exacta opcional. Jamás exponer en SELECT público ni copiar a listings.';

create trigger listing_private_details_set_updated_at
before update on public.listing_private_details
for each row execute function extensions.moddatetime(updated_at);

alter table public.listing_private_details enable row level security;
alter table public.listing_private_details force row level security;

-- Solo el creador del listing (ni staff, ni global_admin: minimización > conveniencia).
create policy listing_private_details_select on public.listing_private_details
for select to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and exists (
    select 1 from public.listings l
    where l.id = listing_private_details.listing_id
      and l.tenant_id = listing_private_details.tenant_id
      and l.created_by = (select auth.uid())
  )
);

create policy listing_private_details_insert on public.listing_private_details
for insert to authenticated
with check (
  tenant_id = (select app.current_tenant_id())
  and exists (
    select 1 from public.listings l
    where l.id = listing_private_details.listing_id
      and l.tenant_id = listing_private_details.tenant_id
      and l.created_by = (select auth.uid())
  )
);

create policy listing_private_details_update on public.listing_private_details
for update to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and exists (
    select 1 from public.listings l
    where l.id = listing_private_details.listing_id
      and l.tenant_id = listing_private_details.tenant_id
      and l.created_by = (select auth.uid())
  )
)
with check (
  tenant_id = (select app.current_tenant_id())
  and exists (
    select 1 from public.listings l
    where l.id = listing_private_details.listing_id
      and l.tenant_id = listing_private_details.tenant_id
      and l.created_by = (select auth.uid())
  )
);

create policy listing_private_details_delete on public.listing_private_details
for delete to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and exists (
    select 1 from public.listings l
    where l.id = listing_private_details.listing_id
      and l.tenant_id = listing_private_details.tenant_id
      and l.created_by = (select auth.uid())
  )
);
