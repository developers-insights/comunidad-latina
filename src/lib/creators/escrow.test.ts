import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { createFakeDb, type FakeDb } from "./fake-db.test-helper";

const mocks = vi.hoisted(() => ({
  createNotification: vi.fn().mockResolvedValue({ ok: true }),
  crearCheckoutSessionIdempotente: vi.fn(),
}));

vi.mock("@/lib/notifications/notify", () => ({ createNotification: mocks.createNotification }));
vi.mock("@/lib/stripe/checkout", () => ({
  crearCheckoutSessionIdempotente: mocks.crearCheckoutSessionIdempotente,
}));

import {
  approveDelivery,
  attemptPayout,
  confirmGigFunding,
  ensureCreatorConnectedAccount,
  openGigCheckout,
  refundCanceledContract,
  type AdminClient,
  type EscrowContract,
} from "./escrow";

const TENANT = "11111111-1111-4111-8111-111111111111";
const CLIENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CREATOR = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CONTRACT_ID = "0199aaaa-0000-7000-8000-000000000001";

function contract(overrides: Partial<EscrowContract> = {}): EscrowContract {
  return {
    id: CONTRACT_ID,
    tenant_id: TENANT,
    code: "CL-CM-2026-000012",
    client_id: CLIENT,
    creator_id: CREATOR,
    title: "4 videos promocionales",
    status: "signed",
    payment_mode: "stripe",
    amount_cents: 100_000,
    currency: "usd",
    fee_pct: 20,
    platform_fee_cents: 20_000,
    creator_net_cents: 80_000,
    terms_version: 1,
    stripe_checkout_session_id: null,
    stripe_payment_intent_id: null,
    stripe_charge_id: null,
    stripe_transfer_id: null,
    stripe_refund_id: null,
    review_deadline_at: null,
    approved_at: null,
    released_at: null,
    payout_error: null,
    ...overrides,
  };
}

function fakeStripe() {
  return {
    checkout: { sessions: { retrieve: vi.fn(), expire: vi.fn() } },
    paymentIntents: {
      retrieve: vi.fn().mockResolvedValue({
        id: "pi_1",
        latest_charge: { id: "ch_1", receipt_url: "https://pay.stripe.com/receipts/1" },
      }),
    },
    refunds: { create: vi.fn().mockResolvedValue({ id: "re_1" }) },
    transfers: {
      list: vi.fn().mockResolvedValue({ data: [] }),
      create: vi.fn().mockResolvedValue({ id: "tr_1" }),
    },
    accounts: {
      retrieve: vi.fn().mockResolvedValue({
        id: "acct_1",
        capabilities: { transfers: "active" },
        details_submitted: true,
        charges_enabled: false,
        payouts_enabled: true,
        requirements: { currently_due: [], past_due: [], disabled_reason: null },
      }),
      create: vi.fn().mockResolvedValue({ id: "acct_new", capabilities: { transfers: "inactive" } }),
    },
  };
}

type FakeStripe = ReturnType<typeof fakeStripe>;
let fake: FakeDb;
let stripe: FakeStripe;
const admin = () => fake.client as AdminClient;
const asStripe = () => stripe as unknown as Stripe;

function row(): Record<string, unknown> {
  return fake.tables.gig_contracts[0];
}

function events(): string[] {
  return (fake.tables.gig_contract_events ?? []).map((e) => String(e.kind));
}

function paidSession(overrides: Partial<Stripe.Checkout.Session> = {}): Stripe.Checkout.Session {
  return {
    id: "cs_1",
    payment_status: "paid",
    payment_intent: "pi_1",
    amount_total: 100_000,
    currency: "usd",
    metadata: { kind: "gig_contract", contract_id: CONTRACT_ID, tenant_id: TENANT },
    ...overrides,
  } as Stripe.Checkout.Session;
}

beforeEach(() => {
  vi.clearAllMocks();
  stripe = fakeStripe();
});

