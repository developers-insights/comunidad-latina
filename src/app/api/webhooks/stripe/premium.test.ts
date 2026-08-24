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
    for (const method of ["eq", "or"] as const) {
      builder[method] = vi.fn((...args: unknown[]) => {
        calls.push({ table, method, args });
        return builder;
      });
    }
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

/**
 * `listing_premiums` en el ALTA, tal como la ve `concederUnaSolaVez`:
 *
 *  · `update` = el RECLAMO, que no matchea porque el aviso todavía no tiene fila;
 *  · `insert` = el alta propiamente dicha, que entra;
 *  · `select` = la relectura desambiguadora, que en este camino no se usa.
 *
 * El `upsert` a ciegas que había antes acá se fue en la auditoría de pagos:
 * escribía siempre y seguía de largo hasta la notificación y la auditoría, así
 * que la segunda entrega del mismo pago duplicaba las dos. Ver
 * `lib/monetization/concesion.ts`.
 */
const ALTA_LIMPIA = {
  update: { data: [], error: null },
  insert: { error: null },
  select: { data: null, error: null },
};

/** El 23505 con el que la base rebota un alta cuando la fila del aviso ya existe. */
const CHOQUE_UNIQUE = {
  error: { code: "23505", message: "duplicate key value violates unique constraint" },
};

