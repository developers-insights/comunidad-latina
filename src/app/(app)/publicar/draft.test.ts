import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests de `createListingDraft` — el ALTA de /publicar.
 *
 * El archivo hermano (`actions.test.ts`) cubre el CIERRE (`finalizeListing`):
 * moderación, fotos y cola. Éste cubre lo otro, que hasta ahora no tenía red:
 * qué se acepta, qué se rechaza y —sobre todo— QUÉ TERMINA ESCRITO en la fila.
 *
 * LO QUE ESTOS TESTS CUIDAN, en orden de importancia:
 *
 *  1. QUE LA VENTA NO SE PUEDA CREAR, y que rechazarla no sea "revisá los
 *     datos" sino un mensaje que explique la política. La spec la cerró
 *     («No se incluirán propiedades en venta ni Open Houses») y el formulario ya
 *     no ofrece la opción — pero una pestaña abierta desde antes del cambio, o
 *     una llamada directa a la action, sigue pudiendo mandarla.
 *
 *  2. QUE LAS VENTAS QUE YA EXISTEN NO SE ROMPAN. Cerrar la escritura no puede
 *     tocar la lectura: `PROPERTY_OPERATIONS` sigue conociendo `venta`, así que
 *     el chip del detalle y el filtro del listado siguen encontrándolas. Se
 *     verifica contra el módulo real, no contra una copia.
 *
 *  3. Que un evento GRATIS no se publique con precio, y que un evento EN LÍNEA
 *     no arrastre una dirección.
 *
 * Bordes aislados con el patrón del repo: `vi.hoisted` + `vi.mock` + un query
 * builder falso, encadenable y thenable. Nunca se toca Supabase real.
 */

const mocks = vi.hoisted(() => ({
  requireTenantMatch: vi.fn(),
  limit: vi.fn(),
  requireIdentidadVerificada: vi.fn(),
}));

vi.mock("@/lib/tenant/guard", () => ({ requireTenantMatch: mocks.requireTenantMatch }));
vi.mock("@/lib/rate-limit", () => ({
  DAY_MS: 86_400_000,
  HOUR_MS: 3_600_000,
  limit: mocks.limit,
}));
// Gate de identidad (spec cliente, cerrado 2026-08-31): se mockea en el
// LÍMITE del módulo, igual que requireTenantMatch — gate.ts ya tiene su
// propia batería de tests (./src/lib/verificacion/gate.test.ts) contra el
// contrato de la 0106/0121; acá sólo se prueba la INTEGRACIÓN — que
// createListingDraft lo llame con el kind/precio correctos, en el momento
// correcto, y que traduzca el rechazo al resultado tipado que espera la UI.
vi.mock("@/lib/verificacion/gate", () => ({
  requireIdentidadVerificada: mocks.requireIdentidadVerificada,
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/config/services", () => ({ isVisionConfigured: false }));
vi.mock("@/lib/monetization", () => ({
  MONETIZATION_COPY: { errors: { tooManyPhotos: (max: number) => `máx ${max}` } },
  checkPhotoCount: vi.fn(() => ({ ok: true, max: 4 })),
}));
vi.mock("@/lib/moderation", () => ({
  TIER_AUTO: 1,
  TIER_REVIEW: 2,
  TIER_HUMAN: 3,
  moderateText: vi.fn(),
  moderationTier: vi.fn(),
  enqueueModeration: vi.fn(),
}));

import { PROPERTY_OPERATIONS, PROPERTY_TYPES } from "@/lib/propiedades/tipos";
import { createListingDraft, type DraftInput } from "./actions";

/* -------------------------------- Fixtures -------------------------------- */

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "99999999-9999-4999-8999-999999999999";
const LISTING_ID = "44444444-4444-4444-8444-444444444444";

interface RecordedCall {
  table: string;
  method: string;
  args: unknown[];
}

/** Query builder falso, encadenable y thenable (patrón del repo). */
function createSupabaseStub() {
  const calls: RecordedCall[] = [];
  const from = vi.fn((table: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = {
      insert: vi.fn((...args: unknown[]) => {
        calls.push({ table, method: "insert", args });
        return builder;
      }),
      select: vi.fn(() => builder),
      single: vi.fn(async () => ({ data: { id: LISTING_ID }, error: null })),
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: null, error: null }).then(resolve),
    };
    return builder;
  });
  return { client: { from }, calls };
}

function useGuardOk() {
  const stub = createSupabaseStub();
  mocks.requireTenantMatch.mockResolvedValue({
    ok: true,
    tenant: { id: TENANT_ID, slug: "dominicanos", name: "Dominicanos", currency: "USD" },
    supabase: stub.client,
    user: { id: USER_ID },
  });
  return stub;
}

/** La fila que efectivamente se mandó a `listings.insert`. */
function insertedRow(stub: ReturnType<typeof createSupabaseStub>) {
  const call = stub.calls.find(
    (entry) => entry.table === "listings" && entry.method === "insert",
  );
  return call?.args[0] as Record<string, unknown> | undefined;
}

function attrsOf(stub: ReturnType<typeof createSupabaseStub>) {
  return (insertedRow(stub)?.attrs ?? {}) as Record<string, unknown>;
}

const RENTAL: DraftInput = {
  kind: "property",
  title: "Cuarto amplio en casa compartida",
  description:
    "Cuarto con placard en casa tranquila, a tres cuadras del tren. Servicios incluidos.",
  priceAmount: 900,
  pricePeriod: "month",
  propertyType: "cuarto",
  operation: "alquiler",
  areaLabel: "Washington Heights, NYC",
};

const EVENT: DraftInput = {
  kind: "event",
  title: "Fiesta de la independencia dominicana",
  description:
    "Música en vivo, comida típica y baile hasta tarde. Vengan con toda la familia.",
  areaLabel: "Corona, Queens",
  eventStartsAt: "2026-09-01T20:00",
  eventCategory: "fiesta",
  eventMode: "presencial",
  eventFree: true,
};

const JOB: DraftInput = {
  kind: "job",
  title: "Se busca ayudante de cocina en Queens",
  description:
    "Turno de tarde, restaurante familiar dominicano. Buen ambiente y buenas propinas.",
  areaLabel: "Corona, Queens",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  mocks.limit.mockReturnValue({ ok: true, remaining: 9, retryAfterMs: 0 });
  // Default permisivo: cada test que NO es sobre el gate no tiene que acordarse
  // de habilitarlo. Los tests del gate lo pisan explícitamente.
  mocks.requireIdentidadVerificada.mockResolvedValue({ permitido: true });
});

