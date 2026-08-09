import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * =============================================================================
 * MEMBRESÍA DE TIENDA — webhook de punta a punta, con FIRMA REAL
 * =============================================================================
 *
 * Mismo patrón (y mismo porqué) que `premium.test.ts`: no hay clave de Stripe en
 * el proyecto, así que nada de esto se probó contra Stripe — pero sí se prueba el
 * 100% de nuestro lado del contrato, con `constructEvent` SIN mockear y los
 * fixtures firmados con el mismo HMAC que hace Stripe.
 *
 * Lo que fija este suite:
 *  · EL CAMINO FELIZ, primero y explícito: un alta legítima enciende la tienda.
 *    Los tests de rechazo se escribieron DESPUÉS y contra este piso, porque en un
 *    cobro el error caro no es dejar pasar uno malo: es rechazar uno bueno.
 *  · CORRELACIÓN (fiscal R3): la tienda existe, es del tenant de la metadata y
 *    es del dueño que compró. Sin eso, el upsert iba a ciegas sobre `store_id`.
 *  · La asimetría deliberada del ALTA contra la RENOVACIÓN (ver
 *    `lib/monetization/renovacion.ts`): una factura de renovación NUNCA apaga
 *    nada, ni siquiera cuando el monto ya no coincide con el precio del alta.
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

/** Igual que el de `premium.test.ts`: la operación RAÍZ se fija en la primera
 * llamada, así `update().eq().select()` resuelve como `update`. */
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
const STORE = "store-1";
const OWNER = "owner-1";

/** La tienda (un `listing kind='business'`) tal como la ve el webhook. */
const STORE_ROW = { id: STORE, tenant_id: TENANT, created_by: OWNER };

function membershipMetadata(overrides: Record<string, string> = {}) {
  return {
    kind: "store_membership",
    tenant_id: TENANT,
    store_id: STORE,
    owner_id: OWNER,
    // Lo PACTADO al abrir el Checkout, que es lo que escribe
    // `activarMembresiaTienda` con el precio leído de `tenant_prices`.
    price_cents: "1000",
    price_currency: "USD",
    ...overrides,
  };
}

function checkoutEvent(sessionOverrides: Record<string, unknown> = {}) {
  return {
    id: `evt_${Math.random().toString(36).slice(2)}`,
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_test_membresia_1",
        payment_status: "paid",
        amount_total: 1_000,
        currency: "usd",
        customer: "cus_1",
        subscription: "sub_membresia_1",
        metadata: membershipMetadata(),
        ...sessionOverrides,
      },
    },
  };
}

/**
 * Una factura de Stripe. En la API que usa stripe-node 22 (2025-10-29.clover) la
 * suscripción que generó la factura NO está en la raíz: vive en
 * `parent.subscription_details`, junto a un SNAPSHOT inmutable de la metadata de
 * la suscripción al momento de finalizarse la factura.
 */
function invoiceEvent(
  overrides: Record<string, unknown> = {},
  detailsOverrides: Record<string, unknown> = {},
) {
  return {
    id: `evt_${Math.random().toString(36).slice(2)}`,
    type: "invoice.paid",
    data: {
      object: {
        id: "in_test_membresia_1",
        object: "invoice",
        amount_paid: 1_000,
        currency: "usd",
        billing_reason: "subscription_cycle",
        customer: "cus_1",
        parent: {
          type: "subscription_details",
          subscription_details: {
            subscription: "sub_membresia_1",
            metadata: membershipMetadata(),
            ...detailsOverrides,
          },
        },
        ...overrides,
      },
    },
  };
}

/** La membresía tal como la lee el observador de renovaciones. */
const MEMBERSHIP_ROW = {
  id: "membership-1",
  tenant_id: TENANT,
  owner_id: OWNER,
  store_id: STORE,
  price_cents: 1_000,
  currency: "usd",
  status: "active",
};

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

/** Todo lo que un `console.*` escribió, aplanado, para poder buscar dentro. */
function logged(spy: ReturnType<typeof vi.spyOn>) {
  return spy.mock.calls.map((call: unknown[]) => call.join(" ")).join("\n");
}

/* ------------------- 1. EL CAMINO FELIZ (se escribió primero) ------------- */

