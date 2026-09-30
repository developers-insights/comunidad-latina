import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enqueueModeration: vi.fn(),
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/moderation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/moderation")>()),
  enqueueModeration: mocks.enqueueModeration,
}));

import { decidirEncolado, encolarSiQuedaEnRevision } from "./cola";

const BASE = {
  tenantId: "11111111-1111-4111-8111-111111111111",
  listingId: "44444444-4444-4444-8444-444444444444",
  aiScore: 0,
  reasons: [] as string[],
  motivoEnRevision: "new_listing",
  origen: "test",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  mocks.createAdminClient.mockReturnValue({});
  mocks.enqueueModeration.mockResolvedValue({ ok: true, id: "q1" });
});

describe("decidirEncolado", () => {
  it("todo lo que queda en pending_review va a la cola humana, aunque el texto esté limpio", () => {
    expect(
      decidirEncolado({ status: "pending_review", exigeHumano: false, monitorear: false }),
    ).toEqual({ encolar: true, tier: 3 });
  });

  it("publicado y limpio no se encola", () => {
    expect(decidirEncolado({ status: "published", exigeHumano: false, monitorear: false })).toEqual(
      { encolar: false },
    );
  });

  it("publicado con algo para monitorear entra como tier 2", () => {
    expect(decidirEncolado({ status: "published", exigeHumano: false, monitorear: true })).toEqual({
      encolar: true,
      tier: 2,
    });
  });

  it("publicado con una foto sin revisar entra como tier 3", () => {
    expect(decidirEncolado({ status: "published", exigeHumano: true, monitorear: false })).toEqual({
      encolar: true,
      tier: 3,
    });
  });
});

describe("encolarSiQuedaEnRevision", () => {
  it("un pending_review limpio se encola con el motivo que explica por qué está en revisión", async () => {
    const resultado = await encolarSiQuedaEnRevision({
      ...BASE,
      status: "pending_review",
      exigeHumano: false,
      monitorear: false,
    });

    expect(resultado).toBe("encolado");
    expect(mocks.enqueueModeration).toHaveBeenCalledWith(
      {},
      {
        tenantId: BASE.tenantId,
        subjectKind: "listing",
        subjectId: BASE.listingId,
        aiScore: 0,
        reasons: ["new_listing"],
        tier: 3,
      },
    );
  });

  it("publicado y limpio no toca la cola", async () => {
    const resultado = await encolarSiQuedaEnRevision({
      ...BASE,
      status: "published",
      exigeHumano: false,
      monitorear: false,
    });

    expect(resultado).toBe("sin_cola");
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.enqueueModeration).not.toHaveBeenCalled();
  });

  it("publicado bajo monitoreo no suma el motivo de revisión", async () => {
    await encolarSiQuedaEnRevision({
      ...BASE,
      status: "published",
      reasons: ["moderation_skipped"],
      exigeHumano: false,
      monitorear: true,
    });

    expect(mocks.enqueueModeration.mock.calls[0][1]).toMatchObject({
      reasons: ["moderation_skipped"],
      tier: 2,
    });
  });

  it("si la cola rechaza el insert lo dice, no lo traga", async () => {
    mocks.enqueueModeration.mockResolvedValue({ ok: false, error: "boom" });

    const resultado = await encolarSiQuedaEnRevision({
      ...BASE,
      status: "pending_review",
      exigeHumano: false,
      monitorear: false,
    });

    expect(resultado).toBe("fallo");
    expect(console.warn).toHaveBeenCalled();
  });

  it("sin admin client no revienta: devuelve fallo y deja rastro", async () => {
    mocks.createAdminClient.mockImplementation(() => {
      throw new Error("SUPABASE_SERVICE_ROLE_KEY missing");
    });

    const resultado = await encolarSiQuedaEnRevision({
      ...BASE,
      status: "pending_review",
      exigeHumano: false,
      monitorear: false,
    });

    expect(resultado).toBe("fallo");
    expect(console.warn).toHaveBeenCalled();
  });
});
