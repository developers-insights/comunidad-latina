import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * =============================================================================
 * CAMPAÑA DE UNA PUBLICACIÓN — el precio de la comunidad, en los DOS caminos
 * =============================================================================
 *
 * Esta action es la única de las cinco que tiene modo demostración: sin clave de
 * Stripe activa la campaña sin cobrar. Ese camino igual escribe
 * `post_promotions.amount_cents`, y ese número tiene que ser el precio vigente
 * de la comunidad — es lo que después leen las métricas de ingresos. Una demo
 * que asiente el precio equivocado ensucia el reporte sin que nadie lo note.
 *
 * `isStripeConfigured` se lee a través de un getter para poder recorrer las dos
 * ramas en el mismo archivo: es un `const` del módulo real, así que la única
 * forma de moverlo entre tests es que el mock lo exponga como propiedad viva.
 */

const state = vi.hoisted(() => ({ stripeConfigured: true, demoPermitido: false }));
const mocks = vi.hoisted(() => ({
  requireTenantMatch: vi.fn(),
  getTenant: vi.fn(),
  createAdminClient: vi.fn(),
  sessionsCreate: vi.fn(),
  sessionsExpire: vi.fn(),
  limit: vi.fn(() => ({ ok: true })),
  createNotification: vi.fn(),
  getViewerFormatDate: vi.fn(),
}));

vi.mock("@/lib/config/services", () => ({
  get isStripeConfigured() {
    return state.stripeConfigured;
  },
  /**
   * El modo demo pide DOS cosas: que no haya Stripe Y que no estemos publicados.
   * Se expone aparte para poder probar el tercer estado —sin Stripe pero en
   * producción— que antes no existía y regalaba la campaña. Ver
   * `isPagosDemoPermitido` en el módulo real.
   */
  get isPagosDemoPermitido() {
    return !state.stripeConfigured && state.demoPermitido;
  },
}));
vi.mock("@/lib/tenant/guard", () => ({ requireTenantMatch: mocks.requireTenantMatch }));
vi.mock("@/lib/tenant/resolve", () => ({ getTenant: mocks.getTenant }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/rate-limit", () => ({ limit: mocks.limit, HOUR_MS: 3_600_000 }));
vi.mock("@/lib/notifications/notify", () => ({ createNotification: mocks.createNotification }));
vi.mock("@/lib/time/viewer-zone", () => ({ getViewerFormatDate: mocks.getViewerFormatDate }));
vi.mock("@/lib/stripe", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/stripe")>()),
  getStripe: () => ({
    checkout: { sessions: { create: mocks.sessionsCreate, expire: mocks.sessionsExpire } },
  }),
}));

import { findPrice } from "@/lib/pricing";
import { getTenantPrices } from "@/lib/pricing/read";
import { POST_PROMO_PACKAGES, postPromoMontoCentavos } from "@/lib/stripe";
import { crearCampanaPost } from "./actions";

const POST = "019fa477-58e6-7ab9-ae4f-cc41716f6419";
const USER = "019fa477-58e6-7ab9-ae4f-cc41716f6420";

interface PriceRow {
  id: string;
  product: string;
  variant: string;
  billing_interval: string;
  amount_cents: number;
  currency: string;
  active: boolean;
  updated_at: string | null;
}

function priceRow(variant: string, amountCents: number, currency = "USD"): PriceRow {
  return {
    id: `post-promo-${variant}`,
    product: "post_promo",
    variant,
    billing_interval: "unico",
    amount_cents: amountCents,
    currency,
    active: true,
    updated_at: null,
  };
}

