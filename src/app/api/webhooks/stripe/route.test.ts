import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests del webhook de Stripe (route.ts) — hoy la superficie más sensible del
 * módulo PAGOS: escribe con service-role (bypassa RLS), activa boosts/campañas
 * y enciende identity. Este suite aísla el handler mockeando SOLO los bordes
 * (Stripe SDK, admin client, notificaciones) — nunca toca Stripe ni Supabase
 * reales. Sigue el patrón de mocking del repo (lib/tenant/guard.test.ts):
 * `vi.hoisted` + `vi.mock` + un stub encadenable del query builder.
 *
 * Garantías cubiertas:
 *  - Firma inválida / ausente → 400, CERO writes.
 *  - Stripe sin configurar → 503, CERO writes.
 *  - Idempotencia: replay de un event_id ya procesado → no-op (no re-activa).
 *  - Correlación fiscal (R3): monto o session id que no matchean → NO activa.
 *  - Happy path: firma válida + evento nuevo + correlación correcta → activa
 *    el boost, notifica y marca processed.
 */

const mocks = vi.hoisted(() => ({
  constructEvent: vi.fn(),
  getStripe: vi.fn(),
  createAdminClient: vi.fn(),
  createNotification: vi.fn(),
}));

// isStripeConfigured es un `const` derivado de env en el import — lo forzamos a
// true acá para no depender de setear STRIPE_SECRET_KEY antes de cargar el módulo.
vi.mock("@/lib/config/services", () => ({ isStripeConfigured: true }));

