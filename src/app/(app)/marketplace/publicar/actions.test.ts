import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests de `finalizeProduct` — el cierre de publicación del Marketplace.
 *
 * Se aíslan los bordes con el patrón del repo (empleos/publicar/actions.test.ts):
 * `vi.hoisted` + `vi.mock` + stub encadenable/thenable del query builder. Nunca
 * se toca Supabase real.
 *
 * Garantías cubiertas (auditoría de seguridad 2026-07-27 — espejo del fix ya
 * aplicado en empleos/publicar/actions.ts):
 *  - el UPDATE del dueño viaja con el candado `.in(status, draft|pending_review)`.
 *    La policy listings_update (0004) SÍ deja al dueño escribir pending_review
 *    desde 'removed', así que el filtro tiene que ir en la query: un producto
 *    dado de baja por moderación NO se re-publica re-llamando finalize.
 *  - si el candado no matchea fila, la action corta: ni publish vía admin
 *    (auto-aprobación dev) ni re-encolado de moderación.
 *  - finalize tiene cuota PROPIA (`marketplace-finalize`, 20/día): agotada,
 *    cero lecturas y cero escrituras.
 */

const mocks = vi.hoisted(() => ({
  requireTenantMatch: vi.fn(),
  limit: vi.fn(),
  moderateText: vi.fn(),
  moderationTier: vi.fn(),
  enqueueModeration: vi.fn(),
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
  moderateText: mocks.moderateText,
  moderationTier: mocks.moderationTier,
  enqueueModeration: mocks.enqueueModeration,
}));

import { createProductDraft, finalizeProduct } from "./actions";

/* -------------------------------- Fixtures -------------------------------- */

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "99999999-9999-4999-8999-999999999999";
const LISTING_ID = "44444444-4444-4444-8444-444444444444";

type OpResult = { data?: unknown; error?: unknown };
type TableOps = Partial<Record<"select" | "update" | "insert", OpResult>>;

interface RecordedCall {
  table: string;
  method: string;
  args: unknown[];
}