describe("membresía — alta legítima", () => {
  function useAltaLimpia() {
    return useAdmin({
      payment_events: { insert: { error: null } },
      listings: { select: { data: STORE_ROW, error: null } },
      store_memberships: { select: { data: null, error: null }, upsert: { error: null } },
    });
  }

  it("un alta con todo en orden enciende la tienda y avisa", async () => {
    const stub = useAltaLimpia();

    const res = await POST(signedRequest(checkoutEvent()));

    expect(res.status).toBe(200);
    const upserts = callsTo(stub, "store_memberships", "upsert");
    expect(upserts).toHaveLength(1);
    expect(upserts[0].args[0]).toMatchObject({
      tenant_id: TENANT,
      store_id: STORE,
      owner_id: OWNER,
      status: "active",
      price_cents: 1_000,
      currency: "usd",
      stripe_subscription_id: "sub_membresia_1",
    });
    // Comprobante a quien pagó.
    expect(mocks.createNotification).toHaveBeenCalledTimes(1);
  });

  it("un alta al precio EDITADO por la comunidad (USD 25) también enciende", async () => {
    const stub = useAltaLimpia();

    const res = await POST(
      signedRequest(
        checkoutEvent({
          amount_total: 2_500,
          currency: "usd",
          metadata: membershipMetadata({ price_cents: "2500" }),
        }),
      ),
    );

    expect(res.status).toBe(200);
    const upserts = callsTo(stub, "store_memberships", "upsert");
    expect(upserts).toHaveLength(1);
    // Y lo cobrado queda ESCRITO en la fila: la pantalla del dueño no puede
    // mostrar el default de la columna cuando se pagaron USD 25.
    expect(upserts[0].args[0]).toMatchObject({ price_cents: 2_500, currency: "usd" });
  });

  it("la MONEDA se compara normalizada: metadata en mayúsculas, Stripe en minúsculas", async () => {
    const stub = useAltaLimpia();

    // `tenant_prices` guarda "USD"; Stripe manda "usd". Que el case decidiera si
    // se entrega lo comprado sería absurdo.
    const res = await POST(signedRequest(checkoutEvent({ currency: "usd" })));

    expect(res.status).toBe(200);
    expect(callsTo(stub, "store_memberships", "upsert")).toHaveLength(1);
  });
});

/* --------------- 2. Correlación con la tienda (fiscal R3) ----------------- */

/**
 * EL HUECO QUE ESTOS TESTS FIJAN
 * El handler verificaba monto y moneda, pero hacía `upsert` a ciegas sobre
 * `store_id`: nunca miraba si esa tienda existía, si era del tenant de la
 * metadata o si seguía siendo del `owner_id` que compró. Es el mismo chequeo (a)
 * que el premium de un aviso ya hacía sobre `listings` y que Presencia Verificada
 * ganó después. Hoy no es alcanzable desde la app —la action exige
 * `created_by = user.id` antes de abrir la Session, y la metadata la firma
 * Stripe—, pero con una tienda borrada o transferida entre el checkout y el
 * webhook la membresía se le concedía al dueño viejo.
 */