function checkoutEvent(sessionOverrides: Record<string, unknown> = {}) {
  return {
    id: `evt_${Math.random().toString(36).slice(2)}`,
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_test_premium_1",
        payment_status: "paid",
        amount_total: 900,
        currency: "usd",
        customer: "cus_1",
        subscription: "sub_premium_1",
        metadata: {
          kind: "listing_premium",
          tenant_id: TENANT,
          listing_id: LISTING,
          owner_id: OWNER,
          // Lo PACTADO al abrir el Checkout: lo escribe `activarPremiumAviso`
          // con el precio que leyó de `tenant_prices`. Es contra ESTE número
          // que el webhook verifica, no contra la constante del código.
          price_cents: "900",
          price_currency: "USD",
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
      listing_premiums: ALTA_LIMPIA,
    });

    const res = await POST(signedRequest(checkoutEvent()));

    expect(res.status).toBe(200);
    const altas = callsTo(stub, "listing_premiums", "insert");
    expect(altas).toHaveLength(1);
    expect(altas[0].args[0]).toMatchObject({
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
      listing_premiums: ALTA_LIMPIA,
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
      listing_premiums: { ...ALTA_LIMPIA, select: { data: { price_cents: 900 }, error: null } },
    });

    const res = await POST(signedRequest(checkoutEvent({ amount_total: 100 })));

    // 200 para que Stripe no reintente: reintentar no arregla una discrepancia
    // de monto. Queda el payload en payment_events para reconciliar a mano.
    expect(res.status).toBe(200);
    expect(callsTo(stub, "listing_premiums", "insert")).toHaveLength(0);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("NO concede si el aviso cambió de dueño entre el checkout y el webhook", async () => {
    const stub = useAdmin({
      payment_events: { insert: { error: null } },
      listings: { select: { data: { ...LISTING_ROW, created_by: "otro" }, error: null } },
      listing_premiums: ALTA_LIMPIA,
    });

    const res = await POST(signedRequest(checkoutEvent()));

    expect(res.status).toBe(200);
    expect(callsTo(stub, "listing_premiums", "insert")).toHaveLength(0);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("NO concede si el aviso ya no existe (plata cobrada sin sujeto)", async () => {
    const stub = useAdmin({
      payment_events: { insert: { error: null } },
      listings: { select: { data: null, error: null } },
      listing_premiums: ALTA_LIMPIA,
    });

    const res = await POST(signedRequest(checkoutEvent()));

    expect(res.status).toBe(200);
    expect(callsTo(stub, "listing_premiums", "insert")).toHaveLength(0);
  });

  it("un checkout sin pagar (método async) todavía no concede nada", async () => {
    const stub = useAdmin({
      payment_events: { insert: { error: null } },
      listings: { select: { data: LISTING_ROW, error: null } },
      listing_premiums: ALTA_LIMPIA,
    });

    const res = await POST(signedRequest(checkoutEvent({ payment_status: "unpaid" })));

    expect(res.status).toBe(200);
    // Espera a checkout.session.async_payment_succeeded.
    expect(callsTo(stub, "listing_premiums", "insert")).toHaveLength(0);
  });
});

/* ------------- 2 bis. El precio LO PONE LA COMUNIDAD (0072/0073) ---------- */

/**
 * EL BUG QUE ESTOS TESTS FIJAN
 * En el alta la fila de `listing_premiums` todavía no existe —la crea este mismo
 * webhook—, así que el "precio esperado" salía siempre de la constante del
 * código (900). Con una comunidad cobrando USD 15 el Checkout cobraba 1500, la
 * verificación esperaba 900 y el premium NO se concedía: plata cobrada, aviso
 * sin premium. Ahora se compara contra lo que se pactó al abrir el Checkout, que
 * viaja firmado en la metadata de la Session.
 */
describe("premium — precio por comunidad", () => {
  /**
   * Todo lo que necesita el alta feliz, sin fila previa. El prefijo `use` no es
   * capricho: `react-hooks/rules-of-hooks` toma cualquier llamada a `useAdmin`
   * desde una función nombrada sin ese prefijo como un hook mal ubicado.
   */
  function useAltaLimpia() {
    return useAdmin({
      payment_events: { insert: { error: null } },
      listings: { select: { data: LISTING_ROW, error: null } },
      listing_premiums: ALTA_LIMPIA,
    });
  }

  /** Todo lo que console.error escribió, aplanado, para poder buscar dentro. */
  function loggedErrors() {
    return errorSpy.mock.calls.map((call: unknown[]) => call.join(" ")).join("\n");
  }

  it("un alta al precio EDITADO por la comunidad (USD 15) concede el premium", async () => {
    const stub = useAltaLimpia();

    const res = await POST(
      signedRequest(
        checkoutEvent({
          amount_total: 1_500,
          currency: "usd",
          metadata: {
            kind: "listing_premium",
            tenant_id: TENANT,
            listing_id: LISTING,
            owner_id: OWNER,
            price_cents: "1500",
            price_currency: "USD",
          },
        }),
      ),
    );

    expect(res.status).toBe(200);
    const upserts = callsTo(stub, "listing_premiums", "insert");
    expect(upserts).toHaveLength(1);
    // Y lo cobrado queda escrito en la fila: la pantalla del dueño no puede
    // mostrar el default de la columna cuando se pagaron USD 15.
    expect(upserts[0].args[0]).toMatchObject({
      status: "active",
      price_cents: 1_500,
      currency: "usd",
    });
    expect(mocks.createNotification).toHaveBeenCalledTimes(1);
  });

  it("NO concede si el monto cobrado no es el PACTADO en esa Session", async () => {
    const stub = useAltaLimpia();

    // Se pactaron 900 y se cobraron 1500: puede ser un Checkout manipulado o un
    // evento cruzado. En cualquier caso no se concede.
    const res = await POST(signedRequest(checkoutEvent({ amount_total: 1_500 })));

    expect(res.status).toBe(200);
    expect(callsTo(stub, "listing_premiums", "insert")).toHaveLength(0);
    expect(loggedErrors()).toContain("1500");
  });

  it("sin precio pactado en la metadata NO concede, y deja rastro diagnosticable", async () => {
    const stub = useAltaLimpia();

    const res = await POST(
      signedRequest(
        checkoutEvent({
          amount_total: 1_500,
          metadata: {
            kind: "listing_premium",
            tenant_id: TENANT,
            listing_id: LISTING,
            owner_id: OWNER,
          },
        }),
      ),
    );

    expect(res.status).toBe(200);
    expect(callsTo(stub, "listing_premiums", "insert")).toHaveLength(0);
    // Nada de fallar en silencio: con el log + el payload que quedó en
    // `payment_events` se puede reconciliar sin abrir el Dashboard a ciegas.
    const logged = loggedErrors();
    expect(logged).toContain("cs_test_premium_1");
    expect(logged).toContain(LISTING);
    expect(logged).toContain("1500");
  });

  it("una metadata de precio que no parsea tampoco concede", async () => {
    const stub = useAltaLimpia();

    const res = await POST(
      signedRequest(
        checkoutEvent({
          metadata: {
            kind: "listing_premium",
            tenant_id: TENANT,
            listing_id: LISTING,
            owner_id: OWNER,
            price_cents: "gratis",
            price_currency: "USD",
          },
        }),
      ),
    );

    expect(res.status).toBe(200);
    expect(callsTo(stub, "listing_premiums", "insert")).toHaveLength(0);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("NO concede si la MONEDA cobrada no es la pactada, aunque el número coincida", async () => {
    const stub = useAltaLimpia();

    // 1500 ARS y 1500 USD dan el mismo entero de centavos y no son el mismo
    // cobro: comparar sólo centavos entre monedas distintas no verifica nada.
    const res = await POST(
      signedRequest(
        checkoutEvent({
          amount_total: 1_500,
          currency: "ars",
          metadata: {
            kind: "listing_premium",
            tenant_id: TENANT,
            listing_id: LISTING,
            owner_id: OWNER,
            price_cents: "1500",
            price_currency: "USD",
          },
        }),
      ),
    );

    expect(res.status).toBe(200);
    expect(callsTo(stub, "listing_premiums", "insert")).toHaveLength(0);
    expect(loggedErrors()).toContain("ars");
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
      listing_premiums: ALTA_LIMPIA,
    });

    const res = await POST(signedRequest(checkoutEvent()));
    const body = (await res.json()) as { duplicated?: boolean };

    expect(res.status).toBe(200);
    expect(body.duplicated).toBe(true);
    expect(callsTo(stub, "listing_premiums", "insert")).toHaveLength(0);
    expect(mocks.createNotification).not.toHaveBeenCalled();
  });

  it("un intento previo que murió a mitad (processed=false) SÍ se completa", async () => {
    const stub = useAdmin({
      payment_events: {
        insert: { error: { code: "23505" } },
        select: { data: { processed: false }, error: null },
      },
      listings: { select: { data: LISTING_ROW, error: null } },
      listing_premiums: ALTA_LIMPIA,
    });

    const res = await POST(signedRequest(checkoutEvent()));

    expect(res.status).toBe(200);
    expect(callsTo(stub, "listing_premiums", "insert")).toHaveLength(1);
  });
});

/* ------------- 5. bis. UNA concesión por pago, y una sola ----------------- */

describe("premium — una session no puede encender dos avisos", () => {
  /**
   * `listing_premiums_checkout_session_uniq` y `..._subscription_uniq` (0054)
   * rebotan cuando la session/suscripción del evento YA está en la fila de OTRO
   * aviso: un solo pago intentando encender un segundo premium.
   *
   * La decisión: no conceder + log + 200. Dejarlo lanzar daba un 500 y Stripe
   * reintentaba tres días un evento que nunca iba a poder aplicarse.
   *
   * Cómo se reconoce el caso, desde la auditoría de pagos: el RECLAMO no matchea
   * (este aviso no tiene fila), el alta choca 23505 y la relectura confirma que
   * el aviso SIGUE sin fila ⇒ el choque fue contra el unique del PAGO. Antes esto
   * se deducía con un regex sobre el nombre del índice en el texto del error, que
   * fallaba ABIERTA: renombrar el índice en una migración convertía un error
   * permanente en tres días de reintentos.
   */
  it("un pago ya vinculado a otro aviso NO se concede, pero responde 200 (no reintentar)", async () => {
    const stub = useAdmin({
      payment_events: { insert: { error: null } },
      listings: { select: { data: LISTING_ROW, error: null } },
      listing_premiums: {
        update: { data: [], error: null },
        insert: CHOQUE_UNIQUE,
        // La relectura: este aviso sigue sin fila.
        select: { data: null, error: null },
      },
    });

    const res = await POST(signedRequest(checkoutEvent()));

    // 200: reintentar no lo arregla, la session va a seguir vinculada al otro aviso.
    expect(res.status).toBe(200);
    // Y sobre todo: NO se concedió un segundo premium con un solo pago.
    expect(mocks.createNotification).not.toHaveBeenCalled();
    expect(callsTo(stub, "audit_log", "insert")).toHaveLength(0);
    expect(errorSpy).toHaveBeenCalled();
  });

  /**
   * EL CASO QUE ESTE MÓDULO EXISTE PARA CUBRIR.
   *
   * `checkout.session.completed` y `checkout.session.async_payment_succeeded`
   * traen la MISMA Session con `event.id` distintos, así que el UNIQUE sobre
   * `payment_events.event_id` los deja pasar a los dos; y ante un intento previo
   * con `processed=false` el route reprocesa a propósito. En las dos situaciones
   * este handler corre dos veces sobre el mismo pago.
   *
   * Con el `upsert` a ciegas de antes, la segunda pasada mandaba un segundo
   * comprobante "tu publicación ya es premium" y escribía una segunda fila de
   * `audit_log` por un solo pago. Ahora el token del pago está en el `WHERE`: la
   * fila ya lo lleva, el reclamo no matchea, y se corta antes de notificar.
   */
  it("la SEGUNDA entrega del mismo pago no notifica ni audita de nuevo", async () => {
    const stub = useAdmin({
      payment_events: { insert: { error: null } },
      listings: { select: { data: LISTING_ROW, error: null } },
      listing_premiums: {
        // El reclamo no matchea: la fila ya lleva ESTA session.
        update: { data: [], error: null },
        insert: CHOQUE_UNIQUE,
        // La relectura lo confirma.
        select: {
          data: { stripe_checkout_session_id: "cs_test_premium_1" },
          error: null,
        },
      },
    });

    const res = await POST(signedRequest(checkoutEvent()));

    expect(res.status).toBe(200);
    expect(mocks.createNotification).not.toHaveBeenCalled();
    expect(callsTo(stub, "audit_log", "insert")).toHaveLength(0);
  });

  it("el token del pago viaja en el WHERE del reclamo, no en un if", async () => {
    // Sin el predicado, dos entregas concurrentes matchean las dos filas y las
    // dos notifican. Con él, Postgres serializa y la segunda no toca nada.
    const stub = useAdmin({
      payment_events: { insert: { error: null } },
      listings: { select: { data: LISTING_ROW, error: null } },
      listing_premiums: ALTA_LIMPIA,
    });

    await POST(signedRequest(checkoutEvent()));

    expect(callsTo(stub, "listing_premiums", "or")).toEqual([
      {
        table: "listing_premiums",
        method: "or",
        args: [
          "stripe_checkout_session_id.is.null,stripe_checkout_session_id.neq.cs_test_premium_1",
        ],
      },
    ]);
  });

  it("cualquier OTRO error de escritura sigue dando 500 para que Stripe reintente", async () => {
    // Un fallo transitorio SÍ se arregla reintentando: eso no se traga.
    useAdmin({
      payment_events: { insert: { error: null } },
      listings: { select: { data: LISTING_ROW, error: null } },
      listing_premiums: {
        update: { error: { code: "57014", message: "canceling statement due to timeout" } },
      },
    });

    const res = await POST(signedRequest(checkoutEvent()));

    expect(res.status).toBe(500);
  });

  it("un alta que falla por algo que no es 23505 tampoco se traga", async () => {
    useAdmin({
      payment_events: { insert: { error: null } },
      listings: { select: { data: LISTING_ROW, error: null } },
      listing_premiums: {
        update: { data: [], error: null },
        insert: { error: { code: "23514", message: "check constraint violated" } },
      },
    });

    const res = await POST(signedRequest(checkoutEvent()));

    expect(res.status).toBe(500);
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
      // La tienda es un `listing kind='business'`, y la membresía ahora exige lo
      // mismo que el premium sobre el aviso: que exista, sea del tenant y del
      // dueño de la metadata. Sin esta fila el test pasaría por el motivo
      // equivocado (la membresía rechazaría por correlación, no por aislamiento).
      listings: { select: { data: LISTING_ROW, error: null } },
      store_memberships: { update: { data: [], error: null }, insert: { error: null }, select: { data: null, error: null } },
      listing_premiums: { ...ALTA_LIMPIA, update: { data: null, error: null } },
    });

    // Metadata y monto REALES de una tienda (USD 10, `store_id` en vez de
    // `listing_id`, y el precio pactado que escribe `activarMembresiaTienda`):
    // si se le manda el fixture de premium con otro `kind`, la membresía lo
    // rechaza por correlación y el test pasaría por el motivo equivocado.
    await POST(
      signedRequest(
        checkoutEvent({
          amount_total: 1_000,
          metadata: {
            kind: "store_membership",
            tenant_id: TENANT,
            store_id: LISTING,
            owner_id: OWNER,
            price_cents: "1000",
            price_currency: "USD",
          },
        }),
      ),
    );

    expect(callsTo(stub, "listing_premiums", "insert")).toHaveLength(0);
    expect(callsTo(stub, "store_memberships", "insert")).toHaveLength(1);
  });
});
