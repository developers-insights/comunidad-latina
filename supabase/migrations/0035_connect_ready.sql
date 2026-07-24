-- =============================================================================
-- 0035_connect_ready.sql — Comunidad Latina
-- Campos de CUENTA de Stripe Connect (§29-41), VACÍO-PERO-LISTO, SIN dinero.
-- El LEDGER (transactions/transfers/payouts/refunds/disputes de §37) es lógica
-- de dinero → NO se crea ahora (llega con Connect, tras Hito 1 — decisión Manuel).
--   * connected_accounts — estado de la cuenta Connect (§38). Service/webhook.
--   * payment_accounts   — método de payout, SOLO estado (§41: sin PAN/IBAN).
-- Ambas VACÍAS en demo. La regla §132 ("no habilitar solo por tener
-- stripe_account_id") se implementa en el webhook mirando charges_enabled/
-- payouts_enabled/requirements — no la mera existencia del id.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- connected_accounts — una cuenta Connect por creador o negocio.
-- ---------------------------------------------------------------------------
create table public.connected_accounts (
  id                      uuid primary key default app.uuid_v7(),
  tenant_id               uuid not null references public.tenants(id),
  owner_type              text not null check (owner_type in ('creator', 'business')),
  owner_ref               uuid not null,  -- creator→profiles.id (creator_profiles.profile_id); business→business_accounts.id. Polimórfico, sin FK física.
  stripe_account_id       text,
  details_submitted       boolean not null default false,
  charges_enabled         boolean not null default false,
  payouts_enabled         boolean not null default false,
  requirements_due        jsonb not null default '[]'::jsonb,
  requirements_past_due   jsonb not null default '[]'::jsonb,
  disabled_reason         text,
  capabilities            jsonb not null default '{}'::jsonb,
  verification_status     text not null default 'pending'
                            check (verification_status in ('pending', 'verified', 'restricted', 'disabled')),
  verification_updated_at timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint connected_accounts_owner_uniq unique (owner_type, owner_ref)
);

comment on table public.connected_accounts is
  'Estado de la cuenta Stripe Connect de un creador/negocio (§38), Connect-ready y VACÍA en demo. Service/webhook-escritura. La insignia "pagos activados" se deriva de charges_enabled (§132: no del mero stripe_account_id). owner_ref es polimórfico, sin FK física.';

create unique index connected_accounts_stripe_uniq
  on public.connected_accounts (stripe_account_id) where stripe_account_id is not null;
create index connected_accounts_owner_idx on public.connected_accounts (tenant_id, owner_type, owner_ref);

create trigger connected_accounts_set_updated_at
before update on public.connected_accounts
for each row execute function extensions.moddatetime(updated_at);

alter table public.connected_accounts enable row level security;
alter table public.connected_accounts force row level security;

create policy connected_accounts_select on public.connected_accounts
for select to authenticated
using (
  (
    tenant_id = (select app.current_tenant_id())
    and (
      (owner_type = 'creator' and owner_ref = (select auth.uid()))
      or (owner_type = 'business' and app.business_role(owner_ref, (select auth.uid())) is not null)
      or (select app.is_staff())
    )
  )
  or (select app.is_global_admin())
);

create policy connected_accounts_insert on public.connected_accounts
for insert to authenticated
with check (false);

create policy connected_accounts_update on public.connected_accounts
for update to authenticated
using (false)
with check (false);

create policy connected_accounts_delete on public.connected_accounts
for delete to authenticated
using (false);

-- ---------------------------------------------------------------------------
-- payment_accounts — método de payout, SOLO estado (§41). Sin PAN/IBAN.
-- ---------------------------------------------------------------------------
create table public.payment_accounts (
  id                   uuid primary key default app.uuid_v7(),
  tenant_id            uuid not null references public.tenants(id),
  connected_account_id uuid not null references public.connected_accounts(id) on delete cascade,
  kind                 text not null check (kind in ('bank', 'card')),
  last4                text,
  brand                text,
  is_default           boolean not null default false,
  status               text not null default 'pending' check (status in ('pending', 'active', 'errored')),
  created_at           timestamptz not null default now()
);

comment on table public.payment_accounts is
  'Método de payout de una cuenta Connect, SOLO estado (§41: CL solo guarda estado/ID/requisitos). SIN PAN/IBAN (Stripe los tiene). Service/webhook-escritura. VACÍA en demo.';

create index payment_accounts_account_idx on public.payment_accounts (tenant_id, connected_account_id);

alter table public.payment_accounts enable row level security;
alter table public.payment_accounts force row level security;

create policy payment_accounts_select on public.payment_accounts
for select to authenticated
using (
  (
    tenant_id = (select app.current_tenant_id())
    and (
      (select app.is_staff())
      or exists (
        select 1 from public.connected_accounts ca
        where ca.id = payment_accounts.connected_account_id
          and ca.tenant_id = payment_accounts.tenant_id
          and (
            (ca.owner_type = 'creator' and ca.owner_ref = (select auth.uid()))
            or (ca.owner_type = 'business' and app.business_role(ca.owner_ref, (select auth.uid())) is not null)
          )
      )
    )
  )
  or (select app.is_global_admin())
);

create policy payment_accounts_insert on public.payment_accounts
for insert to authenticated
with check (false);

create policy payment_accounts_update on public.payment_accounts
for update to authenticated
using (false)
with check (false);

create policy payment_accounts_delete on public.payment_accounts
for delete to authenticated
using (false);
