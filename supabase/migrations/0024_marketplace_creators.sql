-- =============================================================================
-- 0024_marketplace_creators.sql — Comunidad Latina
-- Feedback del cliente (2026-07-19):
--   * Marketplace — la tienda de productos de los negocios. Un producto es un
--     listing kind='product' (reusa moderación, fotos, RLS, boosts, FTS);
--     attrs.store_listing_id apunta al negocio dueño (patrón attrs.bedrooms).
--   * Creator Marketplace — clasificados de trabajos para creadores:
--     aviso = listing kind='creator_gig' (presupuesto en price_amount);
--     aplicaciones, contrato con código de trabajo, garantía (escrow) con
--     20% de fee de plataforma ($1000 → $800 creador + $200 plataforma) y
--     reviews mutuas SOLO entre las partes del contrato.
--   * El estado del contrato lo escribe SOLO el server (patrón boosts 0016):
--     con Stripe configurado, Checkout+Connect; sin Stripe, modo demo
--     etiquetado — jamás un cliente activa su propia plata.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- listings.kind: + 'product' (Marketplace) y 'creator_gig' (Creator Marketplace)
-- ---------------------------------------------------------------------------
do $$
declare
  v_name text;
begin
  select conname into v_name
    from pg_constraint
   where conrelid = 'public.listings'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) like '%kind = ANY%';
  if v_name is not null then
    execute format('alter table public.listings drop constraint %I', v_name);
  end if;
end;
$$;

alter table public.listings
  add constraint listings_kind_check
  check (kind in ('property', 'business', 'professional', 'event', 'job', 'product', 'creator_gig'));

comment on column public.listings.kind is
  'Verticales: property/business/professional/event/job + product (Marketplace: attrs.store_listing_id = negocio dueño) + creator_gig (Creator Marketplace: price_amount = presupuesto ofrecido, attrs.category/deliverables/deadline).';

-- ---------------------------------------------------------------------------
-- creator_profiles — portfolio público de un creador de contenido
-- ---------------------------------------------------------------------------
create table public.creator_profiles (
  profile_id       uuid primary key references public.profiles(id) on delete cascade,
  tenant_id        uuid not null references public.tenants(id),
  headline         text not null,
  bio              text,
  skills           text[] not null default '{}'::text[],
  portfolio_photos text[] not null default '{}'::text[],
  rate_hint        text,
  available        boolean not null default true,
  completed_jobs   int not null default 0 check (completed_jobs >= 0),
  rating_avg       numeric(3,2) check (rating_avg is null or (rating_avg >= 1 and rating_avg <= 5)),
  rating_count     int not null default 0 check (rating_count >= 0),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.creator_profiles is
  'Portfolio de creador (Creator Marketplace). Opt-in del usuario: crearlo te lista en "Buscar creadores". completed_jobs/rating_* los mantienen triggers de contratos/reviews (jamás el cliente — patrón protect_post_counters). La verificación (teléfono/identidad) sale de trust_scores/verificaciones existentes, no de acá.';
comment on column public.creator_profiles.rate_hint is
  'Texto humano orientativo ("Desde $150 por reel"). El precio real se pacta en el contrato.';

create index creator_profiles_tenant_idx
  on public.creator_profiles (tenant_id, available, rating_avg desc nulls last);

create trigger creator_profiles_set_updated_at
before update on public.creator_profiles
for each row execute function extensions.moddatetime(updated_at);

alter table public.creator_profiles enable row level security;
alter table public.creator_profiles force row level security;

-- Directorio público (contenido publicado por diseño, como listings published).
create policy creator_profiles_select on public.creator_profiles
for select to anon, authenticated
using (true);

create policy creator_profiles_insert on public.creator_profiles
for insert to authenticated
with check (
  tenant_id = (select app.current_tenant_id())
  and profile_id = (select auth.uid())
  and completed_jobs = 0
  and rating_avg is null
  and rating_count = 0
);

create policy creator_profiles_update on public.creator_profiles
for update to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and (profile_id = (select auth.uid()) or (select app.is_staff()))
)
with check (
  tenant_id = (select app.current_tenant_id())
  and (profile_id = (select auth.uid()) or (select app.is_staff()))
);

