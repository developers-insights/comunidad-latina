import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * =============================================================================
 * PRESENCIA VERIFICADA — webhook de punta a punta, con FIRMA REAL
 * =============================================================================
 *
 * Mismo contrato y mismo aparato de test que `premium.test.ts`: el SDK real
 * firma los fixtures con `generateTestHeaderString`, así que la verificación de
 * firma que corre acá es la de verdad, no un mock que devuelve `true`.
 *
 * POR QUÉ EXISTE ESTE SUITE
 * Presencia era el único de los cinco productos que concedía sin verificar
 * NADA: no miraba `payment_status`, no miraba el monto ni la moneda, y no
 * correlacionaba el tenant. Un `checkout.session.completed` con
 * `payment_status: "unpaid"` —lo normal en métodos de pago asíncronos— activaba
 * la presencia igual. O sea: se entregaba sin haber cobrado.
 *
 * EL ORDEN DE ESTE ARCHIVO NO ES CASUAL. El riesgo acá es simétrico y opuesto
 * al del premium: hoy concede DE MÁS, y un arreglo demasiado estricto empezaría
 * a rechazar pagos legítimos, que de cara al usuario es peor. Por eso los
 * caminos felices van PRIMERO y son los que mandan: un pago normal —y también
 * el pago asíncrono que se confirma tarde— tiene que seguir activando.
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
 * Query builder falso y encadenable, con la operación RAÍZ fijada en la primera
 * llamada: `update().eq()` resuelve como `update` y `select().eq().maybeSingle()`
 * como `select`, que es como este handler lee la cuenta y después la escribe.
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
    // `or` lo usa el RECLAMO del evento de pago (0111): se toma la fila si
    // `claimed_at` está en null o ya venció.
    builder.or = vi.fn((...args: unknown[]) => {
      calls.push({ table, method: "or", args });
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

/** Las escrituras que CONCEDEN presencia (el update de la cuenta, no el de payment_events). */
function concesiones(stub: ReturnType<typeof createAdminStub>) {
  return callsTo(stub, "business_accounts", "update");
}

/* -------------------------------- Fixtures -------------------------------- */

const TENANT = "tenant-1";
const ACCOUNT = "ba-1";
const OWNER = "owner-1";

/** La cuenta de negocio tal como la ve el webhook al correlacionar. */
const ACCOUNT_ROW = {
  id: ACCOUNT,
  tenant_id: TENANT,
  owner_id: OWNER,
  // Primera compra: todavía no tiene customer de Stripe (lo escribe este mismo
  // webhook). Ver el test de reactivación para el caso con customer ya guardado.
  stripe_customer_id: null,
};

function presenciaEvent(
  sessionOverrides: Record<string, unknown> = {},
  type:
    | "checkout.session.completed"
    | "checkout.session.async_payment_succeeded" = "checkout.session.completed",
) {
  return {
    id: `evt_${Math.random().toString(36).slice(2)}`,
    type,
    data: {
      object: {
        id: "cs_test_presencia_1",
        payment_status: "paid",
        amount_total: 1500,
        currency: "usd",
        customer: "cus_presencia_1",
        subscription: "sub_presencia_1",
        metadata: {
          tenant_id: TENANT,
          business_account_id: ACCOUNT,
          // Quién compró. `iniciarSuscripcion` lo escribe para que la
          // pertenencia se pueda verificar en la PRIMERA compra, cuando la
          // cuenta todavía no tiene customer con qué correlacionar.
          owner_id: OWNER,
          plan: "destacado",
          intervalo: "mensual",
          // Lo PACTADO al abrir el Checkout: lo escribe `iniciarSuscripcion` con
          // el precio que leyó de `tenant_prices`. Es contra ESTE número que el
          // webhook verifica, no contra una constante del código.
          price_cents: "1500",
          price_currency: "USD",
        },
        ...sessionOverrides,
      },
    },
  };
}

/**
 * Config del admin para el camino feliz completo.
 *
 * Arma el stub en vez de delegar en `useAdmin` a propósito: la regla
 * `react-hooks/rules-of-hooks` toma cualquier función `useX` por un hook y se
 * queja de verla dentro de otra función o de un loop.
 */
function adminFeliz(accountOverrides: Record<string, unknown> = {}) {
  const stub = createAdminStub({
    payment_events: { insert: { error: null } },
    business_accounts: {
      select: { data: { ...ACCOUNT_ROW, ...accountOverrides }, error: null },
      update: { error: null },
    },
  });
  mocks.createAdminClient.mockReturnValue(stub.client);
  return stub;
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

/* ======================================================================== */
/* 1. CAMINO FELIZ — lo que NO se puede romper                              */
/* ======================================================================== */

describe("presencia — un pago legítimo sigue activando", () => {
  it("checkout pagado, monto y moneda coincidentes → enciende la presencia", async () => {
    const stub = adminFeliz();

    const res = await POST(signedRequest(presenciaEvent()));

    expect(res.status).toBe(200);
    const updates = concesiones(stub);
    expect(updates).toHaveLength(1);
    expect(updates[0].args[0]).toMatchObject({
      plan: "destacado",
      plan_status: "active",
      verified_presence: true,
      stripe_customer_id: "cus_presencia_1",
      stripe_subscription_id: "sub_presencia_1",
    });
    // Y el evento queda cerrado como procesado.
    expect(callsTo(stub, "payment_events", "update")).toHaveLength(1);
  });

  it("activa los tres planes del allow-list, no sólo el del fixture", async () => {
    for (const plan of ["basico", "destacado", "pro"] as const) {
      vi.clearAllMocks();
      const stub = adminFeliz();

      const res = await POST(
        signedRequest(
          presenciaEvent({
            metadata: {
              tenant_id: TENANT,
              business_account_id: ACCOUNT,
              owner_id: OWNER,
              plan,
              intervalo: "anual",
              price_cents: "1500",
              price_currency: "USD",
            },
          }),
        ),
      );

      expect(res.status).toBe(200);
      expect(concesiones(stub)[0]?.args[0]).toMatchObject({ plan, verified_presence: true });
    }
  });

  it("reactivación: la cuenta ya tiene customer y el checkout lo reusa → activa", async () => {
    // `iniciarSuscripcion` pasa `customer: existing.stripe_customer_id` cuando la
    // cuenta ya lo tiene, así que en una reactivación legítima los dos coinciden.
    const stub = adminFeliz({ stripe_customer_id: "cus_presencia_1" });

    const res = await POST(signedRequest(presenciaEvent()));

    expect(res.status).toBe(200);
    expect(concesiones(stub)).toHaveLength(1);
  });

  it("moneda pactada en minúsculas o con espacios raros: se compara normalizada", async () => {
    const stub = adminFeliz();

    const res = await POST(
      signedRequest(
        presenciaEvent({
          currency: "USD", // Stripe la manda en minúsculas, pero no se asume.
          metadata: {
            tenant_id: TENANT,
            business_account_id: ACCOUNT,
            owner_id: OWNER,
            plan: "pro",
            intervalo: "mensual",
            price_cents: "1500",
            price_currency: "usd",
          },
        }),
      ),
    );

    expect(res.status).toBe(200);
    expect(concesiones(stub)).toHaveLength(1);
  });

  it("una comunidad con precio propio (ARS 45000) activa igual: se compara contra lo PACTADO", async () => {
    // El bug que este criterio evita: comparar contra la constante del código
    // rechazaría a cualquier comunidad que no cobre el precio de la spec.
    const stub = adminFeliz();

    const res = await POST(
      signedRequest(
        presenciaEvent({
          amount_total: 4_500_000,
          currency: "ars",
          metadata: {
            tenant_id: TENANT,
            business_account_id: ACCOUNT,
            owner_id: OWNER,
            plan: "destacado",
            intervalo: "mensual",
            price_cents: "4500000",
            price_currency: "ARS",
          },
        }),
      ),
    );

    expect(res.status).toBe(200);
    expect(concesiones(stub)).toHaveLength(1);
  });

  it("pago asíncrono: el completed NO activa, y el async_payment_succeeded posterior SÍ", async () => {
    // Un método de pago diferido (transferencia, boleto) manda primero un
    // completed con payment_status='unpaid' y recién después el succeeded.
    const pendiente = adminFeliz();
    const resPendiente = await POST(
      signedRequest(presenciaEvent({ payment_status: "unpaid" })),
    );
    expect(resPendiente.status).toBe(200);
    expect(concesiones(pendiente)).toHaveLength(0);

    vi.clearAllMocks();
    const confirmado = adminFeliz();
    const resConfirmado = await POST(
      signedRequest(presenciaEvent({}, "checkout.session.async_payment_succeeded")),
    );

    expect(resConfirmado.status).toBe(200);
    // ESTE es el caso que el arreglo no puede romper: exigir `paid` sin atender
    // el async dejaría la presencia sin activar nunca tras un pago real.
    expect(concesiones(confirmado)).toHaveLength(1);
  });
});

/* ======================================================================== */
/* 2. NO SE ENTREGA SIN COBRAR                                             */
/* ======================================================================== */

describe("presencia — no se entrega sin cobrar", () => {
  it("checkout.session.completed con payment_status 'unpaid' NO enciende la presencia", async () => {
    const stub = adminFeliz();

    const res = await POST(signedRequest(presenciaEvent({ payment_status: "unpaid" })));

    expect(res.status).toBe(200);
    expect(concesiones(stub)).toHaveLength(0);
  });

  it("payment_status 'no_payment_required' tampoco alcanza", async () => {
    const stub = adminFeliz();

    const res = await POST(
      signedRequest(presenciaEvent({ payment_status: "no_payment_required", amount_total: 0 })),
    );

    expect(res.status).toBe(200);
    expect(concesiones(stub)).toHaveLength(0);
  });
});

/* ======================================================================== */
/* 3. CORRELACIÓN FISCAL (R3) — monto, moneda, tenant, cuenta              */
/* ======================================================================== */

describe("presencia — correlación fiscal (R3)", () => {
  it("NO concede si el monto cobrado no es el pactado", async () => {
    const stub = adminFeliz();

    const res = await POST(signedRequest(presenciaEvent({ amount_total: 1 })));

    // Sin throw: 200 para que Stripe no reintente algo que no se arregla solo.
    expect(res.status).toBe(200);
    expect(concesiones(stub)).toHaveLength(0);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("NO concede si la moneda cobrada no es la pactada (1500 ARS ≠ 1500 USD)", async () => {
    const stub = adminFeliz();

    const res = await POST(signedRequest(presenciaEvent({ currency: "ars" })));

    expect(res.status).toBe(200);
    expect(concesiones(stub)).toHaveLength(0);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("NO concede si la metadata no trae un precio pactado legible", async () => {
    const stub = adminFeliz();

    const res = await POST(
      signedRequest(
        presenciaEvent({
          metadata: {
            tenant_id: TENANT,
            business_account_id: ACCOUNT,
            owner_id: OWNER,
            plan: "destacado",
            intervalo: "mensual",
          },
        }),
      ),
    );

    expect(res.status).toBe(200);
    expect(concesiones(stub)).toHaveLength(0);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("el log de rechazo trae session, cuenta, cobrado y la metadata cruda", async () => {
    adminFeliz();

    await POST(signedRequest(presenciaEvent({ amount_total: 1 })));

    const mensaje = errorSpy.mock.calls.flat().join(" ");
    expect(mensaje).toContain("cs_test_presencia_1"); // la session
    expect(mensaje).toContain(ACCOUNT); // la cuenta
    expect(mensaje).toContain("1500"); // lo pactado, crudo de metadata
    expect(mensaje).toContain("usd"); // la moneda cobrada
  });

  it("NO concede si el tenant de la cuenta no es el de la metadata (fuga cross-tenant)", async () => {
    const stub = adminFeliz({ tenant_id: "tenant-OTRO" });

    const res = await POST(signedRequest(presenciaEvent()));

    expect(res.status).toBe(200);
    expect(concesiones(stub)).toHaveLength(0);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("NO concede si la business_account de la metadata no existe", async () => {
    const stub = useAdmin({
      payment_events: { insert: { error: null } },
      business_accounts: { select: { data: null, error: null }, update: { error: null } },
    });

    const res = await POST(signedRequest(presenciaEvent()));

    expect(res.status).toBe(200);
    expect(concesiones(stub)).toHaveLength(0);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("NO concede si el owner_id de la metadata no es el dueño de la cuenta", async () => {
    // La correlación por customer (b) no cubre la PRIMERA compra: ahí la cuenta
    // todavía no tiene customer guardado. `owner_id` sí, desde el primer peso.
    const stub = adminFeliz({ owner_id: "owner-OTRO" });

    const res = await POST(signedRequest(presenciaEvent()));

    expect(res.status).toBe(200);
    expect(concesiones(stub)).toHaveLength(0);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("NO concede sin owner_id en la metadata, ni siquiera en la primera compra", async () => {
    // Una Session emitida ANTES de que `iniciarSuscripcion` escribiera este
    // campo. Se rechaza igual (ver la nota de compatibilidad en el handler): un
    // cobro que no se puede atribuir a una persona se reconcilia a mano, no se
    // concede a ojo.
    const stub = adminFeliz();

    const res = await POST(
      signedRequest(
        presenciaEvent({
          metadata: {
            tenant_id: TENANT,
            business_account_id: ACCOUNT,
            plan: "destacado",
            intervalo: "mensual",
            price_cents: "1500",
            price_currency: "USD",
          },
        }),
      ),
    );

    expect(res.status).toBe(200);
    expect(concesiones(stub)).toHaveLength(0);
  });

  it("NO concede si pagó un customer distinto del guardado en la cuenta", async () => {
    const stub = adminFeliz({ stripe_customer_id: "cus_DE_OTRO" });

    const res = await POST(signedRequest(presenciaEvent()));

    expect(res.status).toBe(200);
    expect(concesiones(stub)).toHaveLength(0);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("NO concede con un plan fuera del allow-list", async () => {
    const stub = adminFeliz();

    const res = await POST(
      signedRequest(
        presenciaEvent({
          metadata: {
            tenant_id: TENANT,
            business_account_id: ACCOUNT,
            owner_id: OWNER,
            plan: "enterprise_inventado",
            intervalo: "mensual",
            price_cents: "1500",
            price_currency: "USD",
          },
        }),
      ),
    );

    expect(res.status).toBe(200);
    expect(concesiones(stub)).toHaveLength(0);
  });

  it("NO concede sin tenant_id en la metadata: sin él no hay nada contra qué correlacionar", async () => {
    const stub = adminFeliz();

    const res = await POST(
      signedRequest(
        presenciaEvent({
          metadata: {
            business_account_id: ACCOUNT,
            owner_id: OWNER,
            plan: "destacado",
            intervalo: "mensual",
            price_cents: "1500",
            price_currency: "USD",
          },
        }),
      ),
    );

    expect(res.status).toBe(200);
    expect(concesiones(stub)).toHaveLength(0);
  });
});

/* ======================================================================== */
/* 4. IDEMPOTENCIA                                                          */
/* ======================================================================== */

describe("presencia — idempotencia", () => {
  it("un replay de un evento ya procesado no vuelve a conceder", async () => {
    const stub = useAdmin({
      payment_events: {
        insert: { error: { code: "23505" } },
        // Desde la 0111 lo que decide es el RECLAMO, no leer `processed`: el
        // UPDATE condicional no se lleva ninguna fila porque el evento ya está
        // procesado, así que el route corta con "duplicado".
        update: { data: null, error: null },
      },
      business_accounts: {
        select: { data: ACCOUNT_ROW, error: null },
        update: { error: null },
      },
    });

    const res = await POST(signedRequest(presenciaEvent()));
    const body = (await res.json()) as { duplicated?: boolean };

    expect(res.status).toBe(200);
    expect(body.duplicated).toBe(true);
    expect(stub.calls.some((c) => c.table === "business_accounts")).toBe(false);
  });
});

/* ======================================================================== */
/* 5. `customer.subscription.updated` — sincronizar estado sin conceder nivel */
/* ======================================================================== */

/**
 * Era la última rama del módulo PAGOS donde la metadata concedía nivel: escribía
 * `plan: metadata.plan` filtrando SÓLO por `stripe_subscription_id`, sin exigir
 * que la suscripción fuera de presencia ni cruzar el dueño. Los caminos felices
 * van primero por el mismo motivo que en el resto del archivo: acá el error caro
 * es dejar de sincronizar el estado de alguien que paga.
 */

const SUB = "sub_presencia_1";

function subscriptionEvent(
  overrides: Record<string, unknown> = {},
  metadataOverrides: Record<string, unknown> = {},
) {
  return {
    id: `evt_${Math.random().toString(36).slice(2)}`,
    type: "customer.subscription.updated",
    data: {
      object: {
        id: SUB,
        object: "subscription",
        status: "active",
        // El snapshot que `iniciarSuscripcion` escribe en
        // `subscription_data.metadata` al abrir el Checkout.
        metadata: {
          tenant_id: TENANT,
          business_account_id: ACCOUNT,
          owner_id: OWNER,
          plan: "destacado",
          intervalo: "mensual",
          ...metadataOverrides,
        },
        ...overrides,
      },
    },
  };
}

/** La cuenta tal como la lee esta rama (ya suscripta, con su plan vigente). */
const ACCOUNT_SUSCRIPTA = {
  id: ACCOUNT,
  tenant_id: TENANT,
  owner_id: OWNER,
  plan: "destacado",
  stripe_customer_id: "cus_presencia_1",
};

function adminSuscripcion(accountOverrides: Record<string, unknown> = {}) {
  const stub = createAdminStub({
    payment_events: { insert: { error: null } },
    business_accounts: {
      select: { data: { ...ACCOUNT_SUSCRIPTA, ...accountOverrides }, error: null },
      update: { error: null },
    },
  });
  mocks.createAdminClient.mockReturnValue(stub.client);
  return stub;
}

describe("presencia — una renovación legítima sigue sincronizando el estado", () => {
  it("suscripción activa → plan_status active y presencia encendida", async () => {
    const stub = adminSuscripcion();

    const res = await POST(signedRequest(subscriptionEvent()));

    expect(res.status).toBe(200);
    const updates = concesiones(stub);
    expect(updates).toHaveLength(1);
    expect(updates[0].args[0]).toMatchObject({
      plan_status: "active",
      verified_presence: true,
    });
  });

  it("suscripción impaga → se apaga la presencia sin tocar el plan contratado", async () => {
    const stub = adminSuscripcion();

    const res = await POST(signedRequest(subscriptionEvent({ status: "past_due" })));

    expect(res.status).toBe(200);
    const updates = concesiones(stub);
    expect(updates).toHaveLength(1);
    expect(updates[0].args[0]).toMatchObject({
      plan_status: "past_due",
      verified_presence: false,
    });
  });
});

describe("presencia — la metadata de la suscripción ya no concede nivel", () => {
  it("un plan editado en el Dashboard NO asciende la cuenta: se sincroniza el estado y se alerta", async () => {
    const stub = adminSuscripcion({ plan: "basico" });

    const res = await POST(
      signedRequest(subscriptionEvent({}, { plan: "pro" })),
    );

    expect(res.status).toBe(200);
    const updates = concesiones(stub);
    expect(updates).toHaveLength(1);
    // El estado sí se sincroniza; el NIVEL no se toca — sólo lo concede un
    // Checkout cobrado y verificado contra el precio pactado.
    expect(updates[0].args[0]).toMatchObject({ plan_status: "active" });
    expect(updates[0].args[0]).not.toHaveProperty("plan");
    expect(errorSpy).toHaveBeenCalled();
  });

  it("aun con la metadata coherente, el plan nunca viaja al UPDATE", async () => {
    const stub = adminSuscripcion();

    const res = await POST(signedRequest(subscriptionEvent()));

    expect(res.status).toBe(200);
    expect(concesiones(stub)[0]?.args[0]).not.toHaveProperty("plan");
  });

  it("un snapshot que apunta a otro dueño NO escribe nada", async () => {
    const stub = adminSuscripcion();

    const res = await POST(
      signedRequest(subscriptionEvent({}, { owner_id: "owner-DE-OTRO" })),
    );

    expect(res.status).toBe(200);
    // Ni siquiera el estado: aplicado a la fila equivocada es tan dañino como
    // conceder.
    expect(concesiones(stub)).toHaveLength(0);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("un snapshot que apunta a otra comunidad NO escribe nada", async () => {
    const stub = adminSuscripcion();

    const res = await POST(
      signedRequest(subscriptionEvent({}, { tenant_id: "tenant-DE-OTRA-COMUNIDAD" })),
    );

    expect(res.status).toBe(200);
    expect(concesiones(stub)).toHaveLength(0);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("una suscripción de OTRO producto (trae `kind`) no toca business_accounts", async () => {
    const stub = adminSuscripcion();

    const res = await POST(
      signedRequest(subscriptionEvent({}, { kind: "kind_inventado" })),
    );

    expect(res.status).toBe(200);
    expect(stub.calls.some((c) => c.table === "business_accounts")).toBe(false);
  });

  it("una suscripción sin cuenta asociada no dispara ningún UPDATE a ciegas", async () => {
    const stub = createAdminStub({
      payment_events: { insert: { error: null } },
      business_accounts: { select: { data: null, error: null }, update: { error: null } },
    });
    mocks.createAdminClient.mockReturnValue(stub.client);

    const res = await POST(signedRequest(subscriptionEvent()));

    expect(res.status).toBe(200);
    expect(concesiones(stub)).toHaveLength(0);
  });

  it("una suscripción anterior a que existiera `owner_id` sigue sincronizando", async () => {
    // Una Checkout Session expira a las 24 h, pero una suscripción vive para
    // siempre: exigir un campo que las viejas no tienen las dejaría sin
    // sincronizar nunca. Los campos que NO vienen no bloquean; los que vienen y
    // no coinciden, sí.
    const stub = adminSuscripcion();

    const res = await POST(
      signedRequest(subscriptionEvent({}, { owner_id: undefined })),
    );

    expect(res.status).toBe(200);
    expect(concesiones(stub)).toHaveLength(1);
  });
});