describe("openGigCheckout", () => {
  beforeEach(() => {
    fake = createFakeDb({ gig_contracts: [contract()] });
    mocks.crearCheckoutSessionIdempotente.mockResolvedValue({ id: "cs_1", url: "https://checkout/cs_1" });
  });

  it("cobra exactamente el monto del contrato, con transfer_group y metadata del contrato, y vincula la sesión", async () => {
    const result = await openGigCheckout({
      admin: admin(),
      stripe: asStripe(),
      contract: contract(),
      clientEmail: "negocio@example.com",
      siteUrl: "https://app.test",
    });

    expect(result).toEqual({ ok: true, url: "https://checkout/cs_1" });
    const [params, key] = mocks.crearCheckoutSessionIdempotente.mock.calls[0];
    expect(params.line_items[0].price_data.unit_amount).toBe(100_000);
    expect(params.payment_method_types).toEqual(["card"]);
    expect(params.payment_intent_data.transfer_group).toBe(`gig_${CONTRACT_ID}`);
    expect(params.metadata).toEqual({ kind: "gig_contract", contract_id: CONTRACT_ID, tenant_id: TENANT });
    expect(key).toMatch(/^gig-checkout:/);
    expect(row().stripe_checkout_session_id).toBe("cs_1");
    expect(events()).toEqual(["checkout_opened"]);
  });

  it("sin las dos firmas no abre ningún cobro", async () => {
    const result = await openGigCheckout({
      admin: admin(),
      stripe: asStripe(),
      contract: contract({ status: "accepted" }),
      clientEmail: null,
      siteUrl: "https://app.test",
    });
    expect(result).toEqual({ ok: false, reason: "status" });
    expect(mocks.crearCheckoutSessionIdempotente).not.toHaveBeenCalled();
  });

  it("si ya hay una sesión abierta la reusa en vez de abrir otra", async () => {
    stripe.checkout.sessions.retrieve.mockResolvedValue({ id: "cs_0", status: "open", url: "https://checkout/cs_0" });
    const result = await openGigCheckout({
      admin: admin(),
      stripe: asStripe(),
      contract: contract({ stripe_checkout_session_id: "cs_0" }),
      clientEmail: null,
      siteUrl: "https://app.test",
    });
    expect(result).toEqual({ ok: true, url: "https://checkout/cs_0" });
    expect(mocks.crearCheckoutSessionIdempotente).not.toHaveBeenCalled();
  });

  it("si la sesión anterior ya se pagó, no deja pagar dos veces", async () => {
    stripe.checkout.sessions.retrieve.mockResolvedValue({ id: "cs_0", status: "complete", url: null });
    const result = await openGigCheckout({
      admin: admin(),
      stripe: asStripe(),
      contract: contract({ stripe_checkout_session_id: "cs_0" }),
      clientEmail: null,
      siteUrl: "https://app.test",
    });
    expect(result).toEqual({ ok: false, reason: "processing" });
  });

  it("si no se puede vincular la sesión al contrato, la expira", async () => {
    fake.failNext("gig_contracts", "update");
    const result = await openGigCheckout({
      admin: admin(),
      stripe: asStripe(),
      contract: contract(),
      clientEmail: null,
      siteUrl: "https://app.test",
    });
    expect(result).toEqual({ ok: false, reason: "link" });
    expect(stripe.checkout.sessions.expire).toHaveBeenCalledWith("cs_1");
  });
});

