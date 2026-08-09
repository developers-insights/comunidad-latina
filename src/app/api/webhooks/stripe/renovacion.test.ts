import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * =============================================================================
 * RENOVACIONES (`invoice.paid`) — el observador que NO decide
 * =============================================================================
 *
 * Los tres productos por suscripción se cobran solos mes a mes y ese cobro no
 * pasaba por ninguna verificación. Lo que se agregó NO es un control que pueda
 * frenar una renovación —eso apagaría el servicio de alguien que pagó, ver el
 * encabezado de `lib/monetization/renovacion.ts`—: es un observador que
 * correlaciona, registra y avisa.
 *
 * Este suite fija las dos mitades de esa decisión:
 *  · LO QUE SÍ HACE: encuentra la fila por `stripe_subscription_id`, deja una
 *    línea de registro por ciclo, alerta si el snapshot de metadata ya no
 *    coincide con la fila, y avisa si el monto del ciclo se corrió del pactado.
 *  · LO QUE NUNCA HACE, que es lo que de verdad protege al usuario: escribir.
 *    Ni status, ni fechas, ni precios — y nunca un 500 sobre un cobro exitoso.
 */

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  createNotification: vi.fn(),
}));

vi.mock("@/lib/config/services", () => ({ isStripeConfigured: true }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/notifications/notify", () => ({ createNotification: mocks.createNotification }));

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

/**
 * Toda escritura fuera de `payment_events`. El inbox de idempotencia SÍ se
 * escribe (lo hace el route handler antes de delegar); lo que este observador
 * tiene prohibido es tocar las tablas de los productos.
 */
function escriturasDeProducto(stub: ReturnType<typeof createAdminStub>) {
  return stub.calls.filter(
    (c) =>
      c.table !== "payment_events" &&
      (c.method === "insert" || c.method === "update" || c.method === "upsert"),
  );
}

function tablasLeidas(stub: ReturnType<typeof createAdminStub>) {
  return stub.calls.filter((c) => c.method === "select").map((c) => c.table);
}

/* -------------------------------- Fixtures -------------------------------- */

const TENANT = "tenant-1";
const OWNER = "owner-1";
const SUB = "sub_renovacion_1";

function invoiceEvent(
  overrides: Record<string, unknown> = {},
  metadata: Record<string, string> | null = {
    kind: "store_membership",
    tenant_id: TENANT,
    owner_id: OWNER,
    store_id: "store-1",
    price_cents: "1000",
    price_currency: "USD",
  },
  type = "invoice.paid",
) {
  return {
    id: `evt_${Math.random().toString(36).slice(2)}`,
    type,
    data: {
      object: {
        id: "in_test_1",
        object: "invoice",
        amount_paid: 1_000,
        currency: "usd",
        billing_reason: "subscription_cycle",
        customer: "cus_1",
        parent: {
          type: "subscription_details",
          subscription_details: { subscription: SUB, metadata },
        },
        ...overrides,
      },
    },
  };
}

const MEMBERSHIP_ROW = {
  id: "membership-1",
  tenant_id: TENANT,
  owner_id: OWNER,
  price_cents: 1_000,
  // `tenant_prices` guarda la moneda en MAYÚSCULAS y Stripe la manda en
  // minúsculas: la fila puede tener cualquiera de las dos formas.
  currency: "USD",
};

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

function logged(spy: ReturnType<typeof vi.spyOn>) {
  return spy.mock.calls.map((call: unknown[]) => call.join(" ")).join("\n");
}

function useMembresia(row: unknown = MEMBERSHIP_ROW) {
  return useAdmin({
    payment_events: { insert: { error: null } },
    store_memberships: { select: { data: row, error: null } },
  });
}

/* ----------------------------- 1. El registro ----------------------------- */

describe("renovación — registro del ciclo", () => {
  it("deja una línea con producto, fila, tenant, dueño, factura y monto", async () => {
    useMembresia();

    const res = await POST(signedRequest(invoiceEvent()));

    expect(res.status).toBe(200);
    const linea = logged(infoSpy);
    // Sin esto, reconciliar un ciclo obliga a abrir el Dashboard a ciegas.
    expect(linea).toContain("store_membership");
    expect(linea).toContain("membership-1");
    expect(linea).toContain(TENANT);
    expect(linea).toContain(OWNER);
    expect(linea).toContain("in_test_1");
    expect(linea).toContain(SUB);
  });

  it("la correlación es por `stripe_subscription_id`, no por la metadata", async () => {
    const stub = useMembresia();

    await POST(signedRequest(invoiceEvent()));

    const eqs = stub.calls.filter((c) => c.table === "store_memberships" && c.method === "eq");
    expect(eqs[0]?.args).toEqual(["stripe_subscription_id", SUB]);
  });

  it("una suscripción que no conocemos se avisa y no se escribe nada", async () => {
    const stub = useMembresia(null);

    const res = await POST(signedRequest(invoiceEvent()));

    expect(res.status).toBe(200);
    expect(escriturasDeProducto(stub)).toHaveLength(0);
    expect(logged(warnSpy)).toContain("in_test_1");
  });
});

/* ----------------- 2. LO QUE NUNCA HACE: escribir ni romper --------------- */

describe("renovación — el observador no decide", () => {
  it("un ciclo normal no escribe en ninguna tabla de producto", async () => {
    const stub = useMembresia();

    await POST(signedRequest(invoiceEvent()));

    expect(escriturasDeProducto(stub)).toHaveLength(0);
    expect(mocks.createNotification).not.toHaveBeenCalled();
  });

  it("un ciclo cobrado a OTRO precio tampoco escribe: avisa y sigue", async () => {
    // La comunidad subió el precio y migró las suscripciones. Es legítimo.
    const stub = useMembresia();

    const res = await POST(signedRequest(invoiceEvent({ amount_paid: 2_500 })));

    expect(res.status).toBe(200);
    expect(escriturasDeProducto(stub)).toHaveLength(0);
    const aviso = logged(warnSpy);
    expect(aviso).toContain("2500");
    expect(aviso).toContain("1000");
    // Y se dice con todas las letras que NO es un rechazo, para que el próximo
    // que lea el log no salga a "arreglar" un cobro que está bien.
    expect(aviso).toContain("NO es un rechazo");
  });

  it("un ciclo en otra moneda avisa, pero tampoco escribe", async () => {
    const stub = useMembresia();

    await POST(signedRequest(invoiceEvent({ currency: "eur" })));

    expect(escriturasDeProducto(stub)).toHaveLength(0);
    expect(logged(warnSpy)).toContain("eur");
  });

  it("la moneda se compara NORMALIZADA: fila en 'USD' y Stripe en 'usd' no avisa", async () => {
    // Que el case disparara una alarma sería ruido puro: `tenant_prices` guarda
    // MAYÚSCULAS (0072) y Stripe manda minúsculas, siempre.
    useMembresia();

    await POST(signedRequest(invoiceEvent()));

    expect(logged(warnSpy)).not.toContain("AVISO");
  });

  it("una PRORRATA no dispara el aviso de precio", async () => {
    // `subscription_update` es una factura por medio mes: TIENE que dar
    // distinto. Avisar acá sería gritar por un número correcto.
    useMembresia();

    await POST(
      signedRequest(invoiceEvent({ amount_paid: 512, billing_reason: "subscription_update" })),
    );

    expect(logged(warnSpy)).not.toContain("AVISO");
  });

  it("la PRIMERA factura tampoco: ese monto ya lo verificó el alta", async () => {
    useMembresia();

    await POST(
      signedRequest(invoiceEvent({ amount_paid: 2_500, billing_reason: "subscription_create" })),
    );

    expect(logged(warnSpy)).not.toContain("AVISO");
  });

  it("un fallo de lectura de la base NO convierte el cobro en un 500", async () => {
    const stub = useAdmin({
      payment_events: { insert: { error: null } },
      store_memberships: { select: { data: null, error: { code: "57014" } } },
    });

    const res = await POST(signedRequest(invoiceEvent()));

    // Lo único que se pierde es la línea de registro; el payload íntegro ya
    // quedó guardado. Un 500 pondría a Stripe reintentando una factura paga.
    expect(res.status).toBe(200);
    expect(escriturasDeProducto(stub)).toHaveLength(0);
    expect(logged(warnSpy)).toContain("57014");
  });

  it("`invoice.payment_succeeded` NO se atiende: es el mismo peso", async () => {
    // Stripe emite los dos por el mismo cobro. Atender ambos duplicaría cada
    // línea de registro y cada aviso.
    const stub = useMembresia();

    const res = await POST(
      signedRequest(invoiceEvent({}, undefined, "invoice.payment_succeeded")),
    );

    expect(res.status).toBe(200);
    expect(logged(infoSpy)).not.toContain("[pagos:renovacion]");
    expect(escriturasDeProducto(stub)).toHaveLength(0);
  });
});

/* -------------------- 3. El snapshot contra nuestra fila ------------------ */

describe("renovación — correlación de tenant y dueño", () => {
  it("ALERTA si la suscripción quedó apuntando a otro dueño", async () => {
    const stub = useMembresia({ ...MEMBERSHIP_ROW, owner_id: "otro-vecino" });

    const res = await POST(signedRequest(invoiceEvent()));

    expect(res.status).toBe(200);
    const alerta = logged(errorSpy);
    expect(alerta).toContain("ALERTA");
    expect(alerta).toContain("otro-vecino");
    // Alerta, no corrección: este módulo no escribe.
    expect(escriturasDeProducto(stub)).toHaveLength(0);
  });

  it("ALERTA si la suscripción quedó apuntando a otra comunidad", async () => {
    useMembresia({ ...MEMBERSHIP_ROW, tenant_id: "tenant-2" });

    await POST(signedRequest(invoiceEvent()));

    expect(logged(errorSpy)).toContain("ALERTA");
  });
});

/* ------------------------ 4. Los otros dos productos ---------------------- */

describe("renovación — los tres productos por suscripción", () => {
  it("el premium de un aviso se busca en `listing_premiums`", async () => {
    const stub = useAdmin({
      payment_events: { insert: { error: null } },
      listing_premiums: {
        select: {
          data: {
            id: "premium-1",
            tenant_id: TENANT,
            owner_id: OWNER,
            price_cents: 900,
            currency: "usd",
          },
          error: null,
        },
      },
    });

    await POST(
      signedRequest(
        invoiceEvent({ amount_paid: 900 }, {
          kind: "listing_premium",
          tenant_id: TENANT,
          owner_id: OWNER,
          listing_id: "listing-1",
        }),
      ),
    );

    expect(tablasLeidas(stub)).toContain("listing_premiums");
    // Y no se pasea por las otras dos: el `kind` de la metadata ya lo dijo.
    expect(tablasLeidas(stub)).not.toContain("store_memberships");
    expect(logged(infoSpy)).toContain("premium-1");
  });

  it("Presencia Verificada se busca en `business_accounts` y no avisa de precio", async () => {
    const stub = useAdmin({
      payment_events: { insert: { error: null } },
      business_accounts: {
        select: { data: { id: "cuenta-1", tenant_id: TENANT, owner_id: OWNER }, error: null },
      },
    });

    await POST(
      signedRequest(
        invoiceEvent({ amount_paid: 4_900 }, {
          plan: "destacado",
          tenant_id: TENANT,
          owner_id: OWNER,
          business_account_id: "cuenta-1",
        }),
      ),
    );

    expect(tablasLeidas(stub)).toContain("business_accounts");
    expect(logged(infoSpy)).toContain("cuenta-1");
    // `business_accounts` no tiene columnas de precio: no hay contra qué
    // comparar, y compararlo contra una constante del código sería repetir el
    // bug que 0072 vino a arreglar.
    expect(logged(warnSpy)).not.toContain("AVISO");
  });

  it("sin metadata legible se prueban las tres tablas antes de rendirse", async () => {
    // Una suscripción vieja, o creada a mano desde el Dashboard, igual tiene que
    // poder registrarse.
    const stub = useAdmin({ payment_events: { insert: { error: null } } });

    await POST(signedRequest(invoiceEvent({}, null)));

    const leidas = tablasLeidas(stub);
    expect(leidas).toContain("store_memberships");
    expect(leidas).toContain("listing_premiums");
    expect(leidas).toContain("business_accounts");
  });

  it("una factura suelta (sin suscripción) se registra y no busca nada", async () => {
    const stub = useAdmin({ payment_events: { insert: { error: null } } });

    const res = await POST(signedRequest(invoiceEvent({ parent: null })));

    expect(res.status).toBe(200);
    expect(tablasLeidas(stub)).not.toContain("store_memberships");
    expect(logged(warnSpy)).toContain("in_test_1");
  });
});
