-- =============================================================================
-- 0008_monetization.sql — Comunidad Latina
-- business_accounts (presencia verificada §7 — ingreso NO atado al listado) +
-- payment_events (idempotencia de webhooks Stripe).
-- El estado de facturación (plan, verified_presence, ids de Stripe) lo escribe
-- SOLO el webhook server-side: un cliente jamás se auto-asigna un plan.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- business_accounts
-- ---------------------------------------------------------------------------
create table public.business_accounts (
  id                     uuid primary key default app.uuid_v7(),
  tenant_id              uuid not null references public.tenants(id),
  owner_id               uuid not null references public.profiles(id),
  listing_id             uuid references public.listings(id) on delete set null,
  name                   text not null,
  category               text,
  plan                   text not null default 'none' check (plan in ('none', 'basico', 'destacado', 'pro')),
  plan_status            text not null default 'inactive'
                           check (plan_status in ('inactive', 'active', 'past_due', 'canceled')),
  stripe_customer_id     text,
  stripe_subscription_id text,
  verified_presence      boolean not null default false,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

comment on table public.business_accounts is
  'Cuenta de negocio (North Star: cuentas pagas por tenant). El plan es "presencia verificada": se paga aunque no haya listado activo (§6.3 anti churn estructural). Billing state = solo webhooks Stripe via service_role.';
comment on column public.business_accounts.verified_presence is
  'Flag de presencia verificada activa. Solo service_role lo escribe (trigger de guarda).';

create index business_accounts_tenant_owner_idx on public.business_accounts (tenant_id, owner_id);
create index business_accounts_tenant_plan_idx on public.business_accounts (tenant_id, plan_status, plan);
create index business_accounts_listing_idx on public.business_accounts (listing_id);
create unique index business_accounts_stripe_customer_uniq
  on public.business_accounts (stripe_customer_id) where stripe_customer_id is not null;

create trigger business_accounts_set_updated_at
before update on public.business_accounts
for each row execute function extensions.moddatetime(updated_at);

-- Guarda de columnas de billing: solo service_role las muta.
create or replace function app.protect_business_billing()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.jwt() ->> 'role', 'service_role') = 'service_role' then
    return new;
  end if;

  if new.plan is distinct from old.plan
     or new.plan_status is distinct from old.plan_status
     or new.verified_presence is distinct from old.verified_presence
     or new.stripe_customer_id is distinct from old.stripe_customer_id
     or new.stripe_subscription_id is distinct from old.stripe_subscription_id
     or new.tenant_id is distinct from old.tenant_id
     or new.owner_id is distinct from old.owner_id then
    raise exception 'PROTECTED_COLUMNS: plan/billing de business_accounts solo se modifican via service_role (webhook Stripe)';
  end if;

  return new;
end;
$$;

comment on function app.protect_business_billing() is
  'Impide que el dueño o un admin de dominio se auto-asignen plan/verified_presence: el estado de pago nace del webhook.';

create trigger business_accounts_protect_billing
before update on public.business_accounts
for each row execute function app.protect_business_billing();

alter table public.business_accounts enable row level security;
alter table public.business_accounts force row level security;

-- Owner + admins del tenant (billing es privado; la cara pública es el listing).
create policy business_accounts_select on public.business_accounts
for select to authenticated
using (
  (
    tenant_id = (select app.current_tenant_id())
    and (
      owner_id = (select auth.uid())
      or (select app.current_user_role()) in ('domain_admin', 'global_admin')
    )
  )
  or (select app.is_global_admin())
);

-- Alta: el dueño, en su tenant, SIEMPRE sin plan ni flags (los pone Stripe).
create policy business_accounts_insert on public.business_accounts
for insert to authenticated
with check (
  tenant_id = (select app.current_tenant_id())
  and owner_id = (select auth.uid())
  and plan = 'none'
  and plan_status = 'inactive'
  and verified_presence = false
  and stripe_customer_id is null
  and stripe_subscription_id is null
  and (
    listing_id is null
    or exists (
      select 1 from public.listings l
      where l.id = business_accounts.listing_id
        and l.tenant_id = business_accounts.tenant_id
    )
  )
);

-- Editar datos del negocio: owner o domain_admin (billing guardado por trigger).
create policy business_accounts_update on public.business_accounts
for update to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and (
    owner_id = (select auth.uid())
    or (select app.current_user_role()) in ('domain_admin', 'global_admin')
  )
)
with check (
  tenant_id = (select app.current_tenant_id())
  and (
    owner_id = (select auth.uid())
    or (select app.current_user_role()) in ('domain_admin', 'global_admin')
  )
);

create policy business_accounts_delete on public.business_accounts
for delete to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and (
    owner_id = (select auth.uid())
    or (select app.current_user_role()) in ('domain_admin', 'global_admin')
  )
);

-- ---------------------------------------------------------------------------
-- payment_events — inbox de webhooks (idempotencia por event_id)
-- ---------------------------------------------------------------------------
create table public.payment_events (
  id          uuid primary key default app.uuid_v7(),
  provider    text not null default 'stripe',
  event_id    text not null unique,
  event_type  text not null,
  payload     jsonb not null,
  tenant_id   uuid references public.tenants(id),
  processed   boolean not null default false,
  error       text,
  received_at timestamptz not null default now()
);

comment on table public.payment_events is
  'Inbox de eventos de pago (webhooks Stripe). event_id UNIQUE = idempotencia (un retry no procesa dos veces). tenant_id se deriva del metadata del objeto Stripe, NUNCA de input de cliente. Solo service_role toca esta tabla: policies en false para anon/authenticated. RETENCIÓN §5.4: payload trae PII de Stripe (billing_details) — pg_cron (0013, purge-processed-payment-events) borra procesados a los 90 días; la fuente de verdad histórica es el Dashboard de Stripe, no esta tabla.';

create index payment_events_pending_idx on public.payment_events (received_at) where processed = false;
create index payment_events_tenant_idx on public.payment_events (tenant_id, received_at desc);

alter table public.payment_events enable row level security;
alter table public.payment_events force row level security;

create policy payment_events_select on public.payment_events
for select to authenticated
using (false);

create policy payment_events_insert on public.payment_events
for insert to authenticated
with check (false);

create policy payment_events_update on public.payment_events
for update to authenticated
using (false)
with check (false);

create policy payment_events_delete on public.payment_events
for delete to authenticated
using (false);