/* ------------------------ 1. La venta ya no se crea ----------------------- */

describe("propiedades — la venta dejó de aceptarse", () => {
  it("rechaza operation='venta' con el motivo real, no con un genérico", async () => {
    const stub = useGuardOk();

    const result = await createListingDraft({
      ...RENTAL,
      operation: "venta",
      pricePeriod: "one_time",
      priceAmount: 450_000,
    });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/solo alquileres/i);
    // Nada llegó a la base: se corta en el esquema, antes del guard.
    expect(stub.calls).toHaveLength(0);
  });

  /**
   * Corregir en silencio convertiría la venta de $450.000 que alguien quiso
   * publicar en un ALQUILER de $450.000. Rechazar y explicar es lo correcto;
   * "arreglarlo" sería fabricar un dato falso.
   */
  it("NO reescribe la venta a alquiler para dejarla pasar", async () => {
    const stub = useGuardOk();
    await createListingDraft({ ...RENTAL, operation: "venta", pricePeriod: "one_time" });
    expect(insertedRow(stub)).toBeUndefined();
  });

  it("el alquiler se sigue creando igual que siempre", async () => {
    const stub = useGuardOk();

    const result = await createListingDraft(RENTAL);

    expect(result).toEqual({ ok: true, listingId: LISTING_ID });
    expect(attrsOf(stub).operation).toBe("alquiler");
    expect(attrsOf(stub).property_type).toBe("cuarto");
  });

  /**
   * La operación se escribe SIEMPRE, aunque hoy sólo haya una publicable: el
   * filtro del listado (`attrs->>operation`) lee el DATO guardado, no la
   * política vigente el día que se publicó. Un alquiler sin `operation` sería
   * invisible para ese filtro.
   */
  it("escribe la operación aunque el cliente no la mande", async () => {
    const stub = useGuardOk();
    await createListingDraft({ ...RENTAL, operation: null });
    expect(attrsOf(stub).operation).toBe("alquiler");
  });

  it("acepta el tipo 'vivienda compartida' que pide la spec", async () => {
    const stub = useGuardOk();
    const result = await createListingDraft({ ...RENTAL, propertyType: "vivienda_compartida" });
    expect(result.ok).toBe(true);
    expect(attrsOf(stub).property_type).toBe("vivienda_compartida");
  });
});

