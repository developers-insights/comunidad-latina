begin;

-- =============================================================================
-- 0166 — El pago protegido mueve plata de verdad.
--
-- Cobro al negocio en la cuenta de la plataforma (Checkout, transfer_group por
-- contrato), fondos retenidos hasta la aprobación, y transferencia al creador
-- por Stripe Connect (separate charges and transfers, con source_transaction).
-- La comisión sigue siendo la congelada del contrato (fee_pct / columnas
-- generadas): la transferencia es creator_net_cents, nunca un recálculo.
-- =============================================================================

alter table public.gig_contracts
  add column if not exists stripe_charge_id text,
  add column if not exists stripe_refund_id text,
  add column if not exists stripe_receipt_url text,
  add column if not exists checkout_opened_at timestamptz,
  add column if not exists review_deadline_at timestamptz,
  add column if not exists approved_via text,
  add column if not exists payout_error text,
  add column if not exists payout_attempted_at timestamptz;

alter table public.gig_contracts
  drop constraint if exists gig_contracts_approved_via_check,
  add constraint gig_contracts_approved_via_check check (approved_via is null or approved_via in ('client', 'auto')),
  drop constraint if exists gig_contracts_payout_error_check,
  add constraint gig_contracts_payout_error_check check (payout_error is null or char_length(payout_error) <= 500);

comment on column public.gig_contracts.review_deadline_at is
  'Fin del período de revisión de la entrega vigente (72 h). Null mientras no hay entrega pendiente de revisión. Lo lee el cron de liberación automática.';
comment on column public.gig_contracts.approved_via is
  'client = aprobó el negocio; auto = venció el período de revisión sin respuesta.';
comment on column public.gig_contracts.payout_error is
  'Por qué la transferencia al creador todavía no salió (cuenta sin configurar, error de Stripe). Se limpia al liberar.';

create unique index if not exists gig_contracts_payment_intent_uniq
  on public.gig_contracts (stripe_payment_intent_id) where stripe_payment_intent_id is not null;
create unique index if not exists gig_contracts_transfer_uniq
  on public.gig_contracts (stripe_transfer_id) where stripe_transfer_id is not null;

create index if not exists gig_contracts_revision_vencida_idx
  on public.gig_contracts (review_deadline_at) where status = 'delivered';
create index if not exists gig_contracts_pago_pendiente_idx
  on public.gig_contracts (creator_id, approved_at) where status = 'approved';

alter table public.connected_accounts
  add column if not exists last_synced_at timestamptz;

comment on column public.connected_accounts.last_synced_at is
  'Última vez que se leyó la cuenta de Stripe (vuelta del onboarding, account.updated o antes de transferir).';

commit;
