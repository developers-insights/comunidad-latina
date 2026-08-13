import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * =============================================================================
 * Tests de las server actions de PAQUETES DE SERVICIO (0102)
 * =============================================================================
 *
 * Lo que se prueba acá es la frontera, no la UI. Tres garantías:
 *
 *  1. AUTORIZACIÓN — un creador no toca los paquetes de otro. La RLS de la 0102
 *     ya lo impide, pero la action NO se apoya sólo en eso: cada escritura
 *     viaja con `.eq(creator_id, auth.uid())` y `.eq(tenant_id)` explícitos.
 *     Estos tests verifican que esos filtros están EN LA QUERY — si alguien los
 *     borra "porque la RLS ya cubre", el test se pone rojo. Es la misma
 *     doctrina que el candado `.in(status, …)` de finalizeGig.
 *
 *  2. PLATA — el precio se valida en el SERVIDOR. El cliente manda TEXTO y el
 *     servidor lo reparsea: un POST a mano con "-5", "0" o un millón y pico no
 *     llega a escribir nada.
 *
 *  3. CONTACTO (§6) — el texto de un paquete es la vidriera pública del
 *     creador. Un teléfono ahí adentro se frena ANTES de guardarse, igual que
 *     en la postulación y en la propuesta de contrato.
 *
 * Se aíslan los bordes con el patrón del repo (`vi.hoisted` + `vi.mock` + stub
 * encadenable/thenable). Nunca se toca Supabase real. `contact-block` NO se
 * mockea: se quiere el detector de verdad.
 */

