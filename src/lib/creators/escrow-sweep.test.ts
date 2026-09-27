import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { createFakeDb, type FakeDb } from "./fake-db.test-helper";

vi.mock("@/lib/notifications/notify", () => ({ createNotification: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock("@/lib/stripe/checkout", () => ({ crearCheckoutSessionIdempotente: vi.fn() }));

import { runEscrowSweep } from "./escrow-sweep";
import type { AdminClient } from "./escrow";

const TENANT = "11111111-1111-4111-8111-111111111111";
const CREATOR = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NOW = new Date("2026-09-27T12:00:00.000Z");

function contract(id: string, overrides: Record<string, unknown>) {
  return {
    id,
    tenant_id: TENANT,
    code: `CL-CM-2026-00000${id.slice(-1)}`,
    client_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    creator_id: CREATOR,
    title: "Videos",
    status: "delivered",
    payment_mode: "stripe",
    amount_cents: 100_000,
    currency: "usd",
    fee_pct: 20,
    platform_fee_cents: 20_000,
    creator_net_cents: 80_000,
    terms_version: 1,
    stripe_checkout_session_id: "cs",
    stripe_payment_intent_id: `pi_${id}`,
    stripe_charge_id: `ch_${id}`,
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
let stripe: {
  accounts: { retrieve: ReturnType<typeof vi.fn> };
  transfers: { list: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
  refunds: { create: ReturnType<typeof vi.fn> };
  paymentIntents: { retrieve: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  stripe = {
    accounts: {
      retrieve: vi.fn().mockResolvedValue({
        id: "acct_1",
        capabilities: { transfers: "active" },
        requirements: { currently_due: [], past_due: [], disabled_reason: null },
      }),
    },
    transfers: { list: vi.fn().mockResolvedValue({ data: [] }), create: vi.fn().mockResolvedValue({ id: "tr_x" }) },
    refunds: { create: vi.fn().mockResolvedValue({ id: "re_x" }) },
    paymentIntents: { retrieve: vi.fn() },
  };
});

function run() {
  return runEscrowSweep({ admin: fake.client as AdminClient, stripe: stripe as unknown as Stripe, now: NOW });
}

describe("runEscrowSweep", () => {
  it("aprueba y libera sólo las entregas con la revisión vencida", async () => {
    fake = createFakeDb({
      gig_contracts: [
        contract("c1", { review_deadline_at: "2026-09-27T11:00:00.000Z" }),
        contract("c2", { review_deadline_at: "2026-09-28T11:00:00.000Z" }),
        contract("c3", { status: "disputed", review_deadline_at: "2026-09-20T11:00:00.000Z" }),
      ],
      connected_accounts: [{ owner_type: "creator", owner_ref: CREATOR, stripe_account_id: "acct_1", capabilities: {} }],
    });

    const result = await run();

    const byId = Object.fromEntries(fake.tables.gig_contracts.map((c) => [c.id, c.status]));
    expect(byId).toEqual({ c1: "released", c2: "delivered", c3: "disputed" });
    expect(result.autoApproved).toBe(1);
    expect(stripe.transfers.create).toHaveBeenCalledTimes(1);
  });

  it("reintenta los pagos aprobados que quedaron retenidos", async () => {
    fake = createFakeDb({
      gig_contracts: [contract("c4", { status: "approved", approved_at: "2026-09-26T00:00:00.000Z" })],
      connected_accounts: [{ owner_type: "creator", owner_ref: CREATOR, stripe_account_id: "acct_1", capabilities: {} }],
    });
    const result = await run();
    expect(fake.tables.gig_contracts[0].status).toBe("released");
    expect(result.released).toBe(1);
  });

  it("reintenta los reembolsos de cancelaciones que no salieron", async () => {
    fake = createFakeDb({ gig_contracts: [contract("c5", { status: "canceled" })] });
    const result = await run();
    expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
    expect(fake.tables.gig_contracts[0].stripe_refund_id).toBe("re_x");
    expect(result.refunded).toBe(1);
  });

  it("un contrato que falla no frena a los demás", async () => {
    fake = createFakeDb({
      gig_contracts: [
        contract("c6", { status: "approved", approved_at: "2026-09-25T00:00:00.000Z" }),
        contract("c7", { status: "approved", approved_at: "2026-09-26T00:00:00.000Z" }),
      ],
      connected_accounts: [{ owner_type: "creator", owner_ref: CREATOR, stripe_account_id: "acct_1", capabilities: {} }],
    });
    stripe.transfers.create.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce({ id: "tr_ok" });
    const result = await run();
    const byId = Object.fromEntries(fake.tables.gig_contracts.map((c) => [c.id, c.status]));
    expect(byId).toEqual({ c6: "approved", c7: "released" });
    expect(result.failed).toBe(1);
  });
});
