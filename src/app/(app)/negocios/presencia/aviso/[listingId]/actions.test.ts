import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * =============================================================================
 * DEGRADACIÓN SIN CLAVE DE STRIPE — el camino que HOY ve todo el mundo
 * =============================================================================
 *
 * Esto NO es una rama teórica: en producción no hay ninguna variable de Stripe
 * cargada, así que `isStripeConfigured` es false para el 100% del tráfico. Todo
 * el que toque "Pasar a premium" hoy pasa por acá.
 *
 * Lo que este suite garantiza:
 *  · Nunca se llama a Stripe sin clave (llamarlo tiraría el error de dev de
 *    `getStripe()`, que es un 500 sin copy).
 *  · La respuesta es `no_configurado`, que es lo que abre <ProximamentePremium>.
 *    No un error, no un botón muerto.
 *  · El orden de los guards se respeta: sin sesión o sin ser el dueño, la
 *    respuesta es esa y NO "muy pronto" — decirle "muy pronto" a alguien que ni
 *    siquiera entró a su cuenta es mentirle sobre por qué no pudo.
 *  · Y el guard que evita el doble cobro corre ANTES de mirar si hay clave.
 */

const mocks = vi.hoisted(() => ({
  requireTenantMatch: vi.fn(),
  getStripe: vi.fn(),
  selectPremiumByListing: vi.fn(),
  limit: vi.fn(() => ({ ok: true })),
  getPrice: vi.fn(),
}));

// Sin clave: exactamente el estado de producción hoy.
vi.mock("@/lib/config/services", () => ({ isStripeConfigured: false }));
vi.mock("@/lib/tenant/guard", () => ({ requireTenantMatch: mocks.requireTenantMatch }));
vi.mock("@/lib/stripe", () => ({ getStripe: mocks.getStripe }));
vi.mock("@/lib/monetization/premium-db", () => ({
  selectPremiumByListing: mocks.selectPremiumByListing,
}));
vi.mock("@/lib/rate-limit", () => ({ limit: mocks.limit, HOUR_MS: 3_600_000 }));
// El precio ahora sale de `tenant_prices` (0072). Se mockea la lectura, no la
// tabla: lo que importa acá es que la action NO decida un monto por su cuenta.
vi.mock("@/lib/pricing/read", () => ({ getPrice: mocks.getPrice }));

import { MONETIZATION_COPY } from "@/lib/monetization";
import { abrirPortalPremiumAviso, activarPremiumAviso } from "./actions";

const LISTING = "019fa477-58e6-7ab9-ae4f-cc41716f6419";
const USER = "019fa477-58e6-7ab9-ae4f-cc41716f6420";

