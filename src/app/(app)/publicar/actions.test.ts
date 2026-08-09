import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests de `finalizeListing` — el cierre de publicación de /publicar.
 *
 * Se aíslan los bordes con el patrón del repo
 * (marketplace/publicar/actions.test.ts, empleos/publicar/actions.test.ts):
 * `vi.hoisted` + `vi.mock` + stub encadenable/thenable del query builder. Nunca
 * se toca Supabase real.
 *
 * LO QUE ESTOS TESTS CUIDAN (regla de oro §7 de docs/ARQUITECTURA.md:
 * "NUNCA publicar imagen sin moderar"):
 *
 * El aviso quedaba en `pending_review` —eso siempre estuvo bien— pero NADIE lo
 * encolaba en `moderation_queue`. Y /admin/moderacion lee la COLA, no la tabla
 * `listings`: un aviso sin item de cola es un aviso que ningún moderador ve
 * nunca. O sea que la foto no se publicaba... y tampoco se moderaba: se quedaba
 * en el limbo para siempre. El flujo de productos ya lo hacía bien; este no.
 *
 * Por eso los asserts miran `enqueueModeration`, no el status: el status ya
 * estaba correcto antes del arreglo y por sí solo no prueba nada.
 */

const mocks = vi.hoisted(() => ({
  requireTenantMatch: vi.fn(),
  limit: vi.fn(),
  moderateText: vi.fn(),
  moderationTier: vi.fn(),
  enqueueModeration: vi.fn(),
  createAdminClient: vi.fn(),
  checkPhotoCount: vi.fn(),
}));