create policy creator_profiles_delete on public.creator_profiles
for delete to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and (
    profile_id = (select auth.uid())
    or (select app.current_user_role()) in ('domain_admin', 'global_admin')
  )
);

-- Counters de reputación inmunes a manipulación (patrón protect_post_counters).
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
  return new;
end;
$$;

comment on function app.protect_creator_reputation() is
  'Bloquea que un creador se infle completed_jobs/rating_* editando su perfil.';

create trigger creator_profiles_protect_reputation
before update on public.creator_profiles
for each row execute function app.protect_creator_reputation();

create trigger creator_profiles_enforce_account_active
before insert on public.creator_profiles
for each row execute function app.enforce_account_active();

-- ---------------------------------------------------------------------------
-- gig_applications — un creador aplica a un aviso (kind='creator_gig')
-- ---------------------------------------------------------------------------
create table public.gig_applications (
  id                    uuid primary key default app.uuid_v7(),
  tenant_id             uuid not null references public.tenants(id),
  gig_id                uuid not null references public.listings(id) on delete cascade,
  creator_id            uuid not null references public.profiles(id) on delete cascade,
  message               text not null,
  proposed_amount_cents int check (proposed_amount_cents is null or proposed_amount_cents > 0),
  status                text not null default 'submitted'
                          check (status in ('submitted', 'accepted', 'declined', 'withdrawn')),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint gig_applications_one_per_gig unique (gig_id, creator_id)
);

comment on table public.gig_applications is
  'Aplicación de un creador a un aviso del Creator Marketplace. accepted la marca el dueño del aviso (paso previo al contrato); withdrawn el creador. El contrato formal vive en gig_contracts.';

create index gig_applications_gig_idx on public.gig_applications (tenant_id, gig_id, status, created_at desc);
create index gig_applications_creator_idx on public.gig_applications (tenant_id, creator_id, created_at desc);

create trigger gig_applications_set_updated_at
before update on public.gig_applications
for each row execute function extensions.moddatetime(updated_at);

alter table public.gig_applications enable row level security;
alter table public.gig_applications force row level security;

-- Ven la aplicación SOLO las partes (creador y dueño del aviso) + staff.
create policy gig_applications_select on public.gig_applications
for select to authenticated
using (
  (
    tenant_id = (select app.current_tenant_id())
    and (
      creator_id = (select auth.uid())
      or exists (
        select 1 from public.listings l
        where l.id = gig_applications.gig_id
          and l.tenant_id = gig_applications.tenant_id
          and l.created_by = (select auth.uid())
      )
      or (select app.is_staff())
    )
  )
  or (select app.is_global_admin())
);

-- Aplica el creador en primera persona, a un aviso published de creator_gig
-- que no sea suyo, sin bloqueo entre las partes.
create policy gig_applications_insert on public.gig_applications
for insert to authenticated
with check (
  tenant_id = (select app.current_tenant_id())
  and creator_id = (select auth.uid())
  and status = 'submitted'
  and exists (
    select 1 from public.listings l
    where l.id = gig_applications.gig_id
      and l.tenant_id = gig_applications.tenant_id
      and l.kind = 'creator_gig'
      and l.status = 'published'
      and (l.created_by is null or l.created_by <> (select auth.uid()))
      and (l.created_by is null or not app.pair_blocked((select auth.uid()), l.created_by))
  )
);

-- El creador retira la suya; el dueño del aviso acepta/rechaza las recibidas.
create policy gig_applications_update on public.gig_applications
for update to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and (
    creator_id = (select auth.uid())
    or exists (
      select 1 from public.listings l
      where l.id = gig_applications.gig_id
        and l.tenant_id = gig_applications.tenant_id
        and l.created_by = (select auth.uid())
    )
    or (select app.is_staff())
  )
)
with check (
  tenant_id = (select app.current_tenant_id())
  and (
    (creator_id = (select auth.uid()) and status in ('submitted', 'withdrawn'))
    or (
      exists (
        select 1 from public.listings l
        where l.id = gig_applications.gig_id
          and l.tenant_id = gig_applications.tenant_id
          and l.created_by = (select auth.uid())
      )
      and status in ('accepted', 'declined')
    )
    or (select app.is_staff())
  )
);