/** Query builder falso, encadenable y thenable (patrón engagement-actions.test.ts). */
function createSupabaseStub(config: Record<string, TableOps> = {}) {
  const calls: RecordedCall[] = [];

  const from = vi.fn((table: string) => {
    const tableConfig: TableOps = config[table] ?? {};
    let op: keyof TableOps | null = null;
    const result = () => (op ? (tableConfig[op] ?? { data: null, error: null }) : { data: null, error: null });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = {
      select: vi.fn((...args: unknown[]) => {
        calls.push({ table, method: "select", args });
        op = op ?? "select";
        return builder;
      }),
      update: vi.fn((...args: unknown[]) => {
        calls.push({ table, method: "update", args });
        op = "update";
        return builder;
      }),
      insert: vi.fn((...args: unknown[]) => {
        calls.push({ table, method: "insert", args });
        op = "insert";
        return builder;
      }),
      eq: vi.fn((...args: unknown[]) => {
        calls.push({ table, method: "eq", args });
        return builder;
      }),
      in: vi.fn((...args: unknown[]) => {
        calls.push({ table, method: "in", args });
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

function useAdmin(config: Record<string, TableOps> = {}) {
  const stub = createSupabaseStub(config);
  mocks.createAdminClient.mockReturnValue(stub.client);
  return stub;
}

const PRODUCT_ROW = {
  id: LISTING_ID,
  title: "Bicicleta rodado 29 casi nueva",
  description: "Usada tres meses, tiene luces y candado incluidos.",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  mocks.limit.mockReturnValue({ ok: true, remaining: 19, retryAfterMs: 0 });
  mocks.moderateText.mockResolvedValue({ flagged: false, score: 0, categories: [], skipped: false });
  mocks.moderationTier.mockReturnValue(1);
  mocks.enqueueModeration.mockResolvedValue({ ok: true });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

/* ---------------------------------- Tests --------------------------------- */

describe("finalizeProduct — un producto dado de baja NO se re-publica", () => {
  it("con status='removed' el UPDATE no matchea y corta sin publicar ni re-encolar", async () => {
    // Peor escenario: auto-aprobación dev activa — si el candado fallara, el
    // admin client re-publicaría el producto removido acá mismo.
    vi.stubEnv("MODERATION_DEV_AUTO_APPROVE", "true");
    const stub = useGuardOk({
      listings: {
        select: { data: PRODUCT_ROW, error: null },
        // La DB filtró la fila por el `.in(status, ...)`: cero filas afectadas.
        update: { data: null, error: null },
      },
    });
    useAdmin();

    const result = await finalizeProduct({ listingId: LISTING_ID, photoPaths: [] });

    expect(result.ok).toBe(false);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.enqueueModeration).not.toHaveBeenCalled();
    // El candado tiene que viajar EN la query: la RLS del dueño permite
    // removed → pending_review, así que sin este filtro el UPDATE prosperaría.
    expect(stub.calls).toContainEqual({
      table: "listings",
      method: "in",
      args: ["status", ["draft", "pending_review"]],
    });
  });

  it("camino feliz: un draft pasa a pending_review con el candado de status en el UPDATE", async () => {
    const stub = useGuardOk({
      listings: {
        select: { data: PRODUCT_ROW, error: null },
        update: { data: { id: LISTING_ID }, error: null },
      },
    });
    useAdmin();

    const result = await finalizeProduct({ listingId: LISTING_ID, photoPaths: [] });

    expect(result).toEqual({ ok: true, status: "pending_review" });
    const update = stub.calls.find((call) => call.method === "update");
    expect(update?.table).toBe("listings");
    expect(update?.args[0]).toMatchObject({ photos: [], status: "pending_review" });
    expect(stub.calls).toContainEqual({
      table: "listings",
      method: "in",
      args: ["status", ["draft", "pending_review"]],
    });
  });
});

describe("finalizeProduct — cuota propia", () => {
  it("con la cuota de finalize agotada no lee ni escribe nada", async () => {
    const stub = useGuardOk();
    useAdmin();
    mocks.limit.mockReturnValue({ ok: false, remaining: 0, retryAfterMs: 1000 });

    const result = await finalizeProduct({ listingId: LISTING_ID, photoPaths: [] });

    expect(result.ok).toBe(false);
    expect(mocks.limit).toHaveBeenCalledWith(`marketplace-finalize:${USER_ID}`, 20, 86_400_000);
    expect(stub.from).not.toHaveBeenCalled();
    expect(mocks.moderateText).not.toHaveBeenCalled();
  });
});

/**
 * `createProductDraft` — gate de identidad (spec cliente: "todos los
 * vendedores deben completar la verificación de identidad antes de
 * publicar"). Esto es la SUPERFICIE que este agente posee (actions.ts); el
 * gate reusable de la base (src/lib/verificacion/) lo escribe otro agente en
 * paralelo — acá se verifica la capa propia, en el archivo que ya es nuestro.
 */
const VALID_DRAFT_INPUT = {
  storeListingId: null,
  title: "Zapatillas deportivas talla 9",
  description: "Poco uso, sin roturas, con caja original.",
  priceAmount: 45,
  category: "ropa_accesorios",
  condition: "usado" as const,
};

describe("createProductDraft — gate de identidad", () => {
  it("sin identidad verificada, corta antes del rate limit y no llega a insertar", async () => {
    const stub = useGuardOk({
      profiles: { select: { data: { identity_verified: false }, error: null } },
    });

    const result = await createProductDraft(VALID_DRAFT_INPUT);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.needsIdentity).toBe(true);
      expect(result.error).toMatch(/identidad/i);
    }
    expect(mocks.limit).not.toHaveBeenCalled();
    expect(stub.calls.some((call) => call.method === "insert")).toBe(false);
  });

  it("si falla la lectura del perfil, trata como no verificado — nunca abre la puerta por una lectura rota", async () => {
    useGuardOk({
      profiles: { select: { data: null, error: { code: "500" } } },
    });

    const result = await createProductDraft(VALID_DRAFT_INPUT);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.needsIdentity).toBe(true);
  });

  it("con identidad verificada, pasa la puerta y publica el borrador (particular, sin tienda)", async () => {
    const stub = useGuardOk({
      profiles: { select: { data: { identity_verified: true }, error: null } },
      listings: { insert: { data: { id: LISTING_ID }, error: null } },
    });

    const result = await createProductDraft(VALID_DRAFT_INPUT);

    expect(result).toEqual({ ok: true, listingId: LISTING_ID });
    expect(mocks.limit).toHaveBeenCalledWith(`marketplace-publicar:${USER_ID}`, 10, 86_400_000);
    const insert = stub.calls.find((call) => call.method === "insert");
    expect(insert?.table).toBe("listings");
    expect(insert?.args[0]).toMatchObject({ kind: "product", status: "draft" });
  });
});