// Solo hace falta getStripe (el SDK, que devolvemos falso) y PLAN_IDS (allow-list
// que consume metadataPlan). No cargamos el módulo real para evitar `stripe` npm.
vi.mock("@/lib/stripe", () => ({
  getStripe: mocks.getStripe,
  PLAN_IDS: ["basico", "destacado", "pro"],
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/notifications/notify", () => ({ createNotification: mocks.createNotification }));

import { POST } from "./route";

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
 * Query builder falso, encadenable y "thenable": cada `from(table)` devuelve un
 * builder fresco que recuerda la última operación (insert/update/upsert/select)
 * y, al resolverse (await directo o `.maybeSingle()`), devuelve el resultado que
 * se configuró para esa (tabla, operación). Todas las llamadas quedan grabadas
 * en `calls` para poder afirmar qué se tocó (y qué NO).
 */
function createAdminStub(config: AdminConfig = {}) {
  const calls: RecordedCall[] = [];

  const from = vi.fn((table: string) => {
    const tableConfig: TableOps = config[table] ?? {};
    let op: keyof TableOps | null = null;
    const result = () => tableConfig[op ?? "select"] ?? { data: null, error: null };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = {
      insert: vi.fn((...args: unknown[]) => {
        calls.push({ table, method: "insert", args });
        op = "insert";
        return builder;
      }),
      update: vi.fn((...args: unknown[]) => {
        calls.push({ table, method: "update", args });
        op = "update";
        return builder;
      }),
      upsert: vi.fn((...args: unknown[]) => {
        calls.push({ table, method: "upsert", args });
        op = "upsert";
        return builder;
      }),
      select: vi.fn((...args: unknown[]) => {
        calls.push({ table, method: "select", args });
        // Un `.select()` DESPUÉS de un write es el RETURNING de ese write, no
        // una consulta nueva: no puede pisar la operación en curso. Sin esto,
        // `update(...).eq(...).select("id")` —el patrón que evita la doble
        // activación— devolvería el resultado configurado para `select` y el
        // stub mentiría sobre cuántas filas tocó el UPDATE.
        if (op === null) op = "select";
        return builder;
      }),
      eq: vi.fn((...args: unknown[]) => {
        calls.push({ table, method: "eq", args });
        return builder;
      }),
      maybeSingle: vi.fn(async () => result()),
      single: vi.fn(async () => result()),
      then: (resolve: (v: OpResult) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve(result()).then(resolve, reject),
    };
    return builder;
  });

  return { client: { from }, from, calls };
}

function useAdmin(config: AdminConfig = {}) {
  const stub = createAdminStub(config);
  mocks.createAdminClient.mockReturnValue(stub.client);
  return stub;
}

function touched(stub: ReturnType<typeof createAdminStub>, table: string, method?: string) {
  return stub.calls.some((c) => c.table === table && (method ? c.method === method : true));
}

/* -------------------------------- Fixtures -------------------------------- */

function boostSession(overrides: Record<string, unknown> = {}) {
  return {
    id: "cs_test_boost_1",
    payment_status: "paid",
    amount_total: 1000,
    // Stripe devuelve la moneda en minúsculas. `boosts.currency` es NOT NULL
    // (0016) y la escribe la action con el mismo `precio.currency` que le manda
    // a Stripe, así que en un cobro legítimo los dos lados coinciden.
    currency: "usd",
    metadata: { boost_id: "boost-1", tenant_id: "tenant-1" },
    ...overrides,
  };
}

function boostEvent(sessionOverrides: Record<string, unknown> = {}) {
  return {
    id: "evt_boost_1",
    type: "checkout.session.completed",
    data: { object: boostSession(sessionOverrides) },
  };
}

/**
 * Lo que devuelve el UPDATE gateado por estado cuando SÍ le tocó una fila.
 *
 * `activateBoost` escribe con `.eq("status","pending_payment").select("id")`, así
 * que el resultado es un ARRAY: una fila = se activó acá; cero filas = otra
 * entrega concurrente del mismo pago llegó primero. Configurar `{ error: null }`
 * a secas simularía lo segundo.
 */
const BOOST_ACTIVADO = { data: [{ id: "boost-1" }], error: null };
const PROMO_ACTIVADA = { data: [{ id: "promo-1" }], error: null };
/** Cero filas: el UPDATE no matcheó nada porque el estado ya había cambiado. */
const NINGUNA_FILA = { data: [] as Array<{ id: string }>, error: null };

const BOOST_ROW = {
  id: "boost-1",
  tenant_id: "tenant-1",
  listing_id: "listing-1",
  buyer_id: "buyer-1",
  duration_days: 7,
  status: "pending_payment",
  amount_cents: 1000,
  currency: "usd",
  stripe_checkout_session_id: "cs_test_boost_1",
  listings: { kind: "property" },
};

/* --- Campaña de post: mismo producto de al lado, misma disciplina ---------- */

function promoSession(overrides: Record<string, unknown> = {}) {
  return {
    id: "cs_test_promo_1",
    payment_status: "paid",
    amount_total: 2000,
    currency: "usd",
    metadata: { post_promotion_id: "promo-1", tenant_id: "tenant-1" },
    ...overrides,
  };
}

function promoEvent(sessionOverrides: Record<string, unknown> = {}) {
  return {
    id: "evt_promo_1",
    type: "checkout.session.completed",
    data: { object: promoSession(sessionOverrides) },
  };
}

const PROMO_ROW = {
  id: "promo-1",
  tenant_id: "tenant-1",
  post_id: "post-1",
  buyer_id: "buyer-1",
  duration_days: 7,
  status: "pending_payment",
  amount_cents: 2000,
  currency: "usd",
  stripe_checkout_session_id: "cs_test_promo_1",
};

/* --- Identity (§5.4): el flag del perfil + el Trust Score ------------------ */

function identityEvent() {
  return {
    id: "evt_identity_1",
    type: "identity.verification_session.verified",
    // Del documento NO llega nada: solo el id de la sesión y a quién pertenece.
    data: { object: { id: "vs_test_1", metadata: { user_id: "user-1" } } },
  };
}

const PROFILE_ROW = { id: "user-1", tenant_id: "tenant-1", identity_verified: false };
/** El UPDATE gateado por `identity_verified=false` tocó la fila: es esta entrega. */
const PROFILE_VERIFICADO = { data: [{ id: "user-1" }], error: null };

function makeRequest(rawBody: string, signature: string | null) {
  const headers = new Headers();
  if (signature !== null) headers.set("stripe-signature", signature);
  return new Request("https://app.test/api/webhooks/stripe", {
    method: "POST",
    headers,
    body: rawBody,
  });
}

/** Arma el Request desde un evento y programa constructEvent para devolverlo. */
function validRequestFor(event: unknown) {
  const rawBody = JSON.stringify(event);
  mocks.constructEvent.mockReturnValue(event);
  return makeRequest(rawBody, "t=1,v1=deadbeef");
}

let errorSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
  mocks.getStripe.mockReturnValue({ webhooks: { constructEvent: mocks.constructEvent } });
  mocks.createNotification.mockResolvedValue({ ok: true });
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
  warnSpy.mockRestore();
  delete process.env.STRIPE_WEBHOOK_SECRET;
});

/* ---------------------------- 1. Firma / config --------------------------- */

describe("webhook stripe — verificación de firma", () => {
  it("rechaza firma inválida con 400 y no escribe NADA en la DB", async () => {
    const stub = useAdmin();
    mocks.constructEvent.mockImplementation(() => {
      throw new Error("No signatures found matching the expected signature");
    });

    const res = await POST(makeRequest(JSON.stringify({ id: "evt" }), "t=1,v1=bad"));

    expect(res.status).toBe(400);
    // El admin client ni siquiera se crea antes de verificar la firma.
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(stub.calls).toHaveLength(0);
  });

  it("rechaza request sin header de firma con 400, sin tocar la DB", async () => {
    const stub = useAdmin();

    const res = await POST(makeRequest(JSON.stringify({ id: "evt" }), null));

    expect(res.status).toBe(400);
    expect(mocks.constructEvent).not.toHaveBeenCalled();
    expect(stub.calls).toHaveLength(0);
  });

  it("con Stripe sin configurar (falta el webhook secret) responde 503 y no escribe", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const stub = useAdmin();

    const res = await POST(makeRequest(JSON.stringify({ id: "evt" }), "t=1,v1=x"));

    expect(res.status).toBe(503);
    expect(mocks.constructEvent).not.toHaveBeenCalled();
    expect(stub.calls).toHaveLength(0);
  });
});

/* ------------------------------ 2. Idempotencia --------------------------- */

describe("webhook stripe — idempotencia / replay", () => {
  it("un event_id ya procesado (insert 23505 + processed=true) es no-op: no re-activa el boost", async () => {
    const stub = useAdmin({
      payment_events: {
        insert: { error: { code: "23505" } },
        select: { data: { processed: true }, error: null },
      },
      // boosts se configura pero NO debe consultarse: el replay corta antes.
      boosts: { select: { data: BOOST_ROW, error: null }, update: BOOST_ACTIVADO },
    });

    const res = await POST(validRequestFor(boostEvent()));
    const body = (await res.json()) as { received?: boolean; duplicated?: boolean };

    expect(res.status).toBe(200);
    expect(body.duplicated).toBe(true);
    // Cero procesamiento: nunca se tocó la tabla boosts.
    expect(touched(stub, "boosts")).toBe(false);
  });

  it("un event_id previo que murió a mitad (processed=false) SÍ se reprocesa y activa el boost", async () => {
    const stub = useAdmin({
      payment_events: {
        insert: { error: { code: "23505" } },
        select: { data: { processed: false }, error: null },
      },
      boosts: { select: { data: BOOST_ROW, error: null }, update: BOOST_ACTIVADO },
    });

    const res = await POST(validRequestFor(boostEvent()));

    expect(res.status).toBe(200);
    // processed=false ⇒ el intento anterior no terminó ⇒ se completa la activación.
    expect(touched(stub, "boosts", "update")).toBe(true);
  });
});

/* --------------------------- 3. Correlación fiscal ------------------------ */

describe("webhook stripe — correlación monto / session (fiscal R3)", () => {
  it("NO activa el boost si el monto cobrado no coincide con lo guardado", async () => {
    const stub = useAdmin({
      payment_events: { insert: { error: null } },
      boosts: {
        // amount_cents esperado 1000, pero la session cobró 999.
        select: { data: { ...BOOST_ROW, amount_cents: 1000 }, error: null },
        update: BOOST_ACTIVADO,
      },
    });

    const res = await POST(validRequestFor(boostEvent({ amount_total: 999 })));

    // Sin throw: se responde 200 (Stripe no debe reintentar) pero NO se activa.
    expect(res.status).toBe(200);
    expect(touched(stub, "boosts", "update")).toBe(false);
    expect(errorSpy).toHaveBeenCalled(); // queda la alerta para reconciliar a mano
  });

  it("NO activa el boost si la session del evento no es la vinculada al crear el checkout", async () => {
    const stub = useAdmin({
      payment_events: { insert: { error: null } },
      boosts: {
        select: {
          data: { ...BOOST_ROW, stripe_checkout_session_id: "cs_test_OTRA" },
          error: null,
        },
        update: BOOST_ACTIVADO,
      },
    });

    const res = await POST(validRequestFor(boostEvent({ id: "cs_test_boost_1" })));

    expect(res.status).toBe(200);
    expect(touched(stub, "boosts", "update")).toBe(false);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("NO activa un boost que ya no está pending_payment (cancelado/expirado por admin)", async () => {
    const stub = useAdmin({
      payment_events: { insert: { error: null } },
      boosts: {
        select: { data: { ...BOOST_ROW, status: "canceled" }, error: null },
        update: BOOST_ACTIVADO,
      },
    });

    const res = await POST(validRequestFor(boostEvent()));

    expect(res.status).toBe(200);
    expect(touched(stub, "boosts", "update")).toBe(false);
    expect(errorSpy).toHaveBeenCalled();
  });
});

/* ------------------------------- 4. Happy path ---------------------------- */

describe("webhook stripe — happy path", () => {
  it("firma válida + evento nuevo + correlación correcta → activa el boost, notifica y marca processed", async () => {
    const stub = useAdmin({
      payment_events: { insert: { error: null } },
      boosts: { select: { data: BOOST_ROW, error: null }, update: BOOST_ACTIVADO },
    });

    const res = await POST(validRequestFor(boostEvent()));
    const body = (await res.json()) as { received?: boolean };

    expect(res.status).toBe(200);
    expect(body.received).toBe(true);
    // Se registró el evento, se activó el boost y se cerró como procesado.
    expect(touched(stub, "payment_events", "insert")).toBe(true);
    expect(touched(stub, "boosts", "update")).toBe(true);
    expect(touched(stub, "payment_events", "update")).toBe(true);
    // Notificación al comprador (best-effort, pero se dispara en el happy path).
    expect(mocks.createNotification).toHaveBeenCalledTimes(1);
  });

  it("un checkout.session.completed no pagado (payment_status != paid) no activa el boost", async () => {
    const stub = useAdmin({
      payment_events: { insert: { error: null } },
      boosts: { select: { data: BOOST_ROW, error: null }, update: BOOST_ACTIVADO },
    });

    const res = await POST(validRequestFor(boostEvent({ payment_status: "unpaid" })));

    expect(res.status).toBe(200);
    // Pago async pendiente: se espera a async_payment_succeeded, no se activa aún.
    expect(touched(stub, "boosts", "update")).toBe(false);
  });
});

/* ======================================================================== */
/* 5. LA MONEDA DEL COBRO — impulso y campaña de post                       */
/* ======================================================================== */

/**
 * Los dos productos one-time comparaban `amount_total` contra `amount_cents` y
 * NO la moneda, aunque las dos tablas la guardan. 1500 ARS y 1500 USD dan el
 * mismo entero y no son el mismo cobro: es el mismo agujero que ya se cerró en
 * presencia y en el premium de un aviso.
 *
 * LOS CAMINOS FELICES VAN PRIMERO Y MANDAN. El riesgo de este arreglo es
 * simétrico: pasarse de estricto empieza a rechazar cobros legítimos, que de
 * cara al usuario es peor que el agujero. Estos cinco primeros casos se
 * escribieron y se corrieron contra el código SIN arreglar, en verde, antes de
 * tocar una línea de `route.ts`.
 */
describe("webhook stripe — la moneda del cobro (fiscal R3)", () => {
  it("camino feliz: el impulso cobrado en la misma moneda de la fila se activa", async () => {
    const stub = useAdmin({
      payment_events: { insert: { error: null } },
      boosts: { select: { data: BOOST_ROW, error: null }, update: BOOST_ACTIVADO },
    });

    const res = await POST(validRequestFor(boostEvent()));

    expect(res.status).toBe(200);
    expect(touched(stub, "boosts", "update")).toBe(true);
  });

  it("camino feliz: la campaña de post cobrada en la misma moneda se activa", async () => {
    const stub = useAdmin({
      payment_events: { insert: { error: null } },
      post_promotions: { select: { data: PROMO_ROW, error: null }, update: PROMO_ACTIVADA },
    });

    const res = await POST(validRequestFor(promoEvent()));

    expect(res.status).toBe(200);
    expect(touched(stub, "post_promotions", "update")).toBe(true);
    expect(mocks.createNotification).toHaveBeenCalledTimes(1);
  });

  it("camino feliz: una comunidad que cobra en ARS activa igual (no hay moneda privilegiada)", async () => {
    const stub = useAdmin({
      payment_events: { insert: { error: null } },
      boosts: {
        select: {
          data: { ...BOOST_ROW, amount_cents: 4_500_000, currency: "ars" },
          error: null,
        },
        update: BOOST_ACTIVADO,
      },
    });

    const res = await POST(
      validRequestFor(boostEvent({ amount_total: 4_500_000, currency: "ars" })),
    );

    expect(res.status).toBe(200);
    expect(touched(stub, "boosts", "update")).toBe(true);
  });

  it("camino feliz: la comparación normaliza mayúsculas de los dos lados", async () => {
    // `boosts.currency` viene con default 'usd' minúscula, pero `tenant_prices`
    // la guarda en MAYÚSCULAS y una fila vieja o migrada puede tenerla así. Que
    // el case decida si se entrega lo comprado sería absurdo.
    const stub = useAdmin({
      payment_events: { insert: { error: null } },
      boosts: {
        select: { data: { ...BOOST_ROW, currency: "USD" }, error: null },
        update: BOOST_ACTIVADO,
      },
    });

    const res = await POST(validRequestFor(boostEvent({ currency: "usd" })));

    expect(res.status).toBe(200);
    expect(touched(stub, "boosts", "update")).toBe(true);
  });

  it("camino feliz: la campaña de post también normaliza mayúsculas", async () => {
    const stub = useAdmin({
      payment_events: { insert: { error: null } },
      post_promotions: {
        select: { data: { ...PROMO_ROW, currency: "EUR" }, error: null },
        update: PROMO_ACTIVADA,
      },
    });

    const res = await POST(validRequestFor(promoEvent({ currency: "eur" })));

    expect(res.status).toBe(200);
    expect(touched(stub, "post_promotions", "update")).toBe(true);
  });

  it("NO activa el impulso cobrado en otra moneda con el mismo entero (1000 ARS ≠ 1000 usd)", async () => {
    const stub = useAdmin({
      payment_events: { insert: { error: null } },
      boosts: { select: { data: BOOST_ROW, error: null }, update: BOOST_ACTIVADO },
    });

    const res = await POST(validRequestFor(boostEvent({ currency: "ars" })));

    // Sin throw: 200 para que Stripe no reintente algo que no se arregla solo.
    expect(res.status).toBe(200);
    expect(touched(stub, "boosts", "update")).toBe(false);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("NO activa la campaña de post cobrada en otra moneda con el mismo entero", async () => {
    const stub = useAdmin({
      payment_events: { insert: { error: null } },
      post_promotions: { select: { data: PROMO_ROW, error: null }, update: PROMO_ACTIVADA },
    });

    const res = await POST(validRequestFor(promoEvent({ currency: "ars" })));

    expect(res.status).toBe(200);
    expect(touched(stub, "post_promotions", "update")).toBe(false);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("NO activa si la session no trae moneda: un pago one-time sin moneda es inverificable", async () => {
    const stub = useAdmin({
      payment_events: { insert: { error: null } },
      boosts: { select: { data: BOOST_ROW, error: null }, update: BOOST_ACTIVADO },
    });

    const res = await POST(validRequestFor(boostEvent({ currency: null })));

    expect(res.status).toBe(200);
    expect(touched(stub, "boosts", "update")).toBe(false);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("el log de rechazo por moneda alcanza para reconciliar: session, cobrado y esperado", async () => {
    useAdmin({
      payment_events: { insert: { error: null } },
      boosts: { select: { data: BOOST_ROW, error: null }, update: BOOST_ACTIVADO },
    });

    await POST(validRequestFor(boostEvent({ currency: "ars" })));

    const mensaje = errorSpy.mock.calls.flat().join(" ");
    expect(mensaje).toContain("boost-1");
    expect(mensaje).toContain("ars"); // lo cobrado
    expect(mensaje).toContain("usd"); // lo esperado
  });
});

/* ======================================================================== */
/* 6. DOS ENTREGAS DEL MISMO PAGO — la carrera                              */
/* ======================================================================== */

/**
 * La idempotencia por `event_id` cubre el reintento SECUENCIAL, no dos entregas
 * a la vez: ante un 23505 el route relee `processed` y, si está en `false`,
 * reprocesa a propósito — así que dos entregas concurrentes ven las dos
 * `processed=false`. Y ni siquiera hace falta que sea el mismo evento: dos ramas
 * distintas del switch (`checkout.session.completed` y
 * `checkout.session.async_payment_succeeded`) llaman a `activateBoost`.
 *
 * Con el predicado de estado en el `WHERE`, Postgres serializa los dos UPDATE y
 * el segundo no matchea ninguna fila. Cero filas es ÉXITO ("ya estaba
 * activado"), no error: 200, sin segunda notificación y sin segunda auditoría.
 */
describe("webhook stripe — dos entregas del mismo pago (carrera)", () => {
  it("el UPDATE del boost lleva el estado en el WHERE, no solo en un if de arriba", async () => {
    const stub = useAdmin({
      payment_events: { insert: { error: null } },
      boosts: { select: { data: BOOST_ROW, error: null }, update: BOOST_ACTIVADO },
    });

    await POST(validRequestFor(boostEvent()));

    const predicados = stub.calls
      .filter((c) => c.table === "boosts" && c.method === "eq")
      .map((c) => c.args);
    expect(predicados).toContainEqual(["status", "pending_payment"]);
  });

  it("la entrega que PIERDE la carrera (cero filas) no manda una segunda notificación ni duplica la auditoría", async () => {
    const stub = useAdmin({
      payment_events: { insert: { error: null } },
      // El UPDATE corrió pero no tocó ninguna fila: otra entrega lo activó
      // medio milisegundo antes y el estado ya no es `pending_payment`.
      boosts: { select: { data: BOOST_ROW, error: null }, update: NINGUNA_FILA },
      audit_log: { insert: { error: null } },
    });

    const res = await POST(validRequestFor(boostEvent()));

    // 200: no es un fallo, es el resultado correcto de haber llegado segundo.
    expect(res.status).toBe(200);
    expect(mocks.createNotification).not.toHaveBeenCalled();
    expect(touched(stub, "audit_log", "insert")).toBe(false);
  });

  it("la campaña de post se comporta igual: cero filas ⇒ no se duplica nada", async () => {
    const stub = useAdmin({
      payment_events: { insert: { error: null } },
      post_promotions: { select: { data: PROMO_ROW, error: null }, update: NINGUNA_FILA },
      audit_log: { insert: { error: null } },
    });

    const res = await POST(validRequestFor(promoEvent()));

    expect(res.status).toBe(200);
    expect(mocks.createNotification).not.toHaveBeenCalled();
    expect(touched(stub, "audit_log", "insert")).toBe(false);
  });

  it("identity: la segunda entrega no vuelve a notificar ni a auditar", async () => {
    const stub = useAdmin({
      payment_events: { insert: { error: null } },
      profiles: { select: { data: PROFILE_ROW, error: null }, update: NINGUNA_FILA },
      trust_scores: { select: { data: null, error: null }, upsert: { error: null } },
      audit_log: { insert: { error: null } },
    });

    const res = await POST(validRequestFor(identityEvent()));

    expect(res.status).toBe(200);
    expect(mocks.createNotification).not.toHaveBeenCalled();
    // Y sobre todo: no se vuelve a tocar el Trust Score.
    expect(touched(stub, "trust_scores", "upsert")).toBe(false);
  });
});

/* ======================================================================== */
/* 7. EL TRUST SCORE DE QUIEN PAGÓ POR VERIFICARSE                          */
/* ======================================================================== */

/**
 * `handleIdentityVerified` hace un read-modify-write: lee `trust_scores`, suma
 * 25 y hace `upsert` con `onConflict: profile_id` — que pisa `score` y REEMPLAZA
 * `signals` entero.
 *
 * El `error` del select se descartaba. Como el cliente de Supabase no lanza,
 * un fallo de lectura dejaba `data` en null, indistinguible de "no tiene fila":
 * alguien con score 85 y señales acumuladas terminaba con score 25 y UNA señal
 * justo después de pagar por subir de nivel. Y sin log.
 */
describe("webhook stripe — Trust Score al verificar identidad", () => {
  it("un select fallido de trust_scores NO pisa el score: no hay upsert y el evento queda para reintento", async () => {
    const stub = useAdmin({
      payment_events: { insert: { error: null }, update: { error: null } },
      profiles: { select: { data: PROFILE_ROW, error: null }, update: PROFILE_VERIFICADO },
      // Timeout de lectura: el caso exacto que reseteaba el score.
      trust_scores: { select: { data: null, error: { code: "57014" } }, upsert: { error: null } },
    });

    const res = await POST(validRequestFor(identityEvent()));

    // 500 ⇒ Stripe reintenta y el reintento reprocesa (processed quedó en false).
    expect(res.status).toBe(500);
    // Lo que importa: NADA se escribió sobre el score con un dato que no se leyó.
    expect(touched(stub, "trust_scores", "upsert")).toBe(false);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("con la lectura OK, suma sobre el score existente y CONSERVA las señales previas", async () => {
    const stub = useAdmin({
      payment_events: { insert: { error: null }, update: { error: null } },
      profiles: { select: { data: PROFILE_ROW, error: null }, update: PROFILE_VERIFICADO },
      trust_scores: {
        select: { data: { score: 85, signals: { vecino_referido: true } }, error: null },
        upsert: { error: null },
      },
      audit_log: { insert: { error: null } },
    });

    const res = await POST(validRequestFor(identityEvent()));

    expect(res.status).toBe(200);
    const upsert = stub.calls.find((c) => c.table === "trust_scores" && c.method === "upsert");
    const fila = upsert?.args[0] as { score: number; signals: Record<string, unknown> };
    // 85 + 25 = 110, clampeado a 100 — no 25.
    expect(fila.score).toBe(100);
    // Y la señal que ya tenía sigue ahí: el upsert reemplaza `signals` entero.
    expect(fila.signals.vecino_referido).toBe(true);
    expect(fila.signals.identity_verified).toBe(true);
  });
});

/* ======================================================================== */
/* 8. LA AUDITORÍA DE LAS ACTIVACIONES PAGAS                                */
/* ======================================================================== */

describe("webhook stripe — auditoría best-effort, pero con log", () => {
  it("si el insert en audit_log falla, la activación sigue valiendo y el fallo queda logueado", async () => {
    const stub = useAdmin({
      payment_events: { insert: { error: null } },
      boosts: { select: { data: BOOST_ROW, error: null }, update: BOOST_ACTIVADO },
      audit_log: { insert: { error: { code: "42501" } } },
    });

    const res = await POST(validRequestFor(boostEvent()));

    // La compra se entrega igual: la auditoría nunca rompe una activación.
    expect(res.status).toBe(200);
    expect(touched(stub, "boosts", "update")).toBe(true);
    expect(mocks.createNotification).toHaveBeenCalledTimes(1);
    // Pero no se pierde en silencio, que era el punto.
    const mensaje = errorSpy.mock.calls.flat().join(" ");
    expect(mensaje).toContain("auditar");
    expect(mensaje).toContain("boost-1");
  });
});
