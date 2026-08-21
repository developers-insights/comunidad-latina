import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests de `finalizeGig` — el cierre de publicación de un aviso de Creadores.
 *
 * Se aíslan los bordes con el patrón del repo (empleos/publicar/actions.test.ts):
 * `vi.hoisted` + `vi.mock` + stub encadenable/thenable del query builder. Nunca
 * se toca Supabase real.
 *
 * Garantías cubiertas (auditoría de seguridad 2026-07-27 — espejo del fix ya
 * aplicado en empleos/publicar/actions.ts):
 *  - el UPDATE del dueño viaja con el candado `.in(status, draft|pending_review)`.
 *    La policy listings_update (0004) SÍ deja al dueño escribir pending_review
 *    desde 'removed', así que el filtro tiene que ir en la query: un aviso dado
 *    de baja por moderación NO se re-publica re-llamando finalize. Acá el
 *    agujero era DIRECTO en producción: con texto limpio, finalize publica vía
 *    admin client en el mismo request.
 *  - si el candado no matchea fila, la action corta: ni publish vía admin ni
 *    re-encolado de moderación.
 *  - finalize tiene cuota PROPIA (`gig-finalize`, 20/día): agotada, cero
 *    lecturas y cero escrituras.
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

import { applyToGig, finalizeGig } from "./actions";

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

const GIG_ROW = {
  id: LISTING_ID,
  title: "Video para lanzamiento de producto",
  description: "Necesito un reel de 30 segundos con tomas del local y edición.",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  mocks.limit.mockReturnValue({ ok: true, remaining: 19, retryAfterMs: 0 });
  mocks.moderateText.mockResolvedValue({ flagged: false, score: 0, categories: [], skipped: false });
  mocks.moderationTier.mockReturnValue(1);
  mocks.enqueueModeration.mockResolvedValue({ ok: true });
});

/* ---------------------------------- Tests --------------------------------- */

