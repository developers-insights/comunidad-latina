import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * =============================================================================
 * PREMIUM DE UNA PUBLICACIÓN — webhook de punta a punta, con FIRMA REAL
 * =============================================================================
 *
 * No hay clave de Stripe en este proyecto y no la va a haber hasta que alguien
 * la cargue a mano, así que NADA de esto se probó contra Stripe. Lo que sí se
 * puede probar sin clave —y es lo que hace este suite— es el 100% de nuestro
 * lado del contrato:
 *
 *  · LA FIRMA ES DE VERDAD. `constructEvent` no está mockeado: se instancia el
 *    SDK real con una clave dummy (construir el cliente no toca la red) y los
 *    fixtures se firman con `generateTestHeaderString`, que hace el mismo HMAC
 *    que hace Stripe. El test del body manipulado prueba que la verificación
 *    rechaza de verdad, no que un mock devolvió false.
 *  · IDEMPOTENCIA: un evento repetido no concede dos veces.
 *  · CORRELACIÓN FISCAL (R3): monto que no coincide, o aviso que no es de quien
 *    dice la metadata → no se concede y queda la alerta para reconciliar.
 *  · EL CAMINO DE BAJA, que es el que rompe plata: cancelación → `canceled` +
 *    `current_period_end` leído de los ITEMS de la suscripción.
 *
 * El efecto sobre `listings.tier` NO se testea acá porque no lo hace este código:
 * lo hace `app.mirror_listing_tier()` (0054), y eso se verificó ejecutándolo
 * contra la base real.
 */

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  createNotification: vi.fn(),
}));

vi.mock("@/lib/config/services", () => ({ isStripeConfigured: true }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/notifications/notify", () => ({ createNotification: mocks.createNotification }));

// El SDK REAL con una clave dummy: `new Stripe(...)` no hace ninguna request, y
// `webhooks.constructEvent` queda siendo el código de verdad.
vi.mock("@/lib/stripe", async () => {
  const StripeCtor = (await import("stripe")).default;
  const stripe = new StripeCtor("sk_test_dummy_para_firmar_fixtures");
  return { getStripe: () => stripe, PLAN_IDS: ["basico", "destacado", "pro"] };
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

/**
 * Query builder falso y encadenable. A diferencia del stub de route.test.ts, la
 * operación RAÍZ se fija en la primera llamada: `update().eq().select()` tiene
 * que resolver como `update`, no como `select`, porque es así como
 * `updatePremiumBySubscription` lee la fila que acaba de tocar.
 */
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

/* -------------------------------- Fixtures -------------------------------- */

const TENANT = "tenant-1";
const LISTING = "listing-1";
const OWNER = "owner-1";

/** El aviso tal como lo ve el webhook al correlacionar. */
const LISTING_ROW = { id: LISTING, tenant_id: TENANT, created_by: OWNER };

function checkoutEvent(sessionOverrides: Record<string, unknown> = {}) {
  return {
    id: `evt_${Math.random().toString(36).slice(2)}`,
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_test_premium_1",
        payment_status: "paid",
        amount_total: 900,
        customer: "cus_1",
        subscription: "sub_premium_1",
        metadata: {
          kind: "listing_premium",
          tenant_id: TENANT,
          listing_id: LISTING,
          owner_id: OWNER,
        },
        ...sessionOverrides,
      },
    },
  };
}

function subscriptionEvent(
  type: "customer.subscription.updated" | "customer.subscription.deleted",
  overrides: Record<string, unknown> = {},
) {
  return {
    id: `evt_${Math.random().toString(36).slice(2)}`,
    type,
    data: {
      object: {
        id: "sub_premium_1",
        status: "active",
        cancel_at_period_end: false,
        items: { data: [{ current_period_end: 1_800_000_000 }] },
        metadata: { kind: "listing_premium" },
        ...overrides,
      },
    },
  };
}

/** Request con firma REAL, calculada con el mismo HMAC que usa Stripe. */
function signedRequest(event: unknown, tamperedBody?: string) {
  const rawBody = JSON.stringify(event);
  const signature = signer.webhooks.generateTestHeaderString({
    payload: rawBody,
    secret: WEBHOOK_SECRET,
  });
  return new Request("https://app.test/api/webhooks/stripe", {
    method: "POST",
    headers: new Headers({ "stripe-signature": signature }),
    // Si viene `tamperedBody`, la firma es de OTRO contenido: es el ataque real.
    body: tamperedBody ?? rawBody,
  });
}

let errorSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
  mocks.createNotification.mockResolvedValue({ ok: true });
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
  warnSpy.mockRestore();
  delete process.env.STRIPE_WEBHOOK_SECRET;
});

/* ----------------------- 1. Firma real (no mockeada) ---------------------- */

