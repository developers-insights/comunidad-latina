import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * =============================================================================
 * CONTENT INTEGRITY EN EL CIERRE DE PUBLICACIÓN — la regla de oro
 * =============================================================================
 *
 * "Si el pipeline falla, el contenido NO se publica sin control: va a revisión."
 * (ARQUITECTURA §7). El escenario que lo prueba es el ADVERSO a propósito:
 * auto-aprobación de dev encendida, moderación de texto limpia, sin Vision. En
 * esas condiciones el producto SE PUBLICARÍA solo — y no tiene que hacerlo, si
 * el análisis de integridad no pudo correr o encontró algo.
 *
 * Se prueba en `finalizeProduct` y no en el helper porque la decisión de
 * publicar vive acá: el helper informa, la action decide.
 */

const mocks = vi.hoisted(() => ({
  requireTenantMatch: vi.fn(),
  limit: vi.fn(),
  moderateText: vi.fn(),
  moderationTier: vi.fn(),
  enqueueModeration: vi.fn(),
  createAdminClient: vi.fn(),
  registerUploadedMedia: vi.fn(),
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
vi.mock("@/lib/integrity", async () => {
  const declarations = await import("@/lib/integrity/declarations");
  return {
    ...declarations,
    registerUploadedMedia: mocks.registerUploadedMedia,
  };
});
vi.mock("@/lib/integrity/source-host", () => ({
  currentSourceHost: async (fallback: string) => fallback,
}));

import { finalizeProduct } from "./actions";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "99999999-9999-4999-8999-999999999999";
const LISTING_ID = "44444444-4444-4444-8444-444444444444";
const PHOTO = `${TENANT_ID}/${LISTING_ID}/foto.webp`;

type OpResult = { data?: unknown; error?: unknown };

function createSupabaseStub(config: Record<string, OpResult> = {}) {
  const from = vi.fn((table: string) => {
    let op = "select";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = {
      maybeSingle: async () => config[`${table}.${op}`] ?? { data: null, error: null },
      single: async () => config[`${table}.${op}`] ?? { data: null, error: null },
      then: (resolve: (value: OpResult) => unknown) =>
        Promise.resolve(config[`${table}.${op}`] ?? { data: null, error: null }).then(resolve),
    };
    for (const method of ["select", "eq", "in", "limit", "order"]) {
      builder[method] = vi.fn(() => builder);
    }
    for (const method of ["insert", "update", "upsert"]) {
      builder[method] = vi.fn(() => {
        op = method;
        return builder;
      });
    }
    return builder;
  });
  return { client: { from }, from };
}

const PRODUCT_ROW = {
  id: LISTING_ID,
  title: "Bicicleta rodado 29 casi nueva",
  description: "Usada tres meses, tiene luces y candado incluidos.",
};

function useGuardOk() {
  const stub = createSupabaseStub({
    "listings.select": { data: PRODUCT_ROW, error: null },
    "listings.update": { data: { id: LISTING_ID }, error: null },
  });
  mocks.requireTenantMatch.mockResolvedValue({
    ok: true,
    tenant: { id: TENANT_ID, slug: "dominicanos", name: "Dominicanos", currency: "USD" },
    supabase: stub.client,
    user: { id: USER_ID },
  });
  return stub;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  mocks.limit.mockReturnValue({ ok: true, remaining: 19, retryAfterMs: 0 });
  mocks.moderateText.mockResolvedValue({
    flagged: false,
    score: 0,
    categories: [],
    skipped: false,
  });
  mocks.moderationTier.mockReturnValue(1);
  mocks.enqueueModeration.mockResolvedValue({ ok: true });
  mocks.registerUploadedMedia.mockResolvedValue({
    needsHumanReview: false,
    reasons: [],
    assetIds: [],
  });
  // Escenario adverso: en dev, con todo lo demás en verde, esto publicaría.
  vi.stubEnv("MODERATION_DEV_AUTO_APPROVE", "true");
  vi.stubEnv("NODE_ENV", "test");
});

describe("PIPELINE CAÍDO → el producto va a revisión, NO se publica", () => {
  it("con auto-aprobación de dev encendida, la integridad rota lo frena igual", async () => {
    const stub = useGuardOk();
    const adminStub = createSupabaseStub();
    mocks.createAdminClient.mockReturnValue(adminStub.client);
    mocks.registerUploadedMedia.mockResolvedValue({
      needsHumanReview: true,
      reasons: ["integrity_pipeline_failed"],
      assetIds: [],
    });

    const result = await finalizeProduct({ listingId: LISTING_ID, photoPaths: [PHOTO] });

    expect(result).toEqual({ ok: true, status: "pending_review" });

    // El UPDATE que hace el cliente del usuario NUNCA escribe 'published'…
    const update = stub.from.mock.results
      .map((entry) => entry.value)
      .find((builder) => builder.update.mock.calls.length > 0);
    expect(update?.update.mock.calls[0][0]).toMatchObject({ status: "pending_review" });

    // …y el motivo llega a la cola, con nivel humano: un archivo sin analizar
    // no lo resuelve un score de IA.
    expect(mocks.enqueueModeration).toHaveBeenCalledWith(
      adminStub.client,
      expect.objectContaining({
        subjectKind: "listing",
        subjectId: LISTING_ID,
        tier: 3,
        reasons: expect.arrayContaining(["integrity_pipeline_failed"]),
      }),
    );
  });

  it("un duplicado exacto también frena la publicación automática", async () => {
    useGuardOk();
    const adminStub = createSupabaseStub();
    mocks.createAdminClient.mockReturnValue(adminStub.client);
    mocks.registerUploadedMedia.mockResolvedValue({
      needsHumanReview: true,
      reasons: ["integrity_duplicado_exacto"],
      assetIds: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
    });

    const result = await finalizeProduct({ listingId: LISTING_ID, photoPaths: [PHOTO] });

    expect(result).toEqual({ ok: true, status: "pending_review" });
    expect(mocks.enqueueModeration).toHaveBeenCalledWith(
      adminStub.client,
      expect.objectContaining({
        tier: 3,
        reasons: expect.arrayContaining(["integrity_duplicado_exacto"]),
      }),
    );
  });
});

describe("el pipeline recibe lo que necesita", () => {
  it("cada foto viaja con su bucket y su path, y la declaración del formulario", async () => {
    useGuardOk();
    mocks.createAdminClient.mockReturnValue(createSupabaseStub().client);

    await finalizeProduct({
      listingId: LISTING_ID,
      photoPaths: [PHOTO],
      declaration: { originalityDeclared: true, licenseKind: "propio" },
    });

    expect(mocks.registerUploadedMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        uploaderId: USER_ID,
        subjectKind: "listing",
        subjectId: LISTING_ID,
        declaration: expect.objectContaining({
          originalityDeclared: true,
          licenseKind: "propio",
        }),
        items: [
          {
            mediaKind: "imagen",
            storageBucket: "listing-photos",
            storagePath: PHOTO,
          },
        ],
      }),
    );
  });
});