function userSupabase(rows: PriceRow[] | null, tenantId: string) {
  return {
    // `getTenantPrices` reintenta por la RPC `tenant_public_prices` (0078)
    // cuando la lectura directa vuelve vacia: vacio aca deja regir las constantes.
    rpc: async () => ({ data: [], error: null }),
    from(table: string) {
      if (table === "tenant_prices") {
        const builder = {
          select: () => builder,
          eq: async () => ({ data: rows, error: null }),
        };
        return builder;
      }
      if (table === "post_promotions") {
        // Sin campaña activa vigente.
        const promo = {
          select: () => promo,
          eq: () => promo,
          gt: () => promo,
          limit: () => promo,
          maybeSingle: async () => ({ data: null, error: null }),
        };
        return promo;
      }
      const post = {
        select: () => post,
        eq: () => post,
        maybeSingle: async () => ({
          data: { id: POST, tenant_id: tenantId, author_id: USER, status: "published" },
          error: null,
        }),
      };
      return post;
    },
  };
}

/**
 * Admin client que sólo recuerda el insert de `post_promotions`. El `audit_log`
 * de la demo también pasa por acá y, si no se filtrara por tabla, pisaría la
 * fila de la campaña justo antes de que el test la mire.
 */
function adminSpy(captured: { insert: Record<string, unknown> | null }) {
  return {
    // `getTenantPrices` reintenta por la RPC `tenant_public_prices` (0078)
    // cuando la lectura directa vuelve vacia: vacio aca deja regir las constantes.
    rpc: async () => ({ data: [], error: null }),
    from(table: string) {
      return {
        insert(values: Record<string, unknown>) {
          if (table === "post_promotions") captured.insert = values;
          return {
            select: () => ({ single: async () => ({ data: { id: "promo-1" }, error: null }) }),
            then: (resolve: (value: { error: null }) => unknown) => resolve({ error: null }),
          };
        },
        update: () => ({ eq: async () => ({ error: null }) }),
      };
    },
  };
}