const mocks = vi.hoisted(() => ({
  requireTenantMatch: vi.fn(),
  limit: vi.fn(),
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/tenant/guard", () => ({ requireTenantMatch: mocks.requireTenantMatch }));
vi.mock("@/lib/rate-limit", () => ({
  DAY_MS: 86_400_000,
  HOUR_MS: 3_600_000,
  limit: mocks.limit,
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/config/services", () => ({ isVisionConfigured: false }));
vi.mock("@/lib/moderation", () => ({
  TIER_AUTO: 1,
  TIER_REVIEW: 2,
  TIER_HUMAN: 3,
  moderateText: vi.fn(),
  moderationTier: vi.fn(),
  enqueueModeration: vi.fn(),
}));

import {
  deleteServicePackage,
  reorderServicePackages,
  saveServicePackage,
  setServicePackageActive,
} from "./actions";

/* -------------------------------- Fixtures -------------------------------- */

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
/** Quien tiene la sesión. */
const USER_ID = "99999999-9999-4999-8999-999999999999";
/** El paquete de OTRA persona que se intenta tocar. */
const OTRO_PAQUETE = "55555555-5555-4555-8555-555555555555";
const MI_PAQUETE = "66666666-6666-4666-8666-666666666666";

const TABLE = "creator_service_packages";

type OpResult = { data?: unknown; error?: unknown; count?: number };
type TableOps = Partial<Record<"select" | "insert" | "update" | "delete", OpResult>>;

interface RecordedCall {
  table: string;
  method: string;
  args: unknown[];
}

function createSupabaseStub(config: Record<string, TableOps> = {}) {
  const calls: RecordedCall[] = [];

  const from = vi.fn((table: string) => {
    const tableConfig: TableOps = config[table] ?? {};
    let op: keyof TableOps | null = null;
    const result = () =>
      (op ? (tableConfig[op] ?? { data: null, error: null }) : { data: null, error: null });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = {
      select: vi.fn((...args: unknown[]) => {
        calls.push({ table, method: "select", args });
        op = op ?? "select";
        return builder;
      }),
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
      delete: vi.fn((...args: unknown[]) => {
        calls.push({ table, method: "delete", args });
        op = "delete";
        return builder;
      }),
      eq: vi.fn((...args: unknown[]) => {
        calls.push({ table, method: "eq", args });
        return builder;
      }),
      order: vi.fn(() => builder),
      limit: vi.fn(() => builder),
      maybeSingle: vi.fn(async () => result()),
      then: (resolve: (v: OpResult) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve(result()).then(resolve, reject),
    };
    return builder;
  });

  return { client: { from }, from, calls };
}

function useGuardOk(config: Record<string, TableOps> = {}) {
  const stub = createSupabaseStub(config);
  mocks.requireTenantMatch.mockResolvedValue({
    ok: true,
    tenant: { id: TENANT_ID, slug: "dominicanos", name: "Dominicanos", currency: "USD" },
    supabase: stub.client,
    user: { id: USER_ID },
  });
  return stub;
}

/** Los `.eq()` que se le pidieron a una tabla, como pares [columna, valor]. */
function eqPairs(calls: RecordedCall[], table = TABLE): [string, unknown][] {
  return calls
    .filter((c) => c.table === table && c.method === "eq")
    .map((c) => [c.args[0] as string, c.args[1]]);
}

const PAQUETE_VALIDO = {
  title: "Pack 3 reels para redes",
  description: "Tres videos verticales de 30 segundos, editados y con música.",
  includes: ["3 reels de 30s", "1 ronda de cambios"],
  price: "800",
  deliveryDays: 7,
  active: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  mocks.limit.mockReturnValue({ ok: true, remaining: 59, retryAfterMs: 0 });
});

/* ========================================================================== */
/* 1. AUTORIZACIÓN — nadie toca los paquetes de otro                          */
/* ========================================================================== */

describe("autorización — un creador no edita ni borra paquetes ajenos", () => {
  it("editar: el UPDATE viaja acotado por dueño Y comunidad", async () => {
    const stub = useGuardOk({
      [TABLE]: { update: { data: null, error: null } }, // la DB no matcheó fila
    });

    const result = await saveServicePackage({ ...PAQUETE_VALIDO, id: OTRO_PAQUETE });

    // No se pretende que funcionó: sin fila, la action lo dice.
    expect(result.ok).toBe(false);

    const pairs = eqPairs(stub.calls);
    // Los tres candados. `creator_id` es el que impide que el id ajeno del
    // input alcance para escribir: sin él, la action estaría confiando en que
    // la RLS es lo único entre un id de otro y un UPDATE.
    expect(pairs).toContainEqual(["id", OTRO_PAQUETE]);
    expect(pairs).toContainEqual(["tenant_id", TENANT_ID]);
    expect(pairs).toContainEqual(["creator_id", USER_ID]);
  });

  it("borrar: el DELETE viaja acotado por dueño Y comunidad", async () => {
    const stub = useGuardOk({
      [TABLE]: { delete: { data: null, error: null } },
    });

    const result = await deleteServicePackage({ id: OTRO_PAQUETE });

    expect(result.ok).toBe(false);
    const pairs = eqPairs(stub.calls);
    expect(pairs).toContainEqual(["id", OTRO_PAQUETE]);
    expect(pairs).toContainEqual(["tenant_id", TENANT_ID]);
    expect(pairs).toContainEqual(["creator_id", USER_ID]);
    // Y que efectivamente se pidió un DELETE sobre la tabla correcta.
    expect(stub.calls.some((c) => c.table === TABLE && c.method === "delete")).toBe(true);
  });

  it("apagar: el toggle ajeno tampoco prospera y va acotado", async () => {
    const stub = useGuardOk({
      [TABLE]: { update: { data: null, error: null } },
    });

    const result = await setServicePackageActive({ id: OTRO_PAQUETE, active: false });

    expect(result.ok).toBe(false);
    const pairs = eqPairs(stub.calls);
    expect(pairs).toContainEqual(["creator_id", USER_ID]);
    expect(pairs).toContainEqual(["tenant_id", TENANT_ID]);
  });

  it("reordenar: cada UPDATE toca sólo sort_order y va acotado por dueño", async () => {
    const stub = useGuardOk({
      [TABLE]: { update: { data: null, error: null } },
    });

    await reorderServicePackages({ ids: [MI_PAQUETE, OTRO_PAQUETE] });

    const updates = stub.calls.filter((c) => c.table === TABLE && c.method === "update");
    expect(updates).toHaveLength(2);
    // NADA más que el orden: un "reordenamiento" no puede colar un precio.
    for (const update of updates) {
      expect(Object.keys(update.args[0] as object)).toEqual(["sort_order"]);
    }
    const pairs = eqPairs(stub.calls);
    expect(pairs.filter(([col]) => col === "creator_id")).toHaveLength(2);
    expect(pairs.filter(([col]) => col === "tenant_id")).toHaveLength(2);
  });

  it("el alta fija creator_id y tenant_id desde la SESIÓN, no desde el input", async () => {
    const stub = useGuardOk({
      [TABLE]: {
        select: { count: 0, data: [], error: null },
        insert: { data: { id: MI_PAQUETE }, error: null },
      },
    });

    const result = await saveServicePackage(PAQUETE_VALIDO);

    expect(result).toEqual({ ok: true, id: MI_PAQUETE });
    const insert = stub.calls.find((c) => c.table === TABLE && c.method === "insert");
    expect(insert?.args[0]).toMatchObject({
      tenant_id: TENANT_ID,
      creator_id: USER_ID,
      price_cents: 80_000,
      currency: "usd",
      delivery_days: 7,
    });
  });
});

/* ========================================================================== */
/* 2. PLATA — el precio se valida en el servidor                              */
/* ========================================================================== */

describe("precio — validado en el SERVIDOR, no en el formulario", () => {
  it.each([
    ["cero", "0"],
    ["negativo", "-5"],
    ["tres decimales", "19.999"],
    ["separador de miles ambiguo", "1.234,56"],
    ["por encima del techo del contrato", "1000001"],
    ["texto", "ochocientos"],
  ])("rechaza %s SIN escribir nada", async (_caso, price) => {
    const stub = useGuardOk();

    const result = await saveServicePackage({ ...PAQUETE_VALIDO, price });

    expect(result.ok).toBe(false);
    // Ni una lectura ni una escritura: el rechazo es anterior a tocar la base.
    expect(stub.from).not.toHaveBeenCalled();
  });

  it("acepta centavos exactos sin perderlos por el camino", async () => {
    const stub = useGuardOk({
      [TABLE]: {
        select: { count: 0, data: [], error: null },
        insert: { data: { id: MI_PAQUETE }, error: null },
      },
    });

    await saveServicePackage({ ...PAQUETE_VALIDO, price: "150,50" });

    const insert = stub.calls.find((c) => c.table === TABLE && c.method === "insert");
    expect(insert?.args[0]).toMatchObject({ price_cents: 15_050 });
  });

  it("rechaza días de entrega fuera de rango sin tocar la base", async () => {
    const stub = useGuardOk();
    const result = await saveServicePackage({ ...PAQUETE_VALIDO, deliveryDays: 0 });
    expect(result.ok).toBe(false);
    expect(stub.from).not.toHaveBeenCalled();
  });
});

/* ========================================================================== */
/* 3. TOPE, CONTACTO Y CUOTA                                                  */
/* ========================================================================== */

describe("tope de paquetes", () => {
  it("con 6 ya cargados no intenta insertar el séptimo", async () => {
    const stub = useGuardOk({
      [TABLE]: { select: { count: 6, data: [], error: null } },
    });

    const result = await saveServicePackage(PAQUETE_VALIDO);

    expect(result.ok).toBe(false);
    expect(stub.calls.some((c) => c.method === "insert")).toBe(false);
  });

  it("si la carrera la gana otra pestaña, el 23514 del trigger se traduce a su mensaje", async () => {
    const stub = useGuardOk({
      [TABLE]: {
        select: { count: 5, data: [], error: null },
        insert: { data: null, error: { code: "23514" } },
      },
    });

    const result = await saveServicePackage(PAQUETE_VALIDO);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/hasta 6 paquetes/i);
    expect(stub.calls.some((c) => c.method === "insert")).toBe(true);
  });

  it("sin perfil de creador la RLS devuelve 42501 y se explica el paso que falta", async () => {
    useGuardOk({
      [TABLE]: {
        select: { count: 0, data: [], error: null },
        insert: { data: null, error: { code: "42501" } },
      },
    });

    const result = await saveServicePackage(PAQUETE_VALIDO);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/perfil de creador/i);
  });
});

describe("bloqueo de datos de contacto (§6)", () => {
  it("un teléfono en la descripción frena el guardado ANTES de escribir", async () => {
    const stub = useGuardOk();

    const result = await saveServicePackage({
      ...PAQUETE_VALIDO,
      description: "Tres reels editados. Escribime al +1 917 555 0142 y coordinamos.",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.contactBlocked).toBe(true);
    expect(stub.from).not.toHaveBeenCalled();
  });

  it("un precio con símbolo NO se confunde con un teléfono", async () => {
    // Falso positivo clásico: "$800 por 3 reels" tiene dígitos pero no es un
    // contacto. Si esto se rompe, el detector le rechaza el paquete a gente que
    // no hizo nada.
    const stub = useGuardOk({
      [TABLE]: {
        select: { count: 0, data: [], error: null },
        insert: { data: { id: MI_PAQUETE }, error: null },
      },
    });

    const result = await saveServicePackage({
      ...PAQUETE_VALIDO,
      description: "Son $800 por 3 reels de 30s, editados y listos para publicar.",
    });

    expect(result.ok).toBe(true);
    expect(stub.calls.some((c) => c.method === "insert")).toBe(true);
  });
});

describe("cuota", () => {
  it("agotada, no lee ni escribe nada", async () => {
    const stub = useGuardOk();
    mocks.limit.mockReturnValue({ ok: false, remaining: 0, retryAfterMs: 1000 });

    const result = await saveServicePackage(PAQUETE_VALIDO);

    expect(result.ok).toBe(false);
    expect(mocks.limit).toHaveBeenCalledWith(`creator-package:${USER_ID}`, 60, 3_600_000);
    expect(stub.from).not.toHaveBeenCalled();
  });
});

describe("sesión", () => {
  it("sin sesión pide entrar y no escribe", async () => {
    const stub = createSupabaseStub();
    mocks.requireTenantMatch.mockResolvedValue({
      ok: false,
      reason: "unauthenticated",
      message: "Entrá a tu cuenta",
      tenant: { id: TENANT_ID, slug: "d", name: "D", currency: "USD" },
      supabase: stub.client,
      user: null,
    });

    const result = await saveServicePackage(PAQUETE_VALIDO);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.needsAuth).toBe(true);
    expect(stub.from).not.toHaveBeenCalled();
  });
});