describe("membresía — correlación con la tienda", () => {
  function useTienda(row: unknown) {
    return useAdmin({
      payment_events: { insert: { error: null } },
      listings: { select: { data: row, error: null } },
      store_memberships: { select: { data: null, error: null }, upsert: { error: null } },
    });
  }

  it("NO concede si la tienda ya no existe (plata cobrada sin sujeto)", async () => {
    const stub = useTienda(null);

    const res = await POST(signedRequest(checkoutEvent()));

    // 200 para que Stripe no reintente: reintentar no hace aparecer una tienda
    // borrada. El payload queda en `payment_events` para reconciliar a mano.
    expect(res.status).toBe(200);
    expect(callsTo(stub, "store_memberships", "upsert")).toHaveLength(0);
    expect(mocks.createNotification).not.toHaveBeenCalled();
    expect(logged(errorSpy)).toContain(STORE);
  });

  it("NO concede si la tienda es de OTRA comunidad", async () => {
    const stub = useTienda({ ...STORE_ROW, tenant_id: "tenant-2" });

    const res = await POST(signedRequest(checkoutEvent()));

    expect(res.status).toBe(200);
    expect(callsTo(stub, "store_memberships", "upsert")).toHaveLength(0);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("NO concede si la tienda cambió de dueño entre el checkout y el webhook", async () => {
    const stub = useTienda({ ...STORE_ROW, created_by: "otro-vecino" });

    const res = await POST(signedRequest(checkoutEvent()));

    // Si esto concediera, la membresía se le daría al dueño VIEJO: la fila lleva
    // `owner_id` de la metadata, no el dueño real de la tienda.
    expect(res.status).toBe(200);
    expect(callsTo(stub, "store_memberships", "upsert")).toHaveLength(0);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("un fallo de LECTURA sí da 500, para que Stripe reintente", async () => {
    // Un error transitorio de la base SÍ se arregla reintentando: eso no se
    // traga como "la tienda no existe", que sería no conceder algo pagado.
    useAdmin({
      payment_events: { insert: { error: null } },
      listings: { select: { data: null, error: { code: "57014" } } },
      store_memberships: { select: { data: null, error: null }, upsert: { error: null } },
    });

    const res = await POST(signedRequest(checkoutEvent()));

    expect(res.status).toBe(500);
  });
});

/* -------------------- 3. Monto y moneda (lo que ya había) ---------------- */

describe("membresía — monto y moneda", () => {
  function useAltaLimpia() {
    return useAdmin({
      payment_events: { insert: { error: null } },
      listings: { select: { data: STORE_ROW, error: null } },
      store_memberships: { select: { data: null, error: null }, upsert: { error: null } },
    });
  }

  it("NO concede si el monto cobrado no es el PACTADO en esa Session", async () => {
    const stub = useAltaLimpia();

    const res = await POST(signedRequest(checkoutEvent({ amount_total: 1 })));

    expect(res.status).toBe(200);
    expect(callsTo(stub, "store_memberships", "upsert")).toHaveLength(0);
  });

  it("NO concede si la MONEDA no es la pactada, aunque el número coincida", async () => {
    const stub = useAltaLimpia();

    const res = await POST(signedRequest(checkoutEvent({ currency: "ars" })));

    expect(res.status).toBe(200);
    expect(callsTo(stub, "store_memberships", "upsert")).toHaveLength(0);
    expect(logged(errorSpy)).toContain("ars");
  });

  it("un checkout sin pagar (método async) todavía no enciende nada", async () => {
    const stub = useAltaLimpia();

    const res = await POST(signedRequest(checkoutEvent({ payment_status: "unpaid" })));

    expect(res.status).toBe(200);
    expect(callsTo(stub, "store_memberships", "upsert")).toHaveLength(0);
  });
});

/* ------ 4. RENOVACIONES: el camino feliz primero, y es el que manda -------- */

/**
 * LA ASIMETRÍA CON EL ALTA ES DELIBERADA (ver `lib/monetization/renovacion.ts`).
 * Estos dos tests se escribieron ANTES de tocar el código y pasaban con el
 * webhook sin observador de facturas —donde `invoice.paid` simplemente se
 * ignoraba—. Siguen pasando después: son el piso que ningún "control de precio"
 * en las renovaciones tiene permitido romper.
 */
describe("membresía — una renovación nunca apaga la tienda", () => {
  function useRenovacion(row: unknown = MEMBERSHIP_ROW) {
    return useAdmin({
      payment_events: { insert: { error: null } },
      store_memberships: { select: { data: row, error: null } },
    });
  }

  it("una renovación normal responde 200 y no toca el estado", async () => {
    const stub = useRenovacion();

    const res = await POST(signedRequest(invoiceEvent()));

    expect(res.status).toBe(200);
    expect(callsTo(stub, "store_memberships", "update")).toHaveLength(0);
    expect(callsTo(stub, "store_memberships", "upsert")).toHaveLength(0);
    expect(mocks.createNotification).not.toHaveBeenCalled();
  });

  it("una renovación MÁS CARA que el alta tampoco apaga nada", async () => {
    // El precio que rige una renovación es el de la suscripción EN STRIPE, no el
    // que quedó escrito en la fila el día del alta. Rechazar acá por
    // "discrepancia de monto" sería apagarle la tienda a alguien que pagó.
    const stub = useRenovacion();

    const res = await POST(signedRequest(invoiceEvent({ amount_paid: 2_500 })));

    expect(res.status).toBe(200);
    expect(callsTo(stub, "store_memberships", "update")).toHaveLength(0);
    expect(callsTo(stub, "store_memberships", "upsert")).toHaveLength(0);
  });

  it("una renovación en otra MONEDA tampoco apaga nada", async () => {
    // Una comunidad que se pasa de USD a EUR y migra sus suscripciones es un
    // cambio legítimo. Lo que corresponde es avisar, jamás cortar el servicio.
    const stub = useRenovacion();

    const res = await POST(signedRequest(invoiceEvent({ currency: "eur" })));

    expect(res.status).toBe(200);
    expect(callsTo(stub, "store_memberships", "update")).toHaveLength(0);
  });

  it("una factura de una suscripción que no conocemos no rompe el webhook", async () => {
    const stub = useRenovacion(null);

    const res = await POST(signedRequest(invoiceEvent()));

    expect(res.status).toBe(200);
    expect(callsTo(stub, "store_memberships", "update")).toHaveLength(0);
  });

  it("una factura ilegible (sin suscripción) tampoco rompe el webhook", async () => {
    const stub = useRenovacion();

    const res = await POST(signedRequest(invoiceEvent({ parent: null })));

    expect(res.status).toBe(200);
    expect(callsTo(stub, "store_memberships", "update")).toHaveLength(0);
  });

  it("un fallo de lectura de la base NO convierte un cobro exitoso en 500", async () => {
    // El observador no concede nada: si no puede leer, lo peor que pasa es que
    // falte una línea de registro. Devolver 500 pondría a Stripe reintentando
    // tres días una factura que YA está paga.
    useAdmin({
      payment_events: { insert: { error: null } },
      store_memberships: { select: { data: null, error: { code: "57014" } } },
    });

    const res = await POST(signedRequest(invoiceEvent()));

    expect(res.status).toBe(200);
  });
});