describe("confirmGigFunding", () => {
  beforeEach(() => {
    fake = createFakeDb({ gig_contracts: [contract({ stripe_checkout_session_id: "cs_1" })] });
  });

  it("un pago confirmado que coincide pasa el contrato a 'funded' con los ids de Stripe", async () => {
    await confirmGigFunding(admin(), asStripe(), paidSession());
    expect(row().status).toBe("funded");
    expect(row().payment_mode).toBe("stripe");
    expect(row().stripe_payment_intent_id).toBe("pi_1");
    expect(row().stripe_charge_id).toBe("ch_1");
    expect(row().stripe_receipt_url).toBe("https://pay.stripe.com/receipts/1");
    expect(events()).toEqual(["funded"]);
    expect(mocks.createNotification).toHaveBeenCalledTimes(2);
  });

  it("es idempotente: la segunda entrega del mismo pago no notifica ni registra de nuevo", async () => {
    await confirmGigFunding(admin(), asStripe(), paidSession());
    await confirmGigFunding(admin(), asStripe(), paidSession());
    expect(events()).toEqual(["funded"]);
    expect(mocks.createNotification).toHaveBeenCalledTimes(2);
    expect(stripe.refunds.create).not.toHaveBeenCalled();
  });

  it("un pago todavía no acreditado (método diferido) no mueve nada", async () => {
    await confirmGigFunding(admin(), asStripe(), paidSession({ payment_status: "unpaid" }));
    expect(row().status).toBe("signed");
  });

  it("monto distinto: no acredita y reembolsa", async () => {
    await confirmGigFunding(admin(), asStripe(), paidSession({ amount_total: 90_000 }));
    expect(row().status).toBe("signed");
    expect(stripe.refunds.create).toHaveBeenCalledWith(
      expect.objectContaining({ payment_intent: "pi_1" }),
      { idempotencyKey: "gig-orphan-refund:pi_1" },
    );
    expect(events()).toEqual(["payment_orphan_refunded"]);
  });

  it("pago de un contrato ya cancelado: se reembolsa solo", async () => {
    fake.tables.gig_contracts[0].status = "canceled";
    await confirmGigFunding(admin(), asStripe(), paidSession());
    expect(row().status).toBe("canceled");
    expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
  });

  it("pago de un contrato inexistente: se reembolsa", async () => {
    await confirmGigFunding(
      admin(),
      asStripe(),
      paidSession({ metadata: { kind: "gig_contract", contract_id: "no-existe", tenant_id: TENANT } }),
    );
    expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
  });

  it("si el reembolso falla, lanza para que Stripe reintente el evento", async () => {
    stripe.refunds.create.mockRejectedValueOnce(new Error("stripe caído"));
    await expect(confirmGigFunding(admin(), asStripe(), paidSession({ amount_total: 1 }))).rejects.toThrow(
      "stripe caído",
    );
  });

  it("si leer el cargo falla, acredita igual (el cargo se busca al transferir)", async () => {
    stripe.paymentIntents.retrieve.mockRejectedValueOnce(new Error("timeout"));
    await confirmGigFunding(admin(), asStripe(), paidSession());
    expect(row().status).toBe("funded");
    expect(row().stripe_charge_id).toBeNull();
  });
});