create policy gig_applications_delete on public.gig_applications
for delete to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and (
    creator_id = (select auth.uid())
    or (select app.current_user_role()) in ('domain_admin', 'global_admin')
  )
);

create trigger gig_applications_enforce_account_active
before insert on public.gig_applications
for each row execute function app.enforce_account_active();

-- ---------------------------------------------------------------------------
-- gig_contracts — contrato con código de trabajo + garantía (escrow)
-- ---------------------------------------------------------------------------
create sequence if not exists app.gig_contract_code_seq;

create or replace function app.next_gig_code()
returns text
language sql
security definer
set search_path = ''
as $$
  select 'CL-' || to_char(now(), 'YYYY') || '-'
         || lpad(nextval('app.gig_contract_code_seq')::text, 4, '0');
$$;

comment on function app.next_gig_code() is
  'Código de trabajo legible (CL-2026-0001) — feedback cliente 2026-07-19: "cada trabajo tiene que crear un código o número de trabajo".';

create table public.gig_contracts (
  id                         uuid primary key default app.uuid_v7(),
  tenant_id                  uuid not null references public.tenants(id),
  code                       text not null unique default app.next_gig_code(),
  gig_id                     uuid references public.listings(id) on delete set null,
  application_id             uuid references public.gig_applications(id) on delete set null,
  client_id                  uuid not null references public.profiles(id),
  creator_id                 uuid not null references public.profiles(id),
  title                      text not null,
  scope                      text not null,
  delivery_days              int not null check (delivery_days > 0),
  amount_cents               int not null check (amount_cents > 0),
  currency                   text not null default 'usd',
  fee_pct                    int not null default 20 check (fee_pct between 0 and 50),
  platform_fee_cents         int generated always as ((amount_cents * fee_pct) / 100) stored,
  creator_net_cents          int generated always as (amount_cents - ((amount_cents * fee_pct) / 100)) stored,
  status                     text not null default 'proposed'
                               check (status in ('proposed', 'funded', 'delivered', 'released', 'canceled', 'disputed')),
  payment_mode               text not null default 'demo' check (payment_mode in ('demo', 'stripe')),
  stripe_checkout_session_id text,
  stripe_payment_intent_id   text,
  stripe_transfer_id         text,
  funded_at                  timestamptz,
  delivered_at               timestamptz,
  released_at                timestamptz,
  canceled_at                timestamptz,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  constraint gig_contracts_parties_distinct check (client_id <> creator_id)
);

comment on table public.gig_contracts is
  'Contrato del Creator Marketplace (feedback cliente 2026-07-19). Ciclo: proposed → funded (plata en garantía) → delivered (creador entrega) → released (se libera: creador cobra amount−fee, plataforma retiene fee_pct=20%). ESCRITURA EXCLUSIVA service_role (server actions verifican parte y transición; con Stripe: Checkout + Connect transfer; sin Stripe: payment_mode=demo etiquetado en UI). Ejemplo del cliente: $1000 → $800 creador + $200 plataforma.';
comment on column public.gig_contracts.code is
  'Código de trabajo visible para ambas partes (CL-2026-0001).';
comment on column public.gig_contracts.payment_mode is
  'demo = simulación etiquetada (sin Stripe configurado, services.ts); stripe = plata real vía Checkout/Connect.';