vi.mock("@/lib/tenant/guard", () => ({ requireTenantMatch: mocks.requireTenantMatch }));
vi.mock("@/lib/rate-limit", () => ({
  DAY_MS: 86_400_000,
  HOUR_MS: 3_600_000,
  limit: mocks.limit,
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/config/services", () => ({ isVisionConfigured: false }));
vi.mock("@/lib/monetization", () => ({
  MONETIZATION_COPY: { errors: { tooManyPhotos: (max: number) => `máx ${max}` } },
  checkPhotoCount: mocks.checkPhotoCount,
}));
vi.mock("@/lib/moderation", () => ({
  TIER_AUTO: 1,
  TIER_REVIEW: 2,
  TIER_HUMAN: 3,
  moderateText: mocks.moderateText,
  moderationTier: mocks.moderationTier,
  enqueueModeration: mocks.enqueueModeration,
}));

import { finalizeListing } from "./actions";

/* -------------------------------- Fixtures -------------------------------- */

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "99999999-9999-4999-8999-999999999999";
const LISTING_ID = "44444444-4444-4444-8444-444444444444";
const PHOTO = `${TENANT_ID}/${LISTING_ID}/foto-1.webp`;

type OpResult = { data?: unknown; error?: unknown };
type TableOps = Partial<Record<"select" | "update", OpResult>>;

interface RecordedCall {
  table: string;
  method: string;
  args: unknown[];
}

/** Query builder falso, encadenable y thenable (patrón del repo). */
function createSupabaseStub(config: Record<string, TableOps> = {}) {
  const calls: RecordedCall[] = [];

  const from = vi.fn((table: string) => {
    const tableConfig: TableOps = config[table] ?? {};
    let op: keyof TableOps | null = null;
    const result = () =>
      op ? (tableConfig[op] ?? { data: null, error: null }) : { data: null, error: null };

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
        op = "update";
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

const LISTING_ROW = {
  id: LISTING_ID,
  tier: "free",
  kind: "property",
  title: "Departamento de 2 ambientes en Queens",
  description: "Luminoso, cerca del subte, expensas incluidas y sin garantía propietaria.",
};

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

/** El caso normal: la fila existe y el UPDATE del dueño la mueve a pending_review. */
function useHappyPath() {
  return useGuardOk({
    listings: {
      select: { data: LISTING_ROW, error: null },
      update: { data: { id: LISTING_ID, created_by: USER_ID, kind: "property" }, error: null },
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  mocks.limit.mockReturnValue({ ok: true, remaining: 9, retryAfterMs: 0 });
  mocks.checkPhotoCount.mockReturnValue({ ok: true, max: 4 });
  mocks.moderateText.mockResolvedValue({
    flagged: false,
    score: 0,
    categories: [],
    skipped: false,
  });
  mocks.moderationTier.mockReturnValue(1);
  mocks.enqueueModeration.mockResolvedValue({ ok: true, id: "queue-1" });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

/* ---------------------------------- Tests --------------------------------- */

describe("finalizeListing — una foto sin moderar NUNCA queda huérfana", () => {
  it("sin Google Vision, un aviso CON foto entra a la cola humana", async () => {
    useHappyPath();
    useAdmin();

    const result = await finalizeListing({ listingId: LISTING_ID, photoPaths: [PHOTO] });

    expect(result).toEqual({ ok: true, status: "pending_review", kind: "property" });
    expect(mocks.enqueueModeration).toHaveBeenCalledTimes(1);

    const [, input] = mocks.enqueueModeration.mock.calls[0];
    expect(input).toMatchObject({
      tenantId: TENANT_ID,
      subjectKind: "listing",
      subjectId: LISTING_ID,
      tier: 3,
    });
    // El motivo tiene que decir POR QUÉ está en la cola: sin esto el moderador
    // ve un item sin contexto y no sabe que lo que falta es mirar la foto.
    expect(input.reasons).toContain("photo_pending_review");
  });

  it("el texto del aviso se modera de verdad (título + descripción)", async () => {
    useHappyPath();
    useAdmin();

    await finalizeListing({ listingId: LISTING_ID, photoPaths: [PHOTO] });

    expect(mocks.moderateText).toHaveBeenCalledTimes(1);
    const [text] = mocks.moderateText.mock.calls[0];
    expect(text).toContain(LISTING_ROW.title);
    expect(text).toContain(LISTING_ROW.description);
  });

  it("un texto marcado por la IA va a la cola humana aunque no haya fotos", async () => {
    useHappyPath();
    useAdmin();
    mocks.moderateText.mockResolvedValue({
      flagged: true,
      score: 92,
      categories: ["harassment"],
      skipped: false,
    });
    mocks.moderationTier.mockReturnValue(3);

    const result = await finalizeListing({ listingId: LISTING_ID, photoPaths: [] });

    expect(result).toMatchObject({ ok: true, status: "pending_review" });
    const [, input] = mocks.enqueueModeration.mock.calls[0];
    expect(input).toMatchObject({ tier: 3, aiScore: 92 });
    expect(input.reasons).toContain("harassment");
  });

  it("sin OpenAI configurado (skipped) igual se encola, con aiScore null", async () => {
    useHappyPath();
    useAdmin();
    mocks.moderateText.mockResolvedValue({
      flagged: false,
      score: 0,
      categories: [],
      skipped: true,
    });

    await finalizeListing({ listingId: LISTING_ID, photoPaths: [] });

    expect(mocks.enqueueModeration).toHaveBeenCalledTimes(1);
    const [, input] = mocks.enqueueModeration.mock.calls[0];
    expect(input.aiScore).toBeNull();
    expect(input.reasons).toContain("moderation_skipped");
  });

  it("si el UPDATE no matchea fila, no encola nada", async () => {
    useGuardOk({
      listings: {
        select: { data: LISTING_ROW, error: null },
        update: { data: null, error: null },
      },
    });
    useAdmin();

    const result = await finalizeListing({ listingId: LISTING_ID, photoPaths: [PHOTO] });

    expect(result.ok).toBe(false);
    expect(mocks.enqueueModeration).not.toHaveBeenCalled();
  });

  it("que la cola falle NO rompe la publicación (degradación elegante §7)", async () => {
    useHappyPath();
    useAdmin();
    mocks.enqueueModeration.mockRejectedValue(new Error("admin no configurado"));

    const result = await finalizeListing({ listingId: LISTING_ID, photoPaths: [PHOTO] });

    expect(result).toEqual({ ok: true, status: "pending_review", kind: "property" });
  });
});

describe("finalizeListing — auto-aprobación dev", () => {
  it("con texto limpio y sin fotos publica, y entonces no encola", async () => {
    vi.stubEnv("MODERATION_DEV_AUTO_APPROVE", "true");
    vi.stubEnv("NODE_ENV", "development");
    useHappyPath();
    useAdmin({ listings: { update: { data: null, error: null } } });

    const result = await finalizeListing({ listingId: LISTING_ID, photoPaths: [] });

    expect(result).toEqual({ ok: true, status: "published", kind: "property" });
    expect(mocks.enqueueModeration).not.toHaveBeenCalled();
  });

  it("NO publica un texto marcado por la IA, aunque la auto-aprobación esté activa", async () => {
    vi.stubEnv("MODERATION_DEV_AUTO_APPROVE", "true");
    vi.stubEnv("NODE_ENV", "development");
    useHappyPath();
    useAdmin();
    mocks.moderateText.mockResolvedValue({
      flagged: true,
      score: 88,
      categories: ["violence"],
      skipped: false,
    });
    mocks.moderationTier.mockReturnValue(3);

    const result = await finalizeListing({ listingId: LISTING_ID, photoPaths: [] });

    expect(result).toMatchObject({ ok: true, status: "pending_review" });
    expect(mocks.enqueueModeration).toHaveBeenCalledTimes(1);
  });
});
