import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests de los comentarios de AVISOS (listing_comments).
 *
 * Bordes mockeados con el patrón del repo (lib/tenant/guard.test.ts):
 * `vi.hoisted` + `vi.mock` + stub encadenable y thenable del query builder.
 * Ni OpenAI ni Supabase reales.
 *
 * El foco es el camino de MODERACIÓN espejado del feed:
 *  - flagged → el comentario NO se inserta, el intento va a la cola humana y el
 *    autor recibe `moderation` (la policy solo permite nacer 'published').
 *  - limpio → insert con autor/tenant del guard y revalidación del aviso.
 *  - score intermedio → publica igual, pero encola tier 2 (monitoreo).
 *  - body vacío → `invalid` sin tocar el guard ni la API de moderación.
 */

const mocks = vi.hoisted(() => ({
  requireTenantMatch: vi.fn(),
  revalidatePath: vi.fn(),
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
  moderateText: vi.fn(),
  enqueueModeration: vi.fn(),
}));

vi.mock("@/lib/tenant/guard", () => ({ requireTenantMatch: mocks.requireTenantMatch }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/moderation", () => ({
  TIER_AUTO: 1,
  TIER_REVIEW: 2,
  TIER_HUMAN: 3,
  moderateText: mocks.moderateText,
  moderationTier: (score: number) => (score <= 30 ? 1 : score <= 70 ? 2 : 3),
  enqueueModeration: mocks.enqueueModeration,
}));

import { createListingCommentAction } from "./comments-actions";

/* -------------------------------- Fixtures -------------------------------- */

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "99999999-9999-4999-8999-999999999999";
const LISTING_ID = "44444444-4444-4444-8444-444444444444";
const COMMENT_ID = "66666666-6666-4666-8666-666666666666";
const CREATED_AT = "2026-07-26T12:00:00.000Z";

type OpResult = { data?: unknown; error?: unknown };
type TableOps = Partial<Record<"insert" | "select", OpResult>>;

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
    const result = () => tableConfig[op ?? "select"] ?? { data: null, error: null };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = {
      insert: vi.fn((...args: unknown[]) => {
        calls.push({ table, method: "insert", args });
        op = "insert";
        return builder;
      }),
      // `.insert().select()` NO cambia la operación: sigue siendo el insert.
      select: vi.fn((...args: unknown[]) => {
        calls.push({ table, method: "select", args });
        op = op ?? "select";
        return builder;
      }),
      eq: vi.fn(() => builder),
      in: vi.fn(() => builder),
      order: vi.fn(() => builder),
      limit: vi.fn(() => builder),
      single: vi.fn(async () => result()),
      then: (resolve: (v: OpResult) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve(result()).then(resolve, reject),
    };
    return builder;
  });

  return { client: { from }, from, calls };
}

function useGuardOk(config: Record<string, TableOps> = {}) {
  const stub = createSupabaseStub({
    listing_comments: { insert: { data: { id: COMMENT_ID, created_at: CREATED_AT }, error: null } },
    profiles: {
      select: {
        data: [{ id: USER_ID, display_name: "Rosa", avatar_url: "rosa.webp" }],
        error: null,
      },
    },
    ...config,
  });
  mocks.requireTenantMatch.mockResolvedValue({
    ok: true,
    tenant: { id: TENANT_ID, slug: "dominicanos", name: "Dominicanos" },
    supabase: stub.client,
    user: { id: USER_ID },
  });
  return stub;
}

function useAdmin() {
  const calls: RecordedCall[] = [];
  const from = vi.fn((table: string) => ({
    insert: vi.fn(async (...args: unknown[]) => {
      calls.push({ table, method: "insert", args });
      return { data: null, error: null };
    }),
  }));
  mocks.createAdminClient.mockReturnValue({ from });
  return { calls, from };
}

function touched(stub: ReturnType<typeof createSupabaseStub>, table: string) {
  return stub.calls.some((call) => call.table === table);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  mocks.moderateText.mockResolvedValue({ flagged: false, categories: [], score: 0 });
  mocks.enqueueModeration.mockResolvedValue({ ok: true, id: "queue-id" });
});

