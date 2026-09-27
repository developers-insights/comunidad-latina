import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Pago protegido del Creator Marketplace dentro del webhook único, con firma
 * real. La lógica de cada evento vive en lib/creators/stripe-webhook.ts (con
 * sus propios tests); acá se prueba el cableado: que el route le pase los
 * eventos, que un evento atendido quede processed, que un fallo devuelva 500
 * para que Stripe reintente, y la firma del endpoint de Connect.
 */

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  handleGigContractEvent: vi.fn(),
}));

vi.mock("@/lib/config/services", () => ({ isStripeConfigured: true }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/notifications/notify", () => ({ createNotification: vi.fn() }));
vi.mock("@/lib/creators/stripe-webhook", () => ({ handleGigContractEvent: mocks.handleGigContractEvent }));
vi.mock("@/lib/stripe", async () => {
  const StripeCtor = (await import("stripe")).default;
  const stripe = new StripeCtor("sk_test_dummy_para_firmar_fixtures");
  const fake = { webhooks: stripe.webhooks };
  return { getStripe: () => fake, PLAN_IDS: ["basico", "destacado", "pro"] };
});

import Stripe from "stripe";
import { POST } from "./route";

const WEBHOOK_SECRET = "whsec_test_secret_de_fixtures";
const CONNECT_SECRET = "whsec_test_secret_de_connect";
const signer = new Stripe("sk_test_dummy_para_firmar_fixtures");

interface Call {
  table: string;
  method: string;
  args: unknown[];
}

function useAdmin() {
  const calls: Call[] = [];
  const from = vi.fn((table: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = {};
    for (const method of ["insert", "update", "select", "eq", "or"]) {
      builder[method] = vi.fn((...args: unknown[]) => {
        calls.push({ table, method, args });
        return builder;
      });
    }
    builder.maybeSingle = vi.fn(async () => ({ data: null, error: null }));
    builder.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(resolve);
    return builder;
  });
  mocks.createAdminClient.mockReturnValue({ from });
  return calls;
}

function signedRequest(event: unknown, secret = WEBHOOK_SECRET) {
  const rawBody = JSON.stringify(event);
  const signature = signer.webhooks.generateTestHeaderString({ payload: rawBody, secret });
  return new Request("https://app.test/api/webhooks/stripe", {
    method: "POST",
    headers: new Headers({ "stripe-signature": signature }),
    body: rawBody,
  });
}

const GIG_EVENT = {
  id: "evt_gig_1",
  object: "event",
  type: "checkout.session.completed",
  data: {
    object: {
      id: "cs_1",
      object: "checkout.session",
      payment_status: "paid",
      metadata: { kind: "gig_contract", contract_id: "c-1", tenant_id: "t-1" },
    },
  },
};

const ACCOUNT_EVENT = {
  id: "evt_acct_1",
  object: "event",
  type: "account.updated",
  account: "acct_1",
  data: { object: { id: "acct_1", object: "account" } },
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
  delete process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
});

afterEach(() => {
  delete process.env.STRIPE_WEBHOOK_SECRET;
  delete process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
});

function processedUpdates(calls: Call[]) {
  return calls.filter(
    (c) => c.table === "payment_events" && c.method === "update" && (c.args[0] as { processed?: boolean }).processed === true,
  );
}

describe("webhook — pago protegido de colaboraciones", () => {
  it("le pasa el evento al módulo de creadores y, si lo atiende, lo marca procesado y corta", async () => {
    const calls = useAdmin();
    mocks.handleGigContractEvent.mockResolvedValue(true);

    const response = await POST(signedRequest(GIG_EVENT));

    expect(response.status).toBe(200);
    expect(mocks.handleGigContractEvent).toHaveBeenCalledTimes(1);
    expect(mocks.handleGigContractEvent.mock.calls[0][1].id).toBe("evt_gig_1");
    expect(processedUpdates(calls)).toHaveLength(1);
    expect(calls.some((c) => c.table === "business_accounts")).toBe(false);
  });

  it("si el módulo de creadores falla, responde 500 y guarda el error para que Stripe reintente", async () => {
    const calls = useAdmin();
    mocks.handleGigContractEvent.mockRejectedValue(new Error("update gig_contracts (fund): 40001"));

    const response = await POST(signedRequest(GIG_EVENT));

    expect(response.status).toBe(500);
    const errorUpdate = calls.find(
      (c) => c.table === "payment_events" && c.method === "update" && (c.args[0] as { error?: string }).error,
    );
    expect((errorUpdate?.args[0] as { error: string }).error).toMatch(/gig_contracts/);
    expect(processedUpdates(calls)).toHaveLength(0);
  });

  it("si no es suyo, sigue el camino de siempre", async () => {
    useAdmin();
    mocks.handleGigContractEvent.mockResolvedValue(false);

    const response = await POST(
      signedRequest({ ...GIG_EVENT, id: "evt_otro", data: { object: { id: "cs_x", object: "checkout.session", metadata: {} } } }),
    );

    expect(response.status).toBe(200);
  });
});

describe("webhook — firma del endpoint de Connect", () => {
  it("acepta un evento de cuenta conectada firmado con STRIPE_CONNECT_WEBHOOK_SECRET", async () => {
    useAdmin();
    process.env.STRIPE_CONNECT_WEBHOOK_SECRET = CONNECT_SECRET;
    mocks.handleGigContractEvent.mockResolvedValue(true);

    const response = await POST(signedRequest(ACCOUNT_EVENT, CONNECT_SECRET));

    expect(response.status).toBe(200);
    expect(mocks.handleGigContractEvent).toHaveBeenCalledTimes(1);
  });

  it("sin ese secreto configurado, la misma firma se rechaza", async () => {
    useAdmin();
    const response = await POST(signedRequest(ACCOUNT_EVENT, CONNECT_SECRET));
    expect(response.status).toBe(400);
    expect(mocks.handleGigContractEvent).not.toHaveBeenCalled();
  });

  it("una firma con un secreto cualquiera se rechaza aunque exista el de Connect", async () => {
    useAdmin();
    process.env.STRIPE_CONNECT_WEBHOOK_SECRET = CONNECT_SECRET;
    const response = await POST(signedRequest(ACCOUNT_EVENT, "whsec_inventado"));
    expect(response.status).toBe(400);
  });
});
