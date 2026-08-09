import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * =============================================================================
 * LA PLATA QUE VUELVE — reembolsos y disputas, con FIRMA REAL
 * =============================================================================
 *
 * Mismo aparato que `presencia.test.ts` y `premium.test.ts`: el SDK real firma
 * los fixtures, así que la verificación de firma que corre acá es la de verdad.
 * Lo único stubeado del SDK es `checkout.sessions.list`, que es la ÚNICA llamada
 * saliente del módulo de reembolsos (el puente cobro → Session → fila nuestra).
 *
 * EL ORDEN DE ESTE ARCHIVO NO ES CASUAL, y es el inverso al de las pasadas de
 * alta. Acá el error caro no es conceder de más: es APAGARLE EL SERVICIO A
 * ALGUIEN QUE PAGÓ. Por eso los caminos felices —los casos que NO deben apagar
 * nada— van PRIMERO y son los que mandan; la revocación va después y es un solo
 * caso, el inequívoco.
 */

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  createNotification: vi.fn(),
  listSessions: vi.fn(),
}));

vi.mock("@/lib/config/services", () => ({ isStripeConfigured: true }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/notifications/notify", () => ({ createNotification: mocks.createNotification }));

vi.mock("@/lib/stripe", async () => {
  const StripeCtor = (await import("stripe")).default;
  const stripe = new StripeCtor("sk_test_dummy_para_firmar_fixtures");
  // `webhooks` es el objeto REAL (la firma se verifica de verdad); `checkout` es
  // el único borde que se corta, para no salir a la red desde un test.
  const fake = {
    webhooks: stripe.webhooks,
    checkout: { sessions: { list: mocks.listSessions } },
  };
  return { getStripe: () => fake, PLAN_IDS: ["basico", "destacado", "pro"] };
});

import Stripe from "stripe";
import { POST } from "./route";

const WEBHOOK_SECRET = "whsec_test_secret_de_fixtures";
const signer = new Stripe("sk_test_dummy_para_firmar_fixtures");

/* --------------------------- Stub del admin client ------------------------- */

type OpResult = { data?: unknown; error?: unknown };
type TableOps = Partial<Record<"insert" | "update" | "upsert" | "select", OpResult>>;
type AdminConfig = Record<string, TableOps>;

interface RecordedCall {
  table: string;
  method: string;
  args: unknown[];
}

/** Query builder falso con la operación RAÍZ fijada en la primera llamada. */
function createAdminStub(config: AdminConfig = {}) {
  const calls: RecordedCall[] = [];

  const from = vi.fn((table: string) => {
    const tableConfig: TableOps = config[table] ?? {};
    let op: keyof TableOps | null = null;
    const setOp = (next: keyof TableOps) => {
      if (op === null) op = next;
    };
    const result = () => tableConfig[op ?? "select"] ?? { data: null, error: null };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = {};
    for (const method of ["insert", "update", "upsert", "select"] as const) {
      builder[method] = vi.fn((...args: unknown[]) => {
        calls.push({ table, method, args });
        setOp(method);
        return builder;
      });
    }
    builder.eq = vi.fn((...args: unknown[]) => {
      calls.push({ table, method: "eq", args });
      return builder;
    });
    builder.maybeSingle = vi.fn(async () => result());
    builder.single = vi.fn(async () => result());
    builder.then = (resolve: (v: OpResult) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(result()).then(resolve, reject);
    return builder;
  });

  return { client: { from }, from, calls };
}

function useAdmin(config: AdminConfig = {}) {
  const stub = createAdminStub(config);
  mocks.createAdminClient.mockReturnValue(stub.client);
  return stub;
}

function callsTo(stub: ReturnType<typeof createAdminStub>, table: string, method: string) {
  return stub.calls.filter((c) => c.table === table && c.method === method);
}

/** Las escrituras que APAGAN un beneficio (lo que este suite vigila que no pase de más). */
function revocaciones(stub: ReturnType<typeof createAdminStub>) {
  return [
    ...callsTo(stub, "boosts", "update"),
    ...callsTo(stub, "post_promotions", "update"),
    ...callsTo(stub, "store_memberships", "update"),
    ...callsTo(stub, "listing_premiums", "update"),
    ...callsTo(stub, "business_accounts", "update"),
  ];
}

/* -------------------------------- Fixtures -------------------------------- */

const TENANT = "tenant-1";
const BUYER = "buyer-1";
const PI = "pi_test_1";

const BOOST_SESSION = {
  id: "cs_test_boost_1",
  metadata: { boost_id: "boost-1", tenant_id: TENANT, listing_id: "listing-1" },
};

const BOOST_ROW = {
  id: "boost-1",
  tenant_id: TENANT,
  listing_id: "listing-1",
  buyer_id: BUYER,
  status: "active",
  stripe_checkout_session_id: "cs_test_boost_1",
};

const PROMO_SESSION = {
  id: "cs_test_promo_1",
  metadata: { post_promotion_id: "promo-1", tenant_id: TENANT, post_id: "post-1" },
};

const PROMO_ROW = {
  id: "promo-1",
  tenant_id: TENANT,
  post_id: "post-1",
  buyer_id: BUYER,
  status: "active",
  stripe_checkout_session_id: "cs_test_promo_1",
};

/** Un `charge.refunded`. Por defecto: reembolso TOTAL de un impulso. */
function refundEvent(chargeOverrides: Record<string, unknown> = {}) {
  return {
    id: `evt_${Math.random().toString(36).slice(2)}`,
    type: "charge.refunded",
    data: {
      object: {
        id: "ch_test_1",
        object: "charge",
        amount: 1000,
        amount_refunded: 1000,
        // `refunded` es el propio Stripe diciendo "devuelto ENTERO": con un
        // parcial queda en false por más grande que sea `amount_refunded`.
        refunded: true,
        currency: "usd",
        payment_intent: PI,
        customer: "cus_test_1",
        ...chargeOverrides,
      },
    },
  };
}

/** Un `charge.dispute.created` sobre el mismo cobro del impulso. */
function disputeEvent(disputeOverrides: Record<string, unknown> = {}) {
  return {
    id: `evt_${Math.random().toString(36).slice(2)}`,
    type: "charge.dispute.created",
    data: {
      object: {
        id: "dp_test_1",
        object: "dispute",
        amount: 1000,
        currency: "usd",
        charge: "ch_test_1",
        payment_intent: PI,
        reason: "fraudulent",
        status: "needs_response",
        ...disputeOverrides,
      },
    },
  };
}

/** Request con firma REAL, calculada con el mismo HMAC que usa Stripe. */
function signedRequest(event: unknown) {
  const rawBody = JSON.stringify(event);
  const signature = signer.webhooks.generateTestHeaderString({
    payload: rawBody,
    secret: WEBHOOK_SECRET,
  });
  return new Request("https://app.test/api/webhooks/stripe", {
    method: "POST",
    headers: new Headers({ "stripe-signature": signature }),
    body: rawBody,
  });
}

let errorSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;
let infoSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
  mocks.createNotification.mockResolvedValue({ ok: true });
  mocks.listSessions.mockResolvedValue({ data: [BOOST_SESSION] });
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
  warnSpy.mockRestore();
  infoSpy.mockRestore();
  delete process.env.STRIPE_WEBHOOK_SECRET;
});

/* ======================================================================== */
/* 1. CAMINOS FELICES — lo que NO se puede apagar                           */
/* ======================================================================== */

describe("reembolsos — lo que NO apaga nada", () => {
  it("un reembolso PARCIAL de un impulso activo no lo revoca", async () => {
    const stub = useAdmin({
      payment_events: { insert: { error: null } },
      boosts: { select: { data: BOOST_ROW, error: null }, update: { error: null } },
    });

    const res = await POST(
      signedRequest(refundEvent({ refunded: false, amount_refunded: 300 })),
    );

    expect(res.status).toBe(200);
    // Se devolvió una parte de un servicio que la persona sigue teniendo
    // comprado: apagar los días restantes sería cobrarle el enojo dos veces.
    expect(revocaciones(stub)).toHaveLength(0);
    expect(mocks.createNotification).not.toHaveBeenCalled();
    // Pero queda el aviso: un parcial no se procesa en silencio.
    expect(warnSpy).toHaveBeenCalled();
  });

  it("una disputa recién abierta no apaga NADA, ni siquiera del producto que identifica", async () => {
    const stub = useAdmin({
      payment_events: { insert: { error: null } },
      boosts: { select: { data: BOOST_ROW, error: null }, update: { error: null } },
    });

    const res = await POST(signedRequest(disputeEvent()));

    expect(res.status).toBe(200);
    // La plata está RETENIDA, no perdida, y la disputa se puede ganar. Como no
    // atendemos `charge.dispute.closed`, apagar acá no tendría vuelta.
    expect(revocaciones(stub)).toHaveLength(0);
    expect(mocks.createNotification).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled(); // alerta fuerte para responder con evidencia
  });

  it("el reembolso TOTAL del cobro de una suscripción no da de baja nada", async () => {
    // Una factura de suscripción no nace de una Checkout Session de pago único:
    // el puente `payment_intent → Session` no devuelve nada.
    mocks.listSessions.mockResolvedValue({ data: [] });
    const stub = useAdmin({
      payment_events: { insert: { error: null } },
      store_memberships: {
        select: {
          data: [{ id: "sm-1", tenant_id: TENANT, owner_id: BUYER, status: "active" }],
          error: null,
        },
        update: { error: null },
      },
      business_accounts: { update: { error: null } },
      listing_premiums: { update: { error: null } },
    });

    const res = await POST(signedRequest(refundEvent()));

    expect(res.status).toBe(200);
    // Quien da de baja una suscripción es customer.subscription.updated/.deleted,
    // que es donde Stripe pone la decisión DESPUÉS de reintentar el cobro.
    expect(revocaciones(stub)).toHaveLength(0);
    // La alerta nombra el producto afectado: sin eso no es accionable.
    expect(errorSpy).toHaveBeenCalled();
    const alerta = errorSpy.mock.calls.map((c: unknown[]) => String(c[0])).join(" ");
    expect(alerta).toContain("store_membership sm-1");
  });

  it("si Stripe no responde la consulta de la Session, NO se revoca a ciegas", async () => {
    mocks.listSessions.mockRejectedValue(new Error("connection error"));
    const stub = useAdmin({
      payment_events: { insert: { error: null } },
      boosts: { select: { data: BOOST_ROW, error: null }, update: { error: null } },
    });

    const res = await POST(signedRequest(refundEvent()));

    expect(res.status).toBe(200);
    expect(revocaciones(stub)).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalled();
  });

  it("todos estos eventos cierran con 200 y quedan marcados como procesados", async () => {
    const stub = useAdmin({
      payment_events: { insert: { error: null } },
      boosts: { select: { data: BOOST_ROW, error: null }, update: { error: null } },
    });

    const res = await POST(
      signedRequest(refundEvent({ refunded: false, amount_refunded: 1 })),
    );

    expect(res.status).toBe(200);
    expect(callsTo(stub, "payment_events", "insert")).toHaveLength(1);
    expect(callsTo(stub, "payment_events", "update")).toHaveLength(1);
  });
});

/* ======================================================================== */
/* 2. REVOCACIÓN — el único caso inequívoco                                 */
/* ======================================================================== */

describe("reembolsos — el reembolso total de un pago único sí apaga", () => {
  it("devuelto el 100% de un impulso activo → se cancela, se avisa y queda auditado", async () => {
    const stub = useAdmin({
      payment_events: { insert: { error: null } },
      boosts: { select: { data: BOOST_ROW, error: null }, update: { error: null } },
      audit_log: { insert: { error: null } },
    });

    const res = await POST(signedRequest(refundEvent()));

    expect(res.status).toBe(200);
    const updates = callsTo(stub, "boosts", "update");
    expect(updates).toHaveLength(1);
    expect(updates[0].args[0]).toMatchObject({ status: "canceled" });
    // `ends_at` se cierra hoy: el impulso terminó, no se consumió entero.
    expect(updates[0].args[0]).toHaveProperty("ends_at");
    // El UPDATE lleva `.eq('status','active')`: dos entregas del mismo evento no
    // pueden escribir dos veces.
    const eqs = callsTo(stub, "boosts", "eq").map((c) => c.args);
    expect(eqs).toContainEqual(["status", "active"]);
    expect(mocks.createNotification).toHaveBeenCalledTimes(1);
    expect(callsTo(stub, "audit_log", "insert")).toHaveLength(1);
  });

  it("devuelto el 100% de una campaña de post activa → misma disciplina", async () => {
    mocks.listSessions.mockResolvedValue({ data: [PROMO_SESSION] });
    const stub = useAdmin({
      payment_events: { insert: { error: null } },
      post_promotions: { select: { data: PROMO_ROW, error: null }, update: { error: null } },
      audit_log: { insert: { error: null } },
    });

    const res = await POST(signedRequest(refundEvent()));

    expect(res.status).toBe(200);
    const updates = callsTo(stub, "post_promotions", "update");
    expect(updates).toHaveLength(1);
    expect(updates[0].args[0]).toMatchObject({ status: "canceled" });
    expect(mocks.createNotification).toHaveBeenCalledTimes(1);
  });

  it("reentregado el mismo reembolso sobre un impulso ya cancelado, no revoca ni notifica dos veces", async () => {
    const stub = useAdmin({
      payment_events: { insert: { error: null } },
      boosts: {
        select: { data: { ...BOOST_ROW, status: "canceled" }, error: null },
        update: { error: null },
      },
    });

    const res = await POST(signedRequest(refundEvent()));

    expect(res.status).toBe(200);
    expect(callsTo(stub, "boosts", "update")).toHaveLength(0);
    expect(mocks.createNotification).not.toHaveBeenCalled();
  });

  it("NO revoca si la Session del cobro no es la vinculada a la fila", async () => {
    const stub = useAdmin({
      payment_events: { insert: { error: null } },
      boosts: {
        select: {
          data: { ...BOOST_ROW, stripe_checkout_session_id: "cs_test_OTRA" },
          error: null,
        },
        update: { error: null },
      },
    });

    const res = await POST(signedRequest(refundEvent()));

    expect(res.status).toBe(200);
    // Misma exigencia que la activación: sin el vínculo verificado, un reembolso
    // propio podría apagar un impulso ajeno.
    expect(callsTo(stub, "boosts", "update")).toHaveLength(0);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("si falla la escritura de la revocación responde 500 para que Stripe reintente", async () => {
    const stub = useAdmin({
      payment_events: { insert: { error: null } },
      boosts: {
        select: { data: BOOST_ROW, error: null },
        update: { error: { code: "08006" } },
      },
    });

    const res = await POST(signedRequest(refundEvent()));

    // Es el ÚNICO fallo de este módulo que sí se arregla reintentando.
    expect(res.status).toBe(500);
    expect(callsTo(stub, "payment_events", "update")).toHaveLength(1);
    expect(callsTo(stub, "payment_events", "update")[0].args[0]).toMatchObject({
      processed: false,
    });
  });
});