/* ------------- 2. Las ventas que ya existen se siguen leyendo ------------- */

describe("propiedades — lo ya publicado no se rompe", () => {
  /**
   * Cerrar la ESCRITURA no puede cerrar la LECTURA. Si `venta` desapareciera
   * del vocabulario, `normalizePropertyOperation` devolvería null para los
   * avisos que ya están: el chip "Venta" se caería del detalle y el filtro por
   * operación dejaría de encontrarlos — todo sin un solo error. Un aviso que
   * existe y no se puede leer es peor que uno que no se puede crear.
   */
  it("el vocabulario de LECTURA conserva 'venta'", () => {
    expect([...PROPERTY_OPERATIONS].sort()).toEqual(["alquiler", "venta"]);
  });

  it("los tipos que ya se usaban siguen estando", () => {
    for (const type of ["casa", "departamento", "cuarto", "estudio", "townhouse", "otro"]) {
      expect(PROPERTY_TYPES).toContain(type);
    }
  });
});

/* ---------------------- 3. Condiciones del alquiler ---------------------- */

describe("propiedades — condiciones del alquiler", () => {
  it("guarda sólo lo declarado, en las claves del contrato", async () => {
    const stub = useGuardOk();

    await createListingDraft({
      ...RENTAL,
      deposit: 1800,
      extraFees: "agua $30 por mes",
      utilities: ["agua", "luz"],
      requirements: ["referencias"],
      furnished: "parcial",
      availableFrom: "2026-09-15",
    });

    expect(attrsOf(stub)).toMatchObject({
      deposit_amount: 1800,
      extra_fees: "agua $30 por mes",
      // Orden del CATÁLOGO, no el de llegada.
      utilities_included: ["luz", "agua"],
      rental_requirements: ["referencias"],
      furnished: "parcial",
      available_from: "2026-09-15",
    });
  });

  /**
   * "No pido depósito" es una afirmación fuerte y buena para quien alquila. Un
   * `if (deposit)` la borraría en silencio porque 0 es falsy.
   */
  it("un depósito en CERO se guarda; uno ausente no se inventa", async () => {
    const conCero = useGuardOk();
    await createListingDraft({ ...RENTAL, deposit: 0 });
    expect(attrsOf(conCero).deposit_amount).toBe(0);

    const sinDato = useGuardOk();
    await createListingDraft(RENTAL);
    expect(attrsOf(sinDato)).not.toHaveProperty("deposit_amount");
  });

  it("descarta servicios y requisitos que no están en el catálogo", async () => {
    const stub = useGuardOk();
    await createListingDraft({
      ...RENTAL,
      utilities: ["luz", "wifi", "helicoptero"],
      requirements: ["visa", "referencias"],
    });
    expect(attrsOf(stub).utilities_included).toEqual(["luz"]);
    expect(attrsOf(stub).rental_requirements).toEqual(["referencias"]);
  });

  it("un aviso sin ninguna condición no escribe ninguna clave de más", async () => {
    const stub = useGuardOk();
    await createListingDraft(RENTAL);
    const attrs = attrsOf(stub);
    for (const key of [
      "deposit_amount",
      "extra_fees",
      "utilities_included",
      "rental_requirements",
      "furnished",
      "available_from",
    ]) {
      expect(attrs).not.toHaveProperty(key);
    }
  });
});

/* ------------------------------ 4. Eventos ------------------------------- */

