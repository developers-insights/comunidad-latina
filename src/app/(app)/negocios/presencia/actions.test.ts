import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * =============================================================================
 * PRESENCIA VERIFICADA — el Checkout cobra el precio de la comunidad
 * =============================================================================
 *
 * Con Stripe configurado (mockeado: en producción hoy no hay clave). Lo que se
 * ejercita es el `getPrice` REAL sobre una consulta de `tenant_prices`
 * mockeada, que es donde vive la regla "la fila manda, la constante respalda".
 *
 * El anual merece su propio test: son DOS precios distintos del mismo plan y es
 * el caso donde un error se paga doce veces. La pantalla muestra un prorrateo
 * "por mes" junto al total anual; lo que se cobra es siempre el entero de la
 * fila, sin pasar por esa división.
 */

const mocks = vi.hoisted(() => ({
  requireTenantMatch: vi.fn(),
  getTenant: vi.fn(),
  sessionsCreate: vi.fn(),
}));

vi.mock("@/lib/config/services", () => ({ isStripeConfigured: true }));
vi.mock("@/lib/tenant/guard", () => ({ requireTenantMatch: mocks.requireTenantMatch }));
vi.mock("@/lib/tenant/resolve", () => ({ getTenant: mocks.getTenant }));
vi.mock("@/lib/stripe", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/stripe")>()),
  getStripe: () => ({ checkout: { sessions: { create: mocks.sessionsCreate } } }),
}));

import { findPrice } from "@/lib/pricing";
import { getTenantPrices } from "@/lib/pricing/read";
import { PLANES_PRESENCIA, montoCentavos } from "@/lib/stripe";
import { leerPreciosPresencia } from "./precios";
import { iniciarSuscripcion } from "./actions";

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

function priceRow(
  variant: string,
  interval: string,
  amountCents: number,
  currency = "USD",
): PriceRow {
  return {
    id: `presencia-${variant}-${interval}`,
    product: "presencia",
    variant,
    billing_interval: interval,
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
      // business_accounts: el negocio ya existe, así que no se crea nada.
      const other = {
        select: () => other,
        eq: () => other,
        maybeSingle: async () => ({
          data: { id: "biz-1", name: "Panadería", stripe_customer_id: null },
          error: null,
        }),
      };
      return other;
    },
  };
}