/* ------------------------- createListingCommentAction ---------------------- */

describe("createListingCommentAction", () => {
  it("un comentario limpio se inserta con el autor y el tenant del guard", async () => {
    const stub = useGuardOk();
    useAdmin();

    const result = await createListingCommentAction({
      listingId: LISTING_ID,
      body: "  Me encanta este producto  ",
    });

    expect(result).toEqual({
      ok: true,
      comment: {
        id: COMMENT_ID,
        authorId: USER_ID,
        authorName: "Rosa",
        avatarUrl: "rosa.webp",
        // Sin identidad de negocio activa: el comentario es de la persona.
        entity: null,
        body: "Me encanta este producto",
        createdAt: CREATED_AT,
      },
    });
    const inserted = stub.calls.find(
      (call) => call.table === "listing_comments" && call.method === "insert",
    );
    expect(inserted?.args[0]).toEqual({
      tenant_id: TENANT_ID,
      listing_id: LISTING_ID,
      author_id: USER_ID,
      body: "Me encanta este producto",
      status: "published",
      entity_listing_id: null,
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/marketplace/${LISTING_ID}`);
    // Score 0 y sin skip: nada que encolar.
    expect(mocks.enqueueModeration).not.toHaveBeenCalled();
  });

  it("flagged: NO inserta, encola el intento y devuelve 'moderation'", async () => {
    mocks.moderateText.mockResolvedValue({
      flagged: true,
      categories: ["harassment"],
      score: 92,
    });
    const stub = useGuardOk();
    const admin = useAdmin();

    const result = await createListingCommentAction({
      listingId: LISTING_ID,
      body: "texto violento",
    });

    expect(result).toEqual({ ok: false, code: "moderation" });
    expect(touched(stub, "listing_comments")).toBe(false);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();

    const queued = admin.calls.find((call) => call.table === "moderation_queue");
    expect(queued).toBeTruthy();
    const row = queued?.args[0] as Record<string, unknown>;
    expect(row.tenant_id).toBe(TENANT_ID);
    expect(row.subject_kind).toBe("comment");
    expect(row.tier).toBe(3);
    // El texto del intento viaja en reasons: es lo único que verá el equipo.
    expect(row.reasons).toMatchObject({
      body: "texto violento",
      listing_id: LISTING_ID,
      author_id: USER_ID,
    });
  });

  it("score intermedio publica igual pero entra a monitoreo (tier 2)", async () => {
    mocks.moderateText.mockResolvedValue({ flagged: false, categories: ["hate"], score: 55 });
    useGuardOk();
    useAdmin();

    const result = await createListingCommentAction({
      listingId: LISTING_ID,
      body: "algo dudoso",
    });

    expect(result.ok).toBe(true);
    expect(mocks.enqueueModeration).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ subjectId: COMMENT_ID, tier: 2 }),
    );
  });

  it("body vacío corta antes del guard y de la moderación", async () => {
    const result = await createListingCommentAction({ listingId: LISTING_ID, body: "   " });

    expect(result).toEqual({ ok: false, code: "invalid" });
    expect(mocks.requireTenantMatch).not.toHaveBeenCalled();
    expect(mocks.moderateText).not.toHaveBeenCalled();
  });

  it("sin sesión no llama a la API de moderación", async () => {
    const stub = createSupabaseStub();
    mocks.requireTenantMatch.mockResolvedValue({
      ok: false,
      reason: "unauthenticated",
      message: "copy del guard",
      tenant: { id: TENANT_ID, slug: "dominicanos", name: "Dominicanos" },
      supabase: stub.client,
      user: null,
    });

    const result = await createListingCommentAction({
      listingId: LISTING_ID,
      body: "Hola",
    });

    expect(result).toEqual({ ok: false, code: "unauthenticated" });
    expect(mocks.moderateText).not.toHaveBeenCalled();
  });
});