describe("eventos", () => {
  it("un evento gratis se guarda con free=true y SIN precio", async () => {
    const stub = useGuardOk();

    // Se manda un precio a propósito: se puede escribirlo, volver atrás y
    // marcar "gratis". Publicar "Gratis · $25" sería mentirle a quien lee.
    await createListingDraft({ ...EVENT, eventFree: true, priceAmount: 25 });

    expect(attrsOf(stub).free).toBe(true);
    expect(insertedRow(stub)?.price_amount).toBeNull();
    expect(insertedRow(stub)?.price_period).toBeNull();
  });

  it("un evento pago conserva su precio", async () => {
    const stub = useGuardOk();
    await createListingDraft({ ...EVENT, eventFree: false, priceAmount: 25 });
    expect(attrsOf(stub).free).toBe(false);
    expect(insertedRow(stub)?.price_amount).toBe(25);
  });

  it("guarda categoría, capacidad, público y fin", async () => {
    const stub = useGuardOk();

    await createListingDraft({
      ...EVENT,
      eventEndsAt: "2026-09-02T02:00",
      eventCapacity: 120,
      eventAudience: "familias",
    });

    const attrs = attrsOf(stub);
    expect(attrs.category).toBe("fiesta");
    expect(attrs.capacity).toBe(120);
    expect(attrs.audience).toBe("familias");
    expect(attrs.starts_at).toBe(new Date("2026-09-01T20:00").toISOString());
    expect(attrs.ends_at).toBe(new Date("2026-09-02T02:00").toISOString());
    // `venue_area` es la clave que ya leía parseEventAttrs; no se renombró.
    expect(attrs.venue_area).toBe(EVENT.areaLabel);
  });

  it("rechaza un fin anterior al inicio en vez de descartarlo en silencio", async () => {
    const stub = useGuardOk();

    const result = await createListingDraft({ ...EVENT, eventEndsAt: "2026-09-01T18:00" });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/posterior a la de inicio/i);
    expect(stub.calls).toHaveLength(0);
  });

  it("exige el enlace en un evento en línea", async () => {
    const result = await createListingDraft({
      ...EVENT,
      eventMode: "virtual",
      eventOnlineUrl: null,
    });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/enlace/i);
  });

  it("guarda el enlace virtual sólo si el evento es virtual", async () => {
    const virtual = useGuardOk();
    await createListingDraft({
      ...EVENT,
      eventMode: "virtual",
      eventOnlineUrl: "https://meet.example.com/sala",
    });
    expect(attrsOf(virtual).online_url).toBe("https://meet.example.com/sala");

    // Un enlace pegado a un evento presencial pondría un botón "entrar" en un
    // evento al que hay que ir.
    const presencial = useGuardOk();
    await createListingDraft({
      ...EVENT,
      eventMode: "presencial",
      eventOnlineUrl: "https://meet.example.com/sala",
    });
    expect(attrsOf(presencial)).not.toHaveProperty("online_url");
  });

  it("el enlace de entradas va a attrs (base, gratis), nunca a la columna premium", async () => {
    const stub = useGuardOk();

    await createListingDraft({ ...EVENT, eventTicketsUrl: "https://boleteria.com/fiesta" });

    // La 0048 le prohíbe cta_tickets_url a un aviso `free`, y un aviso NACE
    // free: escribirla acá haría fallar el INSERT entero.
    expect(attrsOf(stub).tickets_url).toBe("https://boleteria.com/fiesta");
    expect(insertedRow(stub)).not.toHaveProperty("cta_tickets_url");
  });

  it("avisa cuando el enlace de entradas no se entiende, en vez de tragárselo", async () => {
    const result = await createListingDraft({
      ...EVENT,
      eventTicketsUrl: "javascript:alert(1)",
    });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/enlace de entradas/i);
  });

  it("exige la categoría y la modalidad", async () => {
    expect((await createListingDraft({ ...EVENT, eventMode: null })).ok).toBe(false);
    // La categoría no está en el catálogo → no se guarda, pero tampoco frena el
    // alta: la taxonomía es lo que la UI conoce, no una restricción del JSONB.
    const stub = useGuardOk();
    const result = await createListingDraft({ ...EVENT, eventCategory: "carnaval" });
    expect(result.ok).toBe(true);
    expect(attrsOf(stub)).not.toHaveProperty("category");
  });
});

/* --------------------- 5. Gate de identidad (2026-08-31) ------------------ */