async function lanzar(options: {
  rows: PriceRow[] | null;
  paquete?: "7d" | "14d" | "30d";
  tenantId?: string;
}) {
  const tenantId = options.tenantId ?? "tenant-1";
  const supabase = userSupabase(options.rows, tenantId);
  const captured: { insert: Record<string, unknown> | null } = { insert: null };

  mocks.getTenant.mockResolvedValue({ id: tenantId, slug: "comunidadlatina" });
  mocks.requireTenantMatch.mockResolvedValue({
    ok: true,
    tenant: { id: tenantId, slug: "comunidadlatina" },
    user: { id: USER, email: "rosa@test.com" },
    supabase,
  });
  mocks.createAdminClient.mockReturnValue(adminSpy(captured));
  mocks.sessionsCreate.mockResolvedValue({ id: "cs_1", url: "https://stripe.test/cs_1" });
  mocks.getViewerFormatDate.mockResolvedValue(() => "el 5 de marzo");

  const result = await crearCampanaPost({
    postId: POST,
    paquete: options.paquete ?? "14d",
    audience: { scope: "all" },
    ctaWhatsapp: null,
  });

  const calls = mocks.sessionsCreate.mock.calls;
  const lineItem = calls[calls.length - 1]?.[0]?.line_items?.[0];
  return {
    result,
    supabase,
    tenantId,
    fila: captured.insert,
    stripe: lineItem?.price_data as { currency: string; unit_amount: number } | undefined,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.stripeConfigured = true;
  state.demoPermitido = false;
  mocks.limit.mockReturnValue({ ok: true });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("crearCampanaPost — con Stripe configurado", () => {
  it("con fila en tenant_prices cobra ESE monto y lo guarda en la campaña", async () => {
    const { result, fila, stripe } = await lanzar({ rows: [priceRow("14d", 3_300)] });

    expect(result).toMatchObject({ status: "redirect" });
    expect(stripe?.unit_amount).toBe(3_300);
    expect(fila?.amount_cents).toBe(3_300);
    expect(postPromoMontoCentavos(POST_PROMO_PACKAGES["14d"])).toBe(2_500);
  });

  it("SIN fila cobra exactamente la constante de siempre", async () => {
    const { fila, stripe } = await lanzar({ rows: [] });

    expect(stripe?.unit_amount).toBe(postPromoMontoCentavos(POST_PROMO_PACKAGES["14d"]));
    expect(fila?.amount_cents).toBe(postPromoMontoCentavos(POST_PROMO_PACKAGES["14d"]));
    expect(fila?.currency).toBe("usd");
  });

  it("dos comunidades con precios distintos cobran distinto", async () => {
    const miami = await lanzar({ tenantId: "tenant-miami", rows: [priceRow("7d", 1_500)], paquete: "7d" });
    const houston = await lanzar({ tenantId: "tenant-houston", rows: [priceRow("7d", 600)], paquete: "7d" });

    expect(miami.stripe?.unit_amount).toBe(1_500);
    expect(houston.stripe?.unit_amount).toBe(600);
  });

  it("el monto que la pantalla muestra es el que se le manda a Stripe", async () => {
    const cobro = await lanzar({ rows: [priceRow("30d", 4_950)], paquete: "30d" });
    const prices = await getTenantPrices(cobro.supabase as never, cobro.tenantId);
    const enPantalla = findPrice(prices, "post_promo", "30d", "unico");

    expect(enPantalla?.amountCents).toBe(cobro.stripe?.unit_amount);
    expect(enPantalla?.currency.toLowerCase()).toBe(cobro.stripe?.currency);
  });

  it("la moneda viaja explícita desde la fila, en minúsculas", async () => {
    const { fila, stripe } = await lanzar({ rows: [priceRow("14d", 2_000, "EUR")] });

    expect(stripe?.currency).toBe("eur");
    expect(fila?.currency).toBe("eur");
  });
});

describe("crearCampanaPost — modo demostración (sin clave de Stripe, en local)", () => {
  beforeEach(() => {
    state.stripeConfigured = false;
    // En local no hay deploy de por medio, así que el demo corre.
    state.demoPermitido = true;
  });

  it("sigue activando al instante y sin cobrar — la degradación no se rompió", async () => {
    const { result } = await lanzar({ rows: [priceRow("14d", 3_300)] });

    expect(result).toMatchObject({ status: "demo_activada" });
    expect(mocks.sessionsCreate).not.toHaveBeenCalled();
  });

  it("asienta el precio VIGENTE de la comunidad, no la constante", async () => {
    const { fila } = await lanzar({ rows: [priceRow("14d", 3_300)] });

    expect(fila?.status).toBe("active");
    expect(fila?.amount_cents).toBe(3_300);
  });

  it("sin fila asienta la constante de siempre", async () => {
    const { fila } = await lanzar({ rows: [] });

    expect(fila?.amount_cents).toBe(postPromoMontoCentavos(POST_PROMO_PACKAGES["14d"]));
  });
});

/**
 * EL TERCER ESTADO, QUE ANTES NO EXISTÍA.
 *
 * La única condición del modo demo era `!isStripeConfigured`. O sea que el día
 * que producción se quedara sin `STRIPE_SECRET_KEY` —una variable borrada, un
 * env mal armado, una rotación a medias— la app no decía "muy pronto" como los
 * otros seis productos: le REGALABA la campaña a todo el mundo, con notificación
 * de éxito y fila de auditoría, sin un solo error en los logs. Es la versión
 * local del clásico "las tarjetas de prueba se aceptan en el sitio en vivo".
 */
describe("crearCampanaPost — sin clave de Stripe pero PUBLICADO", () => {
  beforeEach(() => {
    state.stripeConfigured = false;
    state.demoPermitido = false;
  });

  it("NO regala la campaña: degrada como los otros productos", async () => {
    const { result, fila } = await lanzar({ rows: [priceRow("14d", 3_300)] });

    expect(result).toEqual({ status: "no_configurado" });
    // Nada escrito, nada cobrado, nada prometido.
    expect(fila ?? null).toBeNull();
    expect(mocks.sessionsCreate).not.toHaveBeenCalled();
    expect(mocks.createNotification).not.toHaveBeenCalled();
  });

  it("deja el rastro para el que tenga que arreglar el env", async () => {
    const errorSpy = vi.spyOn(console, "error");

    await lanzar({ rows: [priceRow("14d", 3_300)] });

    // Que la persona vea "muy pronto" es lo correcto; que nadie se entere de que
    // falta la clave, no.
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("STRIPE_SECRET_KEY"));
  });
});