describe("premium — verificación de firma con HMAC real", () => {
  it("acepta un fixture firmado de verdad y concede el premium", async () => {
    const stub = useAdmin({
      payment_events: { insert: { error: null } },
      listings: { select: { data: LISTING_ROW, error: null } },
      listing_premiums: { select: { data: null, error: null }, upsert: { error: null } },
    });

    const res = await POST(signedRequest(checkoutEvent()));

    expect(res.status).toBe(200);
    const upserts = callsTo(stub, "listing_premiums", "upsert");
    expect(upserts).toHaveLength(1);
    expect(upserts[0].args[0]).toMatchObject({
      tenant_id: TENANT,
      listing_id: LISTING,
      owner_id: OWNER,
      status: "active",
      cancel_at_period_end: false,
      stripe_subscription_id: "sub_premium_1",
      stripe_checkout_session_id: "cs_test_premium_1",
    });
    // Comprobante a quien pagó.
    expect(mocks.createNotification).toHaveBeenCalledTimes(1);
  });

  it("rechaza un body MANIPULADO aunque la firma sea de un evento válido", async () => {
    const stub = useAdmin({
      payment_events: { insert: { error: null } },
      listings: { select: { data: LISTING_ROW, error: null } },
      listing_premiums: { upsert: { error: null } },
    });

    // Se firma el evento honesto y se manda otro cuerpo: el ataque de manual.
    const tampered = JSON.stringify(checkoutEvent({ amount_total: 1 }));
    const res = await POST(signedRequest(checkoutEvent(), tampered));

    expect(res.status).toBe(400);
    // Cero escrituras: ni siquiera se registró el evento.
    expect(stub.calls).toHaveLength(0);
  });
});

/* --------------------------- 2. Correlación fiscal ------------------------ */