describe("createListingDraft — gate de identidad", () => {
  it("property: sin identidad verificada, corta antes del rate limit y no inserta", async () => {
    mocks.requireIdentidadVerificada.mockResolvedValue({
      permitido: false,
      motivo: "identidad_no_verificada",
    });
    const stub = useGuardOk();

    const result = await createListingDraft(RENTAL);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.needsIdentity).toBe(true);
      expect(result.error).toMatch(/identidad/i);
    }
    expect(mocks.limit).not.toHaveBeenCalled();
    expect(stub.calls).toHaveLength(0);
  });

  it("job: también gatea, aunque no sea vivienda", async () => {
    mocks.requireIdentidadVerificada.mockResolvedValue({
      permitido: false,
      motivo: "identidad_no_verificada",
    });
    const stub = useGuardOk();

    const result = await createListingDraft(JOB);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.needsIdentity).toBe(true);
    expect(stub.calls).toHaveLength(0);
  });

  /**
   * OJO CON EL LÍMITE DEL MOCK: acá no se prueba "un evento gratis nunca
   * gatea" preguntándole al MOCK que conteste `permitido: false` — eso
   * probaría lo contrario de lo real, porque createListingDraft SIEMPRE
   * delega en `requireIdentidadVerificada()` (nunca pre-filtra el kind con su
   * propia copia de `verticalExigeIdentidad`) y el corto-circuito para
   * "esta vertical no exige nada" vive DENTRO de gate.ts — que acá está
   * mockeado entero. Lo que SÍ es responsabilidad de esta action, y lo que
   * este test prueba, es que le pregunte con el precio CORRECTO (null para
   * un evento gratis, sin importar lo que traiga el payload crudo) — la
   * garantía de que un evento gratis nunca bloquea en la práctica la da
   * gate.test.ts, contra la función real.
   */
  it("un evento GRATIS pregunta con precio null (nunca con el crudo del payload)", async () => {
    const stub = useGuardOk();

    const result = await createListingDraft({ ...EVENT, eventFree: true });

    expect(result.ok).toBe(true);
    expect(mocks.requireIdentidadVerificada).toHaveBeenCalledWith(stub.client, {
      kind: "event",
      precio: null,
    });
  });

  it("un evento PAGO sin identidad verificada gatea", async () => {
    mocks.requireIdentidadVerificada.mockResolvedValue({
      permitido: false,
      motivo: "identidad_no_verificada",
    });
    useGuardOk();

    const result = await createListingDraft({ ...EVENT, eventFree: false, priceAmount: 25 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.needsIdentity).toBe(true);
  });

  /**
   * EL CASO QUE ESTE GATE TIENE QUE ACERTAR: se puede escribir un precio,
   * volver atrás y marcar "gratis" — el campo `priceAmount` del payload sigue
   * teniendo el número viejo. Si el gate preguntara con el precio CRUDO en vez
   * del YA RESUELTO (mismo cálculo que termina en la fila), un evento
   * declarado gratis exigiría identidad igual. Espeja el test de
   * actions.test.ts / draft.test.ts "un evento gratis se guarda con free=true
   * y SIN precio".
   */
  it("un evento marcado GRATIS con priceAmount viejo en el payload pregunta con precio null", async () => {
    useGuardOk();

    await createListingDraft({ ...EVENT, eventFree: true, priceAmount: 25 });

    expect(mocks.requireIdentidadVerificada).toHaveBeenCalledWith(
      expect.anything(),
      { kind: "event", precio: null },
    );
  });

  it("le pasa a la RPC el precio real de un evento pago", async () => {
    useGuardOk();

    await createListingDraft({ ...EVENT, eventFree: false, priceAmount: 25 });

    expect(mocks.requireIdentidadVerificada).toHaveBeenCalledWith(
      expect.anything(),
      { kind: "event", precio: 25 },
    );
  });

  it("business y professional preguntan igual (gate.ts decide no viajar a la base), pero nunca bloquean con el mock permisivo", async () => {
    const negocio = useGuardOk();
    const resultNegocio = await createListingDraft({
      kind: "business",
      title: "Panadería dominicana en Jackson Heights",
      description: "Pan de agua, pan de leche y bizcochos hechos todos los días.",
      areaLabel: "Jackson Heights, Queens",
    });
    expect(resultNegocio.ok).toBe(true);
    expect(mocks.requireIdentidadVerificada).toHaveBeenCalledWith(negocio.client, {
      kind: "business",
      precio: null,
    });

    const profesional = useGuardOk();
    const resultProfesional = await createListingDraft({
      kind: "professional",
      title: "Abogado de inmigración en Queens",
      description: "Casos de asilo, residencia y ciudadanía. Primera consulta gratis.",
      areaLabel: "Corona, Queens",
      category: "abogado",
    });
    expect(resultProfesional.ok).toBe(true);
    expect(mocks.requireIdentidadVerificada).toHaveBeenCalledWith(profesional.client, {
      kind: "professional",
      precio: null,
    });
  });

  it("con identidad verificada, property pasa el gate y publica el borrador", async () => {
    mocks.requireIdentidadVerificada.mockResolvedValue({ permitido: true });
    const stub = useGuardOk();

    const result = await createListingDraft(RENTAL);

    expect(result).toEqual({ ok: true, listingId: LISTING_ID });
    expect(mocks.limit).toHaveBeenCalledWith(`publicar:${USER_ID}`, 10, 86_400_000);
    expect(insertedRow(stub)).toMatchObject({ kind: "property", status: "draft" });
  });
});