describe("approveDelivery + attemptPayout", () => {
  const delivered = () =>
    contract({
      status: "delivered",
      stripe_checkout_session_id: "cs_1",
      stripe_payment_intent_id: "pi_1",
      stripe_charge_id: "ch_1",
      review_deadline_at: "2026-09-23T12:00:00.000Z",
    });

  beforeEach(() => {
    fake = createFakeDb({
      gig_contracts: [delivered()],
      connected_accounts: [
        { owner_type: "creator", owner_ref: CREATOR, stripe_account_id: "acct_1", capabilities: {} },
      ],
    });
  });

  it("el negocio aprueba y se transfiere el neto congelado al creador, atado al cargo", async () => {
    const result = await approveDelivery({
      admin: admin(),
      stripe: asStripe(),
      contract: delivered(),
      via: "client",
      actorId: CLIENT,
    });

    expect(result).toEqual({ ok: true, payout: { kind: "released", demo: false } });
    expect(stripe.transfers.create).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 80_000,
        currency: "usd",
        destination: "acct_1",
        source_transaction: "ch_1",
        transfer_group: `gig_${CONTRACT_ID}`,
      }),
      { idempotencyKey: `gig-transfer:${CONTRACT_ID}` },
    );
    expect(row().status).toBe("released");
    expect(row().stripe_transfer_id).toBe("tr_1");
    expect(row().approved_via).toBe("client");
    expect(events()).toEqual(["approved", "released"]);
  });

  it("la aprobación automática no se adelanta al vencimiento", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-22T12:00:00.000Z"));
    const result = await approveDelivery({
      admin: admin(),
      stripe: asStripe(),
      contract: delivered(),
      via: "auto",
      actorId: null,
    });
    vi.useRealTimers();
    expect(result).toEqual({ ok: false, stale: true });
    expect(row().status).toBe("delivered");
  });

  it("vencida la revisión, aprueba solo y libera", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-23T12:00:01.000Z"));
    const result = await approveDelivery({
      admin: admin(),
      stripe: asStripe(),
      contract: delivered(),
      via: "auto",
      actorId: null,
    });
    vi.useRealTimers();
    expect(result.ok).toBe(true);
    expect(row().approved_via).toBe("auto");
    expect(events()).toEqual(["auto_approved", "released"]);
  });

  it("una entrega en disputa no se aprueba", async () => {
    fake.tables.gig_contracts[0].status = "disputed";
    const result = await approveDelivery({
      admin: admin(),
      stripe: asStripe(),
      contract: delivered(),
      via: "client",
      actorId: CLIENT,
    });
    expect(result).toEqual({ ok: false, stale: true });
    expect(stripe.transfers.create).not.toHaveBeenCalled();
  });

  it("sin cuenta de cobro, el pago queda aprobado y retenido, y se avisa una sola vez", async () => {
    fake.tables.connected_accounts = [];
    await approveDelivery({ admin: admin(), stripe: asStripe(), contract: delivered(), via: "client", actorId: CLIENT });
    expect(row().status).toBe("approved");
    expect(row().payout_error).toMatch(/configuró/);
    expect(stripe.transfers.create).not.toHaveBeenCalled();

    const notificationsAfterFirst = mocks.createNotification.mock.calls.length;
    const again = await attemptPayout({ admin: admin(), stripe: asStripe(), contractId: CONTRACT_ID });
    expect(again).toEqual({ kind: "blocked", readiness: "missing" });
    expect(mocks.createNotification.mock.calls.length).toBe(notificationsAfterFirst);
    expect(events().filter((e) => e === "payout_blocked")).toHaveLength(1);
  });

  it("con la cuenta incompleta en Stripe, tampoco transfiere", async () => {
    stripe.accounts.retrieve.mockResolvedValueOnce({
      id: "acct_1",
      capabilities: { transfers: "pending" },
      requirements: { currently_due: ["individual.dob.day"], past_due: [], disabled_reason: null },
    });
    await approveDelivery({ admin: admin(), stripe: asStripe(), contract: delivered(), via: "client", actorId: CLIENT });
    expect(row().status).toBe("approved");
    expect(stripe.transfers.create).not.toHaveBeenCalled();
  });

  it("si la transferencia ya existe en Stripe (reintento después de un fallo), no crea otra", async () => {
    fake.tables.gig_contracts[0].status = "approved";
    stripe.transfers.list.mockResolvedValueOnce({
      data: [{ id: "tr_viejo", reversed: false, metadata: { contract_id: CONTRACT_ID } }],
    });
    const result = await attemptPayout({ admin: admin(), stripe: asStripe(), contractId: CONTRACT_ID });
    expect(result).toEqual({ kind: "released", demo: false });
    expect(stripe.transfers.create).not.toHaveBeenCalled();
    expect(row().stripe_transfer_id).toBe("tr_viejo");
  });

  it("si Stripe rechaza la transferencia, queda aprobado con el motivo y no se marca liberado", async () => {
    fake.tables.gig_contracts[0].status = "approved";
    stripe.transfers.create.mockRejectedValueOnce(new Error("insufficient funds"));
    const result = await attemptPayout({ admin: admin(), stripe: asStripe(), contractId: CONTRACT_ID });
    expect(result.kind).toBe("failed");
    expect(row().status).toBe("approved");
    expect(row().payout_error).toMatch(/insufficient funds/);
    expect(events()).toContain("payout_failed");
  });

  it("un contrato en modo demostración se libera sin mover plata", async () => {
    fake.tables.gig_contracts[0] = {
      ...contract({ status: "approved", payment_mode: "demo" }),
    };
    const result = await attemptPayout({ admin: admin(), stripe: null, contractId: CONTRACT_ID });
    expect(result).toEqual({ kind: "released", demo: true });
    expect(stripe.transfers.create).not.toHaveBeenCalled();
  });

  it("un neto imposible no se transfiere", async () => {
    fake.tables.gig_contracts[0] = {
      ...contract({ status: "approved", stripe_payment_intent_id: "pi_1", creator_net_cents: 0 }),
    };
    const result = await attemptPayout({ admin: admin(), stripe: asStripe(), contractId: CONTRACT_ID });
    expect(result).toEqual({ kind: "failed", message: "invalid_amount" });
    expect(stripe.transfers.create).not.toHaveBeenCalled();
  });
});