async function cobrar(options: {
  rows: PriceRow[] | null;
  plan?: "basico" | "destacado" | "pro";
  intervalo?: "mensual" | "anual";
  tenantId?: string;
}) {
  const tenantId = options.tenantId ?? "tenant-1";
  const supabase = userSupabase(options.rows);

  mocks.getTenant.mockResolvedValue({ id: tenantId, slug: "comunidadlatina" });
  mocks.requireTenantMatch.mockResolvedValue({
    ok: true,
    tenant: { id: tenantId, slug: "comunidadlatina" },
    user: { id: USER, email: "rosa@test.com" },
    supabase,
  });
  mocks.sessionsCreate.mockResolvedValue({ id: "cs_1", url: "https://stripe.test/cs_1" });

  const result = await iniciarSuscripcion({
    plan: options.plan ?? "basico",
    intervalo: options.intervalo ?? "mensual",
  });

  const calls = mocks.sessionsCreate.mock.calls;
  const payload = calls[calls.length - 1]?.[0];
  return {
    result,
    supabase,
    tenantId,
    stripe: payload?.line_items?.[0]?.price_data as
      | { currency: string; unit_amount: number; recurring?: { interval: string } }
      | undefined,
    metadata: payload?.metadata as Record<string, string> | undefined,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("iniciarSuscripcion — de dónde sale el monto", () => {
  it("con fila en tenant_prices cobra ESE monto", async () => {
    const { result, stripe } = await cobrar({
      rows: [priceRow("basico", "mensual", 2_500)],
    });

    expect(result).toMatchObject({ status: "redirect" });
    expect(stripe?.unit_amount).toBe(2_500);
    expect(montoCentavos(PLANES_PRESENCIA.basico, "mensual")).toBe(1_900);
  });

  it("SIN fila cobra exactamente la constante de siempre — mensual y anual", async () => {
    const mensual = await cobrar({ rows: [], plan: "pro", intervalo: "mensual" });
    const anual = await cobrar({ rows: [], plan: "pro", intervalo: "anual" });

    expect(mensual.stripe?.unit_amount).toBe(montoCentavos(PLANES_PRESENCIA.pro, "mensual"));
    expect(anual.stripe?.unit_amount).toBe(montoCentavos(PLANES_PRESENCIA.pro, "anual"));
    expect(anual.stripe?.recurring?.interval).toBe("year");
  });

  it("el anual y el mensual del MISMO plan son dos precios independientes", async () => {
    const anual = await cobrar({
      rows: [priceRow("destacado", "mensual", 3_000), priceRow("destacado", "anual", 27_000)],
      plan: "destacado",
      intervalo: "anual",
    });

    expect(anual.stripe?.unit_amount).toBe(27_000);
    // Nada de multiplicar el mensual por 10 ni por 12: el anual es su propia fila.
    expect(anual.stripe?.unit_amount).not.toBe(30_000 * 10);
  });

  it("dos comunidades con precios distintos cobran distinto", async () => {
    const miami = await cobrar({
      tenantId: "tenant-miami",
      rows: [priceRow("basico", "mensual", 2_500)],
    });
    const houston = await cobrar({
      tenantId: "tenant-houston",
      rows: [priceRow("basico", "mensual", 1_200)],
    });

    expect(miami.stripe?.unit_amount).toBe(2_500);
    expect(houston.stripe?.unit_amount).toBe(1_200);
  });

  it("el monto que la PANTALLA muestra es el que se le manda a Stripe", async () => {
    const cobro = await cobrar({
      rows: [priceRow("pro", "mensual", 5_499)],
      plan: "pro",
    });

    // `leerPreciosPresencia` es literalmente lo que usa page.tsx.
    const precios = await leerPreciosPresencia(cobro.supabase as never, cobro.tenantId);
    expect(precios.pro.mensual.amountCents).toBe(cobro.stripe?.unit_amount);
    expect(precios.pro.mensual.currency.toLowerCase()).toBe(cobro.stripe?.currency);

    // Y la misma fila que ve el lector genérico de precios.
    const prices = await getTenantPrices(cobro.supabase as never, cobro.tenantId);
    expect(findPrice(prices, "presencia", "pro", "mensual")?.amountCents).toBe(5_499);
  });

  it("la moneda viaja explícita desde la fila, en minúsculas para Stripe", async () => {
    const { stripe, metadata } = await cobrar({
      rows: [priceRow("basico", "mensual", 1_800, "EUR")],
    });

    expect(stripe?.currency).toBe("eur");
    expect(metadata?.price_cents).toBe("1800");
    expect(metadata?.price_currency).toBe("EUR");
  });

  it("la metadata dice QUIÉN compró: sin owner_id el webhook no puede verificar la primera compra", async () => {
    // Presencia era el único de los cinco productos que no mandaba `owner_id`.
    // El webhook quedaba correlacionando pertenencia por el customer ya
    // vinculado a la cuenta — que en el alta todavía no existe. O sea:
    // justo la compra más común era la que no se verificaba.
    const { metadata } = await cobrar({ rows: [priceRow("basico", "mensual", 2_500)] });

    expect(metadata?.owner_id).toBe(USER);
  });

  it("el mismo owner_id viaja en la suscripción, que es lo único que traen los eventos customer.subscription.*", async () => {
    await cobrar({ rows: [priceRow("basico", "mensual", 2_500)] });

    const calls = mocks.sessionsCreate.mock.calls;
    const payload = calls[calls.length - 1]?.[0] as
      | { subscription_data?: { metadata?: Record<string, string> } }
      | undefined;

    expect(payload?.subscription_data?.metadata?.owner_id).toBe(USER);
  });
});
