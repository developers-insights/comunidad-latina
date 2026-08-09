import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * =============================================================================
 * PUBLICACIÓN PREMIUM — el Checkout cobra el precio de la comunidad
 * =============================================================================
 *
 * Archivo aparte de `actions.test.ts` porque ese suite existe para el estado de
 * producción de HOY (sin clave de Stripe) y no puede cambiar de rama a mitad.
 * Acá la clave se mockea presente para poder mirar el `unit_amount` que sale.
 */

const mocks = vi.hoisted(() => ({
  requireTenantMatch: vi.fn(),
  selectPremiumByListing: vi.fn(),
  sessionsCreate: vi.fn(),
  limit: vi.fn(() => ({ ok: true })),
}));

vi.mock("@/lib/config/services", () => ({ isStripeConfigured: true }));
vi.mock("@/lib/tenant/guard", () => ({ requireTenantMatch: mocks.requireTenantMatch }));
vi.mock("@/lib/rate-limit", () => ({ limit: mocks.limit, HOUR_MS: 3_600_000 }));
vi.mock("@/lib/monetization/premium-db", () => ({
  selectPremiumByListing: mocks.selectPremiumByListing,
}));
vi.mock("@/lib/stripe", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/stripe")>()),
  getStripe: () => ({ checkout: { sessions: { create: mocks.sessionsCreate } } }),
}));

import { PREMIUM_LISTING_PRICE_CENTS } from "@/lib/monetization/premium";
import { findPrice } from "@/lib/pricing";
import { getTenantPrices } from "@/lib/pricing/read";
import { activarPremiumAviso } from "./actions";

const LISTING = "019fa477-58e6-7ab9-ae4f-cc41716f6419";
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

function priceRow(amountCents: number, currency = "USD"): PriceRow {
  return {
    id: "listing-premium",
    product: "listing_premium",
    variant: "estandar",
    billing_interval: "mensual",
    amount_cents: amountCents,
    currency,
    active: true,
    updated_at: null,
  };
}

function userSupabase(rows: PriceRow[] | null) {
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
      const listing = {
        select: () => listing,
        eq: () => listing,
        maybeSingle: async () => ({
          data: {
            id: LISTING,
            title: "Panadería Doña Rosa",
            kind: "business",
            status: "published",
            created_by: USER,
          },
          error: null,
        }),
      };
      return listing;
    },
  };
}

async function cobrar(options: { rows: PriceRow[] | null; tenantId?: string }) {
  const tenantId = options.tenantId ?? "tenant-1";
  const supabase = userSupabase(options.rows);

  mocks.requireTenantMatch.mockResolvedValue({
    ok: true,
    tenant: { id: tenantId, slug: "comunidadlatina" },
    user: { id: USER, email: "rosa@test.com" },
    supabase,
  });
  mocks.sessionsCreate.mockResolvedValue({ id: "cs_1", url: "https://stripe.test/cs_1" });

  const result = await activarPremiumAviso({ listingId: LISTING });
  const calls = mocks.sessionsCreate.mock.calls;
  const payload = calls[calls.length - 1]?.[0];
  return {
    result,
    supabase,
    tenantId,
    stripe: payload?.line_items?.[0]?.price_data as
      | { currency: string; unit_amount: number }
      | undefined,
    metadata: payload?.metadata as Record<string, string> | undefined,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.limit.mockReturnValue({ ok: true });
  mocks.selectPremiumByListing.mockResolvedValue({ data: null, error: null });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("activarPremiumAviso — de dónde sale el monto", () => {
  it("con fila en tenant_prices cobra ESE monto", async () => {
    const { result, stripe } = await cobrar({ rows: [priceRow(1_500)] });

    expect(result).toMatchObject({ status: "redirect" });
    expect(stripe?.unit_amount).toBe(1_500);
    expect(PREMIUM_LISTING_PRICE_CENTS).toBe(900);
  });

  it("SIN fila cobra exactamente la constante de siempre", async () => {
    const { stripe } = await cobrar({ rows: [] });

    expect(stripe?.unit_amount).toBe(PREMIUM_LISTING_PRICE_CENTS);
    expect(stripe?.currency).toBe("usd");
  });

  it("dos comunidades con precios distintos cobran distinto", async () => {
    const miami = await cobrar({ tenantId: "tenant-miami", rows: [priceRow(1_500)] });
    const houston = await cobrar({ tenantId: "tenant-houston", rows: [priceRow(500)] });

    expect(miami.stripe?.unit_amount).toBe(1_500);
    expect(houston.stripe?.unit_amount).toBe(500);
  });

  it("el monto que la pantalla muestra es el que se le manda a Stripe", async () => {
    const cobro = await cobrar({ rows: [priceRow(1_299)] });
    const prices = await getTenantPrices(cobro.supabase as never, cobro.tenantId);
    const enPantalla = findPrice(prices, "listing_premium", "estandar", "mensual");

    expect(enPantalla?.amountCents).toBe(cobro.stripe?.unit_amount);
    expect(enPantalla?.currency.toLowerCase()).toBe(cobro.stripe?.currency);
  });

  it("la moneda viaja explícita desde la fila, en minúsculas para Stripe", async () => {
    const { stripe, metadata } = await cobrar({ rows: [priceRow(1_000, "EUR")] });

    expect(stripe?.currency).toBe("eur");
    expect(metadata?.price_cents).toBe("1000");
    expect(metadata?.price_currency).toBe("EUR");
  });
});
