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
        op = "select";
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

const BOOST_ROW = {
  id: "boost-1",
  tenant_id: "tenant-1",
  listing_id: "listing-1",
  buyer_id: "buyer-1",
  duration_days: 7,
  status: "pending_payment",
  amount_cents: 1000,
  stripe_checkout_session_id: "cs_test_boost_1",
  listings: { kind: "property" },
};

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
      boosts: { select: { data: BOOST_ROW, error: null }, update: { error: null } },
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
      boosts: { select: { data: BOOST_ROW, error: null }, update: { error: null } },
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
        update: { error: null },
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
        update: { error: null },
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
        update: { error: null },
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
      boosts: { select: { data: BOOST_ROW, error: null }, update: { error: null } },
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
      boosts: { select: { data: BOOST_ROW, error: null }, update: { error: null } },
    });

    const res = await POST(validRequestFor(boostEvent({ payment_status: "unpaid" })));

    expect(res.status).toBe(200);
    // Pago async pendiente: se espera a async_payment_succeeded, no se activa aún.
    expect(touched(stub, "boosts", "update")).toBe(false);
  });
});
