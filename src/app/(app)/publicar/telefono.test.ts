import { beforeEach, describe, expect, it, vi } from "vitest";
import { PHONE_REQUIRED_COPY } from "@/lib/phone/error";

/**
 * Publicar sin teléfono verificado (0181).
 *
 * El trigger `app.enforce_phone_verified()` rechaza el INSERT del aviso con
 * `PHONE_VERIFICATION_REQUIRED`. La persona tiene que leer qué hacer, no el
 * "algo salió mal" genérico.
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

import { createListingDraft, type DraftInput } from "./actions";

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

function stubConInsertQueFalla(error: { message: string; code?: string }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {
    insert: vi.fn(() => builder),
    select: vi.fn(() => builder),
    single: vi.fn(async () => ({ data: null, error })),
  };
  mocks.requireTenantMatch.mockResolvedValue({
    ok: true,
    tenant: { id: "t1", slug: "dominicanos", name: "Dominicanos", currency: "USD" },
    supabase: { from: vi.fn(() => builder) },
    user: { id: "u1" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  mocks.limit.mockReturnValue({ ok: true, remaining: 9, retryAfterMs: 0 });
  mocks.requireIdentidadVerificada.mockResolvedValue({ permitido: true });
});

describe("createListingDraft — teléfono sin verificar", () => {
  it("devuelve el copy del teléfono, no el error genérico", async () => {
    stubConInsertQueFalla({
      message: "PHONE_VERIFICATION_REQUIRED: para publicar y escribir, primero confirmá tu teléfono.",
      code: "P0001",
    });

    const result = await createListingDraft(RENTAL);

    expect(result).toEqual({ ok: false, error: PHONE_REQUIRED_COPY });
  });

  it("cualquier otro error de la base sigue siendo el genérico", async () => {
    stubConInsertQueFalla({ message: "connection reset", code: "08006" });

    const result = await createListingDraft(RENTAL);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).not.toBe(PHONE_REQUIRED_COPY);
  });
});
