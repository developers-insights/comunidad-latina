import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { createFakeDb, type FakeDb } from "./fake-db.test-helper";

vi.mock("@/lib/notifications/notify", () => ({ createNotification: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock("@/lib/stripe/checkout", () => ({ crearCheckoutSessionIdempotente: vi.fn() }));

import { handleGigContractEvent } from "./stripe-webhook";
import type { AdminClient } from "./escrow";

const TENANT = "11111111-1111-4111-8111-111111111111";
const CONTRACT_ID = "0199aaaa-0000-7000-8000-000000000001";
const CREATOR = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function baseContract(overrides: Record<string, unknown> = {}) {
  return {
    id: CONTRACT_ID,
    tenant_id: TENANT,
    code: "CL-CM-2026-000012",
    client_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    creator_id: CREATOR,
    title: "Videos",
    status: "funded",
    payment_mode: "stripe",
    amount_cents: 100_000,
    currency: "usd",
    fee_pct: 20,
    platform_fee_cents: 20_000,
    creator_net_cents: 80_000,
    terms_version: 1,
    stripe_checkout_session_id: "cs_1",
    stripe_payment_intent_id: "pi_1",
    stripe_charge_id: "ch_1",
    stripe_transfer_id: null,
    stripe_refund_id: null,
    review_deadline_at: null,
    approved_at: null,
    released_at: null,
    payout_error: null,
    ...overrides,
  };
}

let fake: FakeDb;
const stripe = {
  accounts: { retrieve: vi.fn() },
  transfers: { list: vi.fn().mockResolvedValue({ data: [] }), create: vi.fn().mockResolvedValue({ id: "tr_1" }) },
  paymentIntents: { retrieve: vi.fn() },
  refunds: { create: vi.fn() },
};
const getStripe = () => stripe as unknown as Stripe;
const admin = () => fake.client as AdminClient;

function event(type: string, object: unknown): Stripe.Event {
  return { id: `evt_${type}`, type, data: { object } } as unknown as Stripe.Event;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("handleGigContractEvent", () => {
  it("ignora checkouts de otros productos sin tocar la base", async () => {
    fake = createFakeDb({ gig_contracts: [baseContract()] });
    const handled = await handleGigContractEvent(
      admin(),
      event("checkout.session.completed", { id: "cs_x", metadata: { boost_id: "b1" } }),
      getStripe,
    );
    expect(handled).toBe(false);
  });

  it("un checkout vencido libera el contrato para volver a pagar", async () => {
    fake = createFakeDb({ gig_contracts: [baseContract({ status: "signed", stripe_payment_intent_id: null })] });
    const handled = await handleGigContractEvent(
      admin(),
      event("checkout.session.expired", {
        id: "cs_1",
        metadata: { kind: "gig_contract", contract_id: CONTRACT_ID, tenant_id: TENANT },
      }),
      getStripe,
    );
    expect(handled).toBe(true);
    expect(fake.tables.gig_contracts[0].stripe_checkout_session_id).toBeNull();
  });

  it("un reembolso hecho por fuera sobre plata retenida congela el contrato en disputa", async () => {
    fake = createFakeDb({ gig_contracts: [baseContract({ status: "delivered" })] });
    const handled = await handleGigContractEvent(
      admin(),
      event("charge.refunded", { id: "ch_1", payment_intent: "pi_1", refunds: { data: [{ id: "re_9" }] } }),
      getStripe,
    );
    expect(handled).toBe(true);
    expect(fake.tables.gig_contracts[0].status).toBe("disputed");
    expect(fake.tables.gig_contracts[0].stripe_refund_id).toBe("re_9");
    expect(fake.tables.gig_contract_events.map((e) => e.kind)).toEqual(["refunded"]);
  });

  it("el reembolso de nuestra propia cancelación sólo se anota una vez", async () => {
    fake = createFakeDb({ gig_contracts: [baseContract({ status: "canceled" })] });
    const charge = { id: "ch_1", payment_intent: "pi_1", refunds: { data: [{ id: "re_1" }] } };
    await handleGigContractEvent(admin(), event("charge.refunded", charge), getStripe);
    await handleGigContractEvent(admin(), event("charge.refunded", charge), getStripe);
    expect(fake.tables.gig_contracts[0].status).toBe("canceled");
    expect(fake.tables.gig_contract_events).toHaveLength(1);
  });

  it("un cobro que no es de ningún contrato no es suyo", async () => {
    fake = createFakeDb({ gig_contracts: [baseContract()] });
    const handled = await handleGigContractEvent(
      admin(),
      event("charge.refunded", { id: "ch_9", payment_intent: "pi_otro", refunds: { data: [] } }),
      getStripe,
    );
    expect(handled).toBe(false);
  });

  it("un contracargo congela el pago retenido", async () => {
    fake = createFakeDb({ gig_contracts: [baseContract({ status: "approved" })] });
    const handled = await handleGigContractEvent(
      admin(),
      event("charge.dispute.created", { id: "dp_1", payment_intent: "pi_1", reason: "fraudulent" }),
      getStripe,
    );
    expect(handled).toBe(true);
    expect(fake.tables.gig_contracts[0].status).toBe("disputed");
    expect(fake.tables.gig_contract_events.map((e) => e.kind)).toEqual(["chargeback"]);
  });

  it("cuando la cuenta del creador queda habilitada, sincroniza y libera sus pagos pendientes", async () => {
    fake = createFakeDb({
      gig_contracts: [baseContract({ status: "approved", approved_at: "2026-09-20T00:00:00Z" })],
      connected_accounts: [
        { owner_type: "creator", owner_ref: CREATOR, stripe_account_id: "acct_1", capabilities: {} },
      ],
    });
    const account = {
      id: "acct_1",
      capabilities: { transfers: "active" },
      details_submitted: true,
      payouts_enabled: true,
      charges_enabled: false,
      requirements: { currently_due: [], past_due: [], disabled_reason: null },
    };
    stripe.accounts.retrieve.mockResolvedValue(account);

    const handled = await handleGigContractEvent(admin(), event("account.updated", account), getStripe);

    expect(handled).toBe(true);
    expect(fake.tables.connected_accounts[0].capabilities).toEqual({ transfers: "active" });
    expect(fake.tables.connected_accounts[0].verification_status).toBe("verified");
    expect(stripe.transfers.create).toHaveBeenCalledTimes(1);
    expect(fake.tables.gig_contracts[0].status).toBe("released");
  });

  it("account.updated de una cuenta que no es de un creador no es suyo", async () => {
    fake = createFakeDb({ connected_accounts: [] });
    const handled = await handleGigContractEvent(
      admin(),
      event("account.updated", { id: "acct_desconocida" }),
      getStripe,
    );
    expect(handled).toBe(false);
  });
});