create index gig_contracts_client_idx on public.gig_contracts (tenant_id, client_id, created_at desc);
create index gig_contracts_creator_idx on public.gig_contracts (tenant_id, creator_id, created_at desc);
create index gig_contracts_gig_idx on public.gig_contracts (gig_id);
create unique index gig_contracts_checkout_session_uniq
  on public.gig_contracts (stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;

create trigger gig_contracts_set_updated_at
before update on public.gig_contracts
for each row execute function extensions.moddatetime(updated_at);

alter table public.gig_contracts enable row level security;
alter table public.gig_contracts force row level security;

-- Contrato = privado de las partes (+ staff del tenant, + global admin).
create policy gig_contracts_select on public.gig_contracts
for select to authenticated
using (
  (
    tenant_id = (select app.current_tenant_id())
    and (
      client_id = (select auth.uid())
      or creator_id = (select auth.uid())
      or (select app.is_staff())
    )
  )
  or (select app.is_global_admin())
);

-- Escritura EXCLUSIVA de service_role (server actions gateadas + webhook).
create policy gig_contracts_insert on public.gig_contracts
for insert to authenticated
with check (false);

create policy gig_contracts_update on public.gig_contracts
for update to authenticated
using (false)
with check (false);

create policy gig_contracts_delete on public.gig_contracts
for delete to authenticated
using (false);

-- Contrato released → el creador suma un trabajo completado (SECURITY DEFINER,
-- pasa el protect de reputación por trigger-depth).
create or replace function app.gig_contracts_bump_completed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'released' and old.status is distinct from 'released' then
    update public.creator_profiles
       set completed_jobs = completed_jobs + 1
     where profile_id = new.creator_id;
  end if;
  return new;
end;
$$;

comment on function app.gig_contracts_bump_completed() is
  'Mantiene creator_profiles.completed_jobs al liberar un contrato.';

create trigger gig_contracts_bump_completed
after update on public.gig_contracts
for each row execute function app.gig_contracts_bump_completed();

-- ---------------------------------------------------------------------------
-- gig_reviews — reviews mutuas, SOLO entre las partes de un contrato liberado
-- ---------------------------------------------------------------------------
create table public.gig_reviews (
  id          uuid primary key default app.uuid_v7(),
  tenant_id   uuid not null references public.tenants(id),
  contract_id uuid not null references public.gig_contracts(id) on delete cascade,
  reviewer_id uuid not null references public.profiles(id) on delete cascade,
  ratee_id    uuid not null references public.profiles(id) on delete cascade,
  rating      int not null check (rating between 1 and 5),
  body        text,
  created_at  timestamptz not null default now(),
  constraint gig_reviews_one_per_side unique (contract_id, reviewer_id),
  constraint gig_reviews_not_self check (reviewer_id <> ratee_id)
);

comment on table public.gig_reviews is
  'Review mutua de un contrato (feedback cliente 2026-07-19: "nadie más puede poner reviews, solo las personas envueltas en el contrato"). La policy de INSERT exige contrato released y que reviewer/ratee sean exactamente las dos partes. Inmutables (update/delete en false; moderación via service_role).';

create index gig_reviews_ratee_idx on public.gig_reviews (tenant_id, ratee_id, created_at desc);
create index gig_reviews_contract_idx on public.gig_reviews (contract_id);

alter table public.gig_reviews enable row level security;
alter table public.gig_reviews force row level security;

-- Reputación pública (como las estrellas de cualquier marketplace).
create policy gig_reviews_select on public.gig_reviews
for select to anon, authenticated
using (true);

create policy gig_reviews_insert on public.gig_reviews
for insert to authenticated
with check (
  tenant_id = (select app.current_tenant_id())
  and reviewer_id = (select auth.uid())
  and exists (
    select 1 from public.gig_contracts c
    where c.id = gig_reviews.contract_id
      and c.tenant_id = gig_reviews.tenant_id
      and c.status = 'released'
      and (
        (c.client_id = (select auth.uid()) and gig_reviews.ratee_id = c.creator_id)
        or (c.creator_id = (select auth.uid()) and gig_reviews.ratee_id = c.client_id)
      )
  )
);

create policy gig_reviews_update on public.gig_reviews
for update to authenticated
using (false)
with check (false);

create policy gig_reviews_delete on public.gig_reviews
for delete to authenticated
using (false);

create trigger gig_reviews_enforce_account_active
before insert on public.gig_reviews
for each row execute function app.enforce_account_active();

-- Review nueva → refrescar promedio del calificado (si tiene perfil de creador;
-- si el calificado es el negocio, no hay agregado que mantener).
create or replace function app.gig_reviews_refresh_rating()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.creator_profiles cp
     set rating_avg = sub.avg_rating,
         rating_count = sub.n
    from (
      select round(avg(r.rating)::numeric, 2) as avg_rating, count(*)::int as n
        from public.gig_reviews r
       where r.ratee_id = new.ratee_id
    ) as sub
   where cp.profile_id = new.ratee_id;
  return new;
end;
$$;

comment on function app.gig_reviews_refresh_rating() is
  'Mantiene creator_profiles.rating_avg/rating_count tras cada review.';

create trigger gig_reviews_refresh_rating
after insert on public.gig_reviews
for each row execute function app.gig_reviews_refresh_rating();