/** Aviso propio y publicado — el caso feliz salvo por la clave que falta. */
function guardOk(listing: Record<string, unknown> | null = {
  id: LISTING,
  title: "Panadería Doña Rosa",
  kind: "business",
  status: "published",
  created_by: USER,
}) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    maybeSingle: async () => ({ data: listing, error: null }),
  };
  mocks.requireTenantMatch.mockResolvedValue({
    ok: true,
    tenant: { id: "tenant-1", slug: "comunidadlatina" },
    user: { id: USER, email: "rosa@test.com" },
    supabase: { from: () => builder },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.limit.mockReturnValue({ ok: true });
  mocks.selectPremiumByListing.mockResolvedValue({ data: null, error: null });
  mocks.getPrice.mockResolvedValue({
    amountCents: 900,
    currency: "USD",
    source: "fallback",
  });
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("activarPremiumAviso — sin clave de Stripe", () => {
  it("devuelve `no_configurado` y NO toca Stripe", async () => {
    guardOk();

    const result = await activarPremiumAviso({ listingId: LISTING });

    expect(result).toEqual({ status: "no_configurado" });
    // Si se llamara, `getStripe()` lanzaría el error de dev: un 500 sin copy.
    expect(mocks.getStripe).not.toHaveBeenCalled();
  });

  it("registra el intento para medir demanda, y sin PII", async () => {
    guardOk();
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    await activarPremiumAviso({ listingId: LISTING });

    const logged = infoSpy.mock.calls.flat().join(" ");
    expect(logged).toContain("comunidadlatina");
    // Ni el id del aviso ni el de la persona ni su mail.
    expect(logged).not.toContain(LISTING);
    expect(logged).not.toContain(USER);
    expect(logged).not.toContain("rosa@test.com");
  });

  it("sin sesión responde `sin_sesion`, no “muy pronto”", async () => {
    mocks.requireTenantMatch.mockResolvedValue({ ok: false, reason: "unauthenticated" });

    expect(await activarPremiumAviso({ listingId: LISTING })).toEqual({ status: "sin_sesion" });
    expect(mocks.getStripe).not.toHaveBeenCalled();
  });

  it("sobre un aviso ajeno responde que no es suyo, no “muy pronto”", async () => {
    guardOk(null);

    const result = await activarPremiumAviso({ listingId: LISTING });

    expect(result).toEqual({
      status: "error",
      message: MONETIZATION_COPY.errors.notYours,
    });
  });

  it("sobre un aviso sin publicar explica que falta la aprobación", async () => {
    guardOk({ id: LISTING, title: "x", kind: "business", status: "draft", created_by: USER });

    const result = await activarPremiumAviso({ listingId: LISTING });

    expect(result).toEqual({
      status: "error",
      message: MONETIZATION_COPY.premium.errors.notPublished,
    });
  });

  it("con una suscripción VIVA no abre otro checkout — ni siquiera sin clave", async () => {
    guardOk();
    mocks.selectPremiumByListing.mockResolvedValue({
      data: { status: "active", stripe_customer_id: "cus_1" },
      error: null,
    });

    const result = await activarPremiumAviso({ listingId: LISTING });

    // El guard del doble cobro va ANTES del de la clave: si no, el día que
    // exista la clave se abriría un segundo Checkout sobre el mismo aviso.
    expect(result).toEqual({
      status: "error",
      message: MONETIZATION_COPY.premium.errors.alreadyActive,
    });
    expect(mocks.getStripe).not.toHaveBeenCalled();
  });

  it("un `past_due` tampoco permite abrir otro checkout", async () => {
    guardOk();
    mocks.selectPremiumByListing.mockResolvedValue({
      data: { status: "past_due" },
      error: null,
    });

    const result = await activarPremiumAviso({ listingId: LISTING });

    expect(result).toMatchObject({ status: "error" });
  });

  it("una suscripción TERMINADA sí deja reactivar (llega hasta el gate de la clave)", async () => {
    guardOk();
    mocks.selectPremiumByListing.mockResolvedValue({
      data: { status: "expired", stripe_customer_id: "cus_1" },
      error: null,
    });

    expect(await activarPremiumAviso({ listingId: LISTING })).toEqual({
      status: "no_configurado",
    });
  });

  it("un id que no es UUID no llega a la base ni a Stripe", async () => {
    const result = await activarPremiumAviso({ listingId: "../../admin" });

    expect(result).toMatchObject({ status: "error" });
    expect(mocks.requireTenantMatch).not.toHaveBeenCalled();
  });
});

describe("abrirPortalPremiumAviso — sin clave de Stripe", () => {
  it("devuelve `no_configurado` y NO toca Stripe", async () => {
    guardOk();
    mocks.selectPremiumByListing.mockResolvedValue({
      data: { stripe_customer_id: "cus_1" },
      error: null,
    });

    expect(await abrirPortalPremiumAviso({ listingId: LISTING })).toEqual({
      status: "no_configurado",
    });
    expect(mocks.getStripe).not.toHaveBeenCalled();
  });

  it("sin sesión responde `sin_sesion`", async () => {
    mocks.requireTenantMatch.mockResolvedValue({ ok: false, reason: "unauthenticated" });

    expect(await abrirPortalPremiumAviso({ listingId: LISTING })).toEqual({
      status: "sin_sesion",
    });
  });
});
