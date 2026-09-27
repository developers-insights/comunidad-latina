import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runEscrowSweep: vi.fn(),
  createAdminClient: vi.fn(() => ({})),
  getStripe: vi.fn(() => ({})),
  stripeConfigured: { value: true },
}));

vi.mock("@/lib/creators/escrow-sweep", () => ({ runEscrowSweep: mocks.runEscrowSweep }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/stripe", () => ({ getStripe: mocks.getStripe }));
vi.mock("@/lib/config/services", () => ({
  get isStripeConfigured() {
    return mocks.stripeConfigured.value;
  },
}));

import { GET } from "./route";

function request(auth?: string) {
  return new Request("https://app.test/api/cron/creadores", {
    headers: auth ? new Headers({ authorization: auth }) : new Headers(),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.stripeConfigured.value = true;
  process.env.CRON_SECRET = "secreto-de-cron";
  mocks.runEscrowSweep.mockResolvedValue({ autoApproved: 1, released: 1, blocked: 0, failed: 0, refunded: 0 });
});

afterEach(() => {
  delete process.env.CRON_SECRET;
});

describe("cron de liberación automática", () => {
  it("sin CRON_SECRET configurado no corre (fail-closed)", async () => {
    delete process.env.CRON_SECRET;
    const response = await GET(request("Bearer undefined"));
    expect(response.status).toBe(503);
    expect(mocks.runEscrowSweep).not.toHaveBeenCalled();
  });

  it("sin el header correcto responde 401 y no toca nada", async () => {
    expect((await GET(request())).status).toBe(401);
    expect((await GET(request("Bearer otro"))).status).toBe(401);
    expect(mocks.runEscrowSweep).not.toHaveBeenCalled();
  });

  it("con el secreto corre la barrida y devuelve el resumen", async () => {
    const response = await GET(request("Bearer secreto-de-cron"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ autoApproved: 1, released: 1 });
    expect(mocks.runEscrowSweep.mock.calls[0][0].stripe).not.toBeNull();
  });

  it("sin Stripe configurado corre igual, sin cliente de Stripe", async () => {
    mocks.stripeConfigured.value = false;
    await GET(request("Bearer secreto-de-cron"));
    expect(mocks.runEscrowSweep.mock.calls[0][0].stripe).toBeNull();
    expect(mocks.getStripe).not.toHaveBeenCalled();
  });

  it("si la barrida explota, responde 500 con log", async () => {
    mocks.runEscrowSweep.mockRejectedValue(new Error("select gig_contracts: 57014"));
    const response = await GET(request("Bearer secreto-de-cron"));
    expect(response.status).toBe(500);
  });
});