describe("premium — correlación (fiscal R3)", () => {
  it("NO concede si el monto cobrado no es el esperado", async () => {
    const stub = useAdmin({
      payment_events: { insert: { error: null } },
      listings: { select: { data: LISTING_ROW, error: null } },
      listing_premiums: { select: { data: { price_cents: 900 }, error: null }, upsert: { error: null } },
    });

    const res = await POST(signedRequest(checkoutEvent({ amount_total: 100 })));

    // 200 para que Stripe no reintente: reintentar no arregla una discrepancia
    // de monto. Queda el payload en payment_events para reconciliar a mano.
    expect(res.status).toBe(200);
    expect(callsTo(stub, "listing_premiums", "upsert")).toHaveLength(0);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("NO concede si el aviso cambió de dueño entre el checkout y el webhook", async () => {
    const stub = useAdmin({
      payment_events: { insert: { error: null } },
      listings: { select: { data: { ...LISTING_ROW, created_by: "otro" }, error: null } },
      listing_premiums: { upsert: { error: null } },
    });

    const res = await POST(signedRequest(checkoutEvent()));

    expect(res.status).toBe(200);
    expect(callsTo(stub, "listing_premiums", "upsert")).toHaveLength(0);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("NO concede si el aviso ya no existe (plata cobrada sin sujeto)", async () => {
    const stub = useAdmin({
      payment_events: { insert: { error: null } },
      listings: { select: { data: null, error: null } },
      listing_premiums: { upsert: { error: null } },
    });

    const res = await POST(signedRequest(checkoutEvent()));

    expect(res.status).toBe(200);
    expect(callsTo(stub, "listing_premiums", "upsert")).toHaveLength(0);
  });

  it("un checkout sin pagar (método async) todavía no concede nada", async () => {
    const stub = useAdmin({
      payment_events: { insert: { error: null } },
      listings: { select: { data: LISTING_ROW, error: null } },
      listing_premiums: { upsert: { error: null } },
    });

    const res = await POST(signedRequest(checkoutEvent({ payment_status: "unpaid" })));

    expect(res.status).toBe(200);
    // Espera a checkout.session.async_payment_succeeded.
    expect(callsTo(stub, "listing_premiums", "upsert")).toHaveLength(0);
  });
});

/* ------------------------------ 3. Idempotencia --------------------------- */

describe("premium — idempotencia", () => {
  it("un evento ya procesado es no-op: no concede dos veces", async () => {
    const stub = useAdmin({
      payment_events: {
        insert: { error: { code: "23505" } },
        select: { data: { processed: true }, error: null },
      },
      listings: { select: { data: LISTING_ROW, error: null } },
      listing_premiums: { upsert: { error: null } },
    });

    const res = await POST(signedRequest(checkoutEvent()));
    const body = (await res.json()) as { duplicated?: boolean };

    expect(res.status).toBe(200);
    expect(body.duplicated).toBe(true);
    expect(callsTo(stub, "listing_premiums", "upsert")).toHaveLength(0);
    expect(mocks.createNotification).not.toHaveBeenCalled();
  });

  it("un intento previo que murió a mitad (processed=false) SÍ se completa", async () => {
    const stub = useAdmin({
      payment_events: {
        insert: { error: { code: "23505" } },
        select: { data: { processed: false }, error: null },
      },
      listings: { select: { data: LISTING_ROW, error: null } },
      listing_premiums: { select: { data: null, error: null }, upsert: { error: null } },
    });

    const res = await POST(signedRequest(checkoutEvent()));

    expect(res.status).toBe(200);
    expect(callsTo(stub, "listing_premiums", "upsert")).toHaveLength(1);
  });
});

/* ------------------ 4. EL CAMINO DE BAJA (el que rompe plata) ------------- */

describe("premium — baja y vencimiento", () => {
  it("una cancelación baja la fila a `canceled` y apaga el flag de renovación", async () => {
    const stub = useAdmin({
      payment_events: { insert: { error: null } },
      listing_premiums: {
        update: {
          data: { id: "p1", tenant_id: TENANT, owner_id: OWNER, listing_id: LISTING },
          error: null,
        },
      },
    });

    const res = await POST(
      signedRequest(subscriptionEvent("customer.subscription.deleted", { status: "canceled" })),
    );

    expect(res.status).toBe(200);
    const updates = callsTo(stub, "listing_premiums", "update");
    expect(updates).toHaveLength(1);
    expect(updates[0].args[0]).toMatchObject({
      status: "canceled",
      // Ya terminó: no puede quedar prometiendo una fecha futura.
      cancel_at_period_end: false,
      // LA LÍNEA QUE ESTE REPO YA PAGÓ UNA VEZ: sale de items[].current_period_end.
      // Si quedara NULL, el cron no vencería la fila nunca.
      current_period_end: new Date(1_800_000_000 * 1000).toISOString(),
    });
    // Y se le avisa a la persona que su aviso volvió a ser gratuito.
    expect(mocks.createNotification).toHaveBeenCalledTimes(1);
  });

  it("cancelar la renovación NO apaga nada todavía: sigue `active` con la fecha de corte", async () => {
    const stub = useAdmin({
      payment_events: { insert: { error: null } },
      listing_premiums: {
        update: {
          data: { id: "p1", tenant_id: TENANT, owner_id: OWNER, listing_id: LISTING },
          error: null,
        },
      },
    });

    await POST(
      signedRequest(
        subscriptionEvent("customer.subscription.updated", { cancel_at_period_end: true }),
      ),
    );

    const patch = callsTo(stub, "listing_premiums", "update")[0].args[0];
    // Se cobró el mes: el aviso sigue premium hasta que termine.
    expect(patch).toMatchObject({ status: "active", cancel_at_period_end: true });
    // Nada de notificación de baja: todavía no bajó nada.
    expect(mocks.createNotification).not.toHaveBeenCalled();
  });

  it("un pago rebotado deja `past_due` (no apaga) y avisa para cambiar la tarjeta", async () => {
    const stub = useAdmin({
      payment_events: { insert: { error: null } },
      listing_premiums: {
        update: {
          data: { id: "p1", tenant_id: TENANT, owner_id: OWNER, listing_id: LISTING },
          error: null,
        },
      },
    });

    await POST(
      signedRequest(subscriptionEvent("customer.subscription.updated", { status: "past_due" })),
    );

    expect(callsTo(stub, "listing_premiums", "update")[0].args[0]).toMatchObject({
      status: "past_due",
    });
    expect(mocks.createNotification).toHaveBeenCalledTimes(1);
  });

  it("una suscripción que no es nuestra no rompe ni escribe de más", async () => {
    const stub = useAdmin({
      payment_events: { insert: { error: null } },
      listing_premiums: { update: { data: null, error: null } },
    });

    const res = await POST(
      signedRequest(subscriptionEvent("customer.subscription.deleted", { status: "canceled" })),
    );

    // Sin throw: reintentar no la va a hacer aparecer.
    expect(res.status).toBe(200);
    // Se INTENTÓ el update filtrando por stripe_subscription_id —esa es la
    // correlación real— y no matcheó ninguna fila. Por eso no se notifica a
    // nadie: no hay a quién.
    expect(callsTo(stub, "listing_premiums", "update")).toHaveLength(1);
    expect(mocks.createNotification).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
  });
});

/* --------------- 5. No se pisa con los otros flujos de pago --------------- */

describe("premium — aislamiento de los otros productos", () => {
  it("un evento de membresía de tienda NO lo toma el flujo de premium", async () => {
    const stub = useAdmin({
      payment_events: { insert: { error: null } },
      store_memberships: { select: { data: null, error: null }, upsert: { error: null } },
      listing_premiums: { upsert: { error: null }, update: { data: null, error: null } },
    });

    // Metadata y monto REALES de una tienda (USD 10, `store_id` en vez de
    // `listing_id`): si se le manda el fixture de premium con otro `kind`, la
    // membresía lo rechaza por correlación y el test pasaría por el motivo
    // equivocado.
    await POST(
      signedRequest(
        checkoutEvent({
          amount_total: 1_000,
          metadata: {
            kind: "store_membership",
            tenant_id: TENANT,
            store_id: LISTING,
            owner_id: OWNER,
          },
        }),
      ),
    );

    expect(callsTo(stub, "listing_premiums", "upsert")).toHaveLength(0);
    expect(callsTo(stub, "store_memberships", "upsert")).toHaveLength(1);
  });
});