describe("finalizeGig — un aviso dado de baja NO se re-publica", () => {
  it("con status='removed' el UPDATE no matchea y corta sin publicar ni re-encolar", async () => {
    const stub = useGuardOk({
      listings: {
        // La DB filtró la fila por el `.in(status, ...)`: cero filas afectadas.
        // Sin el candado, este texto limpio habría salido published vía admin.
        update: { data: null, error: null },
      },
    });
    useAdmin();

    const result = await finalizeGig({ listingId: LISTING_ID, photoPaths: [] });

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

  it("camino feliz: un draft con texto limpio publica vía admin, con el candado en el UPDATE", async () => {
    const stub = useGuardOk({
      listings: { update: { data: GIG_ROW, error: null } },
    });
    const admin = useAdmin();

    const result = await finalizeGig({ listingId: LISTING_ID, photoPaths: [] });

    expect(result).toEqual({ ok: true, status: "published" });
    expect(stub.calls).toContainEqual({
      table: "listings",
      method: "in",
      args: ["status", ["draft", "pending_review"]],
    });
    const publish = admin.calls.find((call) => call.method === "update");
    expect(publish?.table).toBe("listings");
    expect(publish?.args[0]).toMatchObject({ status: "published" });
  });
});

describe("finalizeGig — cuota propia", () => {
  it("con la cuota de finalize agotada no lee ni escribe nada", async () => {
    const stub = useGuardOk();
    useAdmin();
    mocks.limit.mockReturnValue({ ok: false, remaining: 0, retryAfterMs: 1000 });

    const result = await finalizeGig({ listingId: LISTING_ID, photoPaths: [] });

    expect(result.ok).toBe(false);
    expect(mocks.limit).toHaveBeenCalledWith(`gig-finalize:${USER_ID}`, 20, 86_400_000);
    expect(stub.from).not.toHaveBeenCalled();
    expect(mocks.moderateText).not.toHaveBeenCalled();
  });
});

/**
 * `applyToGig` — postularse a una colaboración (revisión 2026-08-20).
 *
 * Dos hallazgos de correctitud viven acá, y los dos son del SERVIDOR porque es
 * el único lugar que no se puede saltear: la action es una URL pública y la
 * pantalla que esconde un botón no autoriza nada.
 *
 *  1. El DUEÑO no puede postularse a su propio aviso. Antes la única barrera era
 *     que `GigCard` escondía el botón cuando no le pasaban `applicationsCount`
 *     — una inferencia sobre un campo de presentación que en el listado no
 *     viaja para nadie, así que ni siquiera funcionaba.
 *  2. Un "ya te habías postulado" viaja marcado (`alreadyApplied`), y NO es un
 *     alta: no se guardó nada de lo que se escribió. Que la hoja lo cuente
 *     distinto se prueba en `components/creators/gig-card.test.tsx`.
 *
 * La identidad sale SIEMPRE del guard de sesión (`user.id`), nunca del input.
 */
describe("applyToGig — el dueño no se postula a lo suyo", () => {
  const OTHER_USER = "88888888-8888-4888-8888-888888888888";
  const PROPOSAL = "Hago reels para gastronomía y te puedo entregar tres videos verticales.";

  function applyInput() {
    return { gigId: LISTING_ID, message: PROPOSAL, proposedAmount: null };
  }

  it("rechaza al dueño comparando created_by contra la SESIÓN, sin escribir nada", async () => {
    const stub = useGuardOk({
      // `created_by` es el mismo usuario que devuelve el guard.
      listings: { select: { data: { id: LISTING_ID, created_by: USER_ID }, error: null } },
    });

    const result = await applyToGig(applyInput());

    expect(result.ok).toBe(false);
    // Cero escrituras: el rechazo pasa ANTES del insert.
    expect(stub.calls.some((call) => call.method === "insert")).toBe(false);
  });

  it("el aviso se lee filtrado por tenant, kind y estado publicado", async () => {
    const stub = useGuardOk({
      listings: { select: { data: { id: LISTING_ID, created_by: OTHER_USER }, error: null } },
      gig_applications: { insert: { error: null } },
    });

    await applyToGig(applyInput());

    expect(stub.calls).toContainEqual({ table: "listings", method: "eq", args: ["tenant_id", TENANT_ID] });
    expect(stub.calls).toContainEqual({ table: "listings", method: "eq", args: ["kind", "creator_gig"] });
    expect(stub.calls).toContainEqual({ table: "listings", method: "eq", args: ["status", "published"] });
  });

  it("un aviso que ya no existe (o no es de este tenant) no llega al insert", async () => {
    const stub = useGuardOk({
      listings: { select: { data: null, error: null } },
    });

    const result = await applyToGig(applyInput());

    expect(result.ok).toBe(false);
    expect(stub.calls.some((call) => call.method === "insert")).toBe(false);
  });

  it("quien no publicó el aviso SÍ se postula, y el creator_id sale de la sesión", async () => {
    const stub = useGuardOk({
      listings: { select: { data: { id: LISTING_ID, created_by: OTHER_USER }, error: null } },
      gig_applications: { insert: { error: null } },
    });

    const result = await applyToGig(applyInput());

    expect(result).toEqual({ ok: true });
    const insert = stub.calls.find((call) => call.method === "insert");
    expect(insert?.table).toBe("gig_applications");
    expect(insert?.args[0]).toMatchObject({
      gig_id: LISTING_ID,
      creator_id: USER_ID,
      tenant_id: TENANT_ID,
    });
  });
});

describe("applyToGig — 'ya estaba' se devuelve MARCADO, no como alta", () => {
  const OTHER_USER = "88888888-8888-4888-8888-888888888888";
  const PROPOSAL = "Hago reels para gastronomía y te puedo entregar tres videos verticales.";

  it("la unique (23505) devuelve alreadyApplied: quien llama tiene que contarlo distinto", async () => {
    useGuardOk({
      listings: { select: { data: { id: LISTING_ID, created_by: OTHER_USER }, error: null } },
      gig_applications: { insert: { error: { code: "23505" } } },
    });

    const result = await applyToGig({ gigId: LISTING_ID, message: PROPOSAL, proposedAmount: null });

    expect(result).toEqual({ ok: true, alreadyApplied: true });
  });

  it("un alta de verdad NO trae la marca — es lo que las distingue en la pantalla", async () => {
    useGuardOk({
      listings: { select: { data: { id: LISTING_ID, created_by: OTHER_USER }, error: null } },
      gig_applications: { insert: { error: null } },
    });

    const result = await applyToGig({ gigId: LISTING_ID, message: PROPOSAL, proposedAmount: null });

    expect(result).toEqual({ ok: true });
    expect("alreadyApplied" in result).toBe(false);
  });
});