describe("refundCanceledContract", () => {
  it("reembolsa el pago de un contrato cancelado una sola vez", async () => {
    fake = createFakeDb({
      gig_contracts: [contract({ status: "canceled", stripe_payment_intent_id: "pi_1" })],
    });
    const c = contract({ status: "canceled", stripe_payment_intent_id: "pi_1" });
    await refundCanceledContract(admin(), asStripe(), c);
    expect(stripe.refunds.create).toHaveBeenCalledWith(
      expect.objectContaining({ payment_intent: "pi_1" }),
      { idempotencyKey: `gig-refund:${CONTRACT_ID}` },
    );
    expect(row().stripe_refund_id).toBe("re_1");

    await refundCanceledContract(admin(), asStripe(), { ...c, stripe_refund_id: "re_1" });
    expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
  });

  it("si Stripe falla, no rompe y deja el contrato para el reintento", async () => {
    fake = createFakeDb({
      gig_contracts: [contract({ status: "canceled", stripe_payment_intent_id: "pi_1" })],
    });
    stripe.refunds.create.mockRejectedValueOnce(new Error("rate limit"));
    const result = await refundCanceledContract(
      admin(),
      asStripe(),
      contract({ status: "canceled", stripe_payment_intent_id: "pi_1" }),
    );
    expect(result).toEqual({ ok: false });
    expect(row().stripe_refund_id ?? null).toBeNull();
  });
});

describe("ensureCreatorConnectedAccount", () => {
  it("crea una cuenta Express sólo con transferencias y la guarda", async () => {
    fake = createFakeDb({ connected_accounts: [] });
    const id = await ensureCreatorConnectedAccount({
      admin: admin(),
      stripe: asStripe(),
      tenantId: TENANT,
      profileId: CREATOR,
      email: "ana@example.com",
    });
    expect(id).toBe("acct_new");
    const [params, options] = stripe.accounts.create.mock.calls[0];
    expect(params.controller.stripe_dashboard.type).toBe("express");
    expect(params.capabilities).toEqual({ transfers: { requested: true } });
    expect(options).toEqual({ idempotencyKey: `gig-connect:${CREATOR}` });
    expect(fake.tables.connected_accounts[0]).toMatchObject({
      owner_type: "creator",
      owner_ref: CREATOR,
      stripe_account_id: "acct_new",
    });
  });

  it("si ya tiene cuenta, no crea otra", async () => {
    fake = createFakeDb({
      connected_accounts: [{ owner_type: "creator", owner_ref: CREATOR, stripe_account_id: "acct_1" }],
    });
    const id = await ensureCreatorConnectedAccount({
      admin: admin(),
      stripe: asStripe(),
      tenantId: TENANT,
      profileId: CREATOR,
      email: null,
    });
    expect(id).toBe("acct_1");
    expect(stripe.accounts.create).not.toHaveBeenCalled();
  });
});
