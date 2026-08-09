import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * =============================================================================
 * MEMBRESÍA DE TIENDA — el Checkout cobra el precio de la comunidad
 * =============================================================================
 *
 * Además del monto, acá se prueba la cadena COMPLETA de la membresía: el precio
 * que la action decidió viaja en `metadata.price_cents` y es contra ESE número
 * que el webhook verifica antes de encender la tienda. Sin ese eslabón, el
 * webhook comparaba contra la constante de la spec (USD 10) y cualquier
 * comunidad con otro precio habría cobrado sin activar nada.
 */

const mocks = vi.hoisted(() => ({
  requireTenantMatch: vi.fn(),
  sessionsCreate: vi.fn(),
  limit: vi.fn(() => ({ ok: true })),
  createNotification: vi.fn(),
}));

vi.mock("@/lib/config/services", () => ({ isStripeConfigured: true }));
vi.mock("@/lib/tenant/guard", () => ({ requireTenantMatch: mocks.requireTenantMatch }));
vi.mock("@/lib/rate-limit", () => ({ limit: mocks.limit, HOUR_MS: 3_600_000 }));
vi.mock("@/lib/notifications/notify", () => ({ createNotification: mocks.createNotification }));
vi.mock("@/lib/stripe", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/stripe")>()),
  getStripe: () => ({ checkout: { sessions: { create: mocks.sessionsCreate } } }),
}));

import { MEMBERSHIP_PRICE_CENTS } from "@/components/marketplace/membership";
import { findPrice } from "@/lib/pricing";
import { getTenantPrices } from "@/lib/pricing/read";
import { activarMembresiaTienda } from "./actions";
import { handleStoreMembershipEvent } from "./webhook-handlers";

const STORE = "019fa477-58e6-7ab9-ae4f-cc41716f6419";
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
    id: "store-membership",
    product: "store_membership",
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
      if (table === "store_memberships") {
        const membership = {
          select: () => membership,
          eq: () => membership,
          maybeSingle: async () => ({ data: null, error: null }),
        };
        return membership;
      }
      const listing = {
        select: () => listing,
        eq: () => listing,
        maybeSingle: async () => ({
          data: { id: STORE, title: "Tienda de Rosa", created_by: USER, store_active: false },
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

  const result = await activarMembresiaTienda({ storeId: STORE });
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
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("activarMembresiaTienda — de dónde sale el monto", () => {
  it("con fila en tenant_prices cobra ESE monto", async () => {
    const { result, stripe } = await cobrar({ rows: [priceRow(2_500)] });

    expect(result).toMatchObject({ status: "redirect" });
    expect(stripe?.unit_amount).toBe(2_500);
    expect(MEMBERSHIP_PRICE_CENTS).toBe(1_000);
  });

  it("SIN fila cobra exactamente la constante de siempre", async () => {
    const { stripe } = await cobrar({ rows: [] });

    expect(stripe?.unit_amount).toBe(MEMBERSHIP_PRICE_CENTS);
    expect(stripe?.currency).toBe("usd");
  });

  it("dos comunidades con precios distintos cobran distinto", async () => {
    const miami = await cobrar({ tenantId: "tenant-miami", rows: [priceRow(2_500)] });
    const houston = await cobrar({ tenantId: "tenant-houston", rows: [priceRow(700)] });

    expect(miami.stripe?.unit_amount).toBe(2_500);
    expect(houston.stripe?.unit_amount).toBe(700);
  });

  it("el monto que la pantalla muestra es el que se le manda a Stripe", async () => {
    const cobro = await cobrar({ rows: [priceRow(1_499)] });
    const prices = await getTenantPrices(cobro.supabase as never, cobro.tenantId);
    const enPantalla = findPrice(prices, "store_membership", "estandar", "mensual");

    expect(enPantalla?.amountCents).toBe(cobro.stripe?.unit_amount);
    expect(enPantalla?.currency.toLowerCase()).toBe(cobro.stripe?.currency);
  });

  it("la moneda viaja explícita desde la fila, en minúsculas para Stripe", async () => {
    const { stripe, metadata } = await cobrar({ rows: [priceRow(2_000, "EUR")] });

    expect(stripe?.currency).toBe("eur");
    expect(metadata?.price_currency).toBe("EUR");
  });
});

/* -------------------------------------------------------------------------- */
/* La cadena completa: lo que se cobró es lo que el webhook espera             */
/* -------------------------------------------------------------------------- */

/**
 * La tienda tal como la lee el webhook al correlacionar: existe, es del tenant
 * de la metadata y sigue siendo de quien compró. Es el camino feliz por defecto;
 * los casos de rechazo por correlación viven en
 * `src/app/api/webhooks/stripe/membresia.test.ts`, que ejercita el POST entero.
 */
const STORE_ROW = { id: STORE, tenant_id: "tenant-1", created_by: USER };

/** Admin client mínimo: recuerda el upsert y responde vacío a todo lo demás. */
function adminSpy(
  captured: { upsert: Record<string, unknown> | null },
  storeRow: unknown = STORE_ROW,
) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    maybeSingle: async () => ({ data: null, error: null }),
    upsert: async (values: Record<string, unknown>) => {
      captured.upsert = values;
      return { error: null };
    },
    insert: async () => ({ error: null }),
  };
  const listings = {
    select: () => listings,
    eq: () => listings,
    maybeSingle: async () => ({ data: storeRow, error: null }),
  };
  // `rpc` existe porque `getTenantPrices` reintenta por
  // `public.tenant_public_prices` (0078) cuando la lectura directa vuelve vacía
  // —el caso del visitante sin sesión, donde RLS filtra en silencio—. Devolver
  // vacío acá deja que rijan las constantes, que es lo que estos casos esperan.
  return {
    from: (table: string) => (table === "listings" ? listings : builder),
    rpc: async () => ({ data: [], error: null }),
  } as never;
}

function checkoutEvent(
  metadata: Record<string, string>,
  amountTotal: number,
  currency = "usd",
) {
  return {
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_1",
        payment_status: "paid",
        amount_total: amountTotal,
        // Stripe la devuelve SIEMPRE en minúsculas; `metadata.price_currency`
        // viene de `tenant_prices`, que la guarda en MAYÚSCULAS.
        currency,
        customer: "cus_1",
        subscription: "sub_1",
        metadata,
      },
    },
  } as never;
}

describe("handleStoreMembershipEvent — verificación del monto", () => {
  it("activa con el precio configurado de la comunidad, no con la constante", async () => {
    const { metadata } = await cobrar({ rows: [priceRow(2_500)] });
    const captured: { upsert: Record<string, unknown> | null } = { upsert: null };

    const handled = await handleStoreMembershipEvent(
      adminSpy(captured),
      checkoutEvent(metadata as Record<string, string>, 2_500),
    );

    expect(handled).toBe(true);
    expect(captured.upsert).toMatchObject({ status: "active", price_cents: 2_500 });
  });

  it("un monto que no coincide con lo pactado NO activa la tienda", async () => {
    const { metadata } = await cobrar({ rows: [priceRow(2_500)] });
    const captured: { upsert: Record<string, unknown> | null } = { upsert: null };

    await handleStoreMembershipEvent(
      adminSpy(captured),
      checkoutEvent(metadata as Record<string, string>, 1_000),
    );

    expect(captured.upsert).toBeNull();
  });

  it("camino feliz: una comunidad que cobra en euros activa igual, con su moneda escrita en la fila", async () => {
    const { metadata } = await cobrar({ rows: [priceRow(2_000, "EUR")] });
    const captured: { upsert: Record<string, unknown> | null } = { upsert: null };

    const handled = await handleStoreMembershipEvent(
      adminSpy(captured),
      checkoutEvent(metadata as Record<string, string>, 2_000, "eur"),
    );

    expect(handled).toBe(true);
    // Se compara normalizado (metadata "EUR" vs Stripe "eur") y la fila queda
    // con la moneda que efectivamente se cobró.
    expect(captured.upsert).toMatchObject({ status: "active", currency: "eur" });
  });

  it("camino feliz: la constante de la spec sigue activando cuando ES lo pactado", async () => {
    // Sin fila en `tenant_prices` la action cobra la constante — y la manda en
    // la metadata. El webhook la verifica contra ESE número, no contra la
    // constante importada: acá coinciden porque es el mismo cobro.
    const { metadata } = await cobrar({ rows: [] });
    const captured: { upsert: Record<string, unknown> | null } = { upsert: null };

    const handled = await handleStoreMembershipEvent(
      adminSpy(captured),
      checkoutEvent(metadata as Record<string, string>, MEMBERSHIP_PRICE_CENTS),
    );

    expect(handled).toBe(true);
    expect(captured.upsert).toMatchObject({ price_cents: MEMBERSHIP_PRICE_CENTS });
  });

  it("NO activa si se cobró en otra moneda con el mismo entero (2000 ARS ≠ 2000 eur)", async () => {
    const { metadata } = await cobrar({ rows: [priceRow(2_000, "EUR")] });
    const captured: { upsert: Record<string, unknown> | null } = { upsert: null };

    await handleStoreMembershipEvent(
      adminSpy(captured),
      checkoutEvent(metadata as Record<string, string>, 2_000, "ars"),
    );

    expect(captured.upsert).toBeNull();
  });

  it("una Session sin precio pactado legible NO activa: el respaldo a la constante ERA el bug", async () => {
    // Con la comunidad cobrando USD 25, Stripe cobraba 2500, el handler
    // comparaba contra la constante 1000 y no activaba: plata cobrada, tienda
    // apagada. Y al revés —activar igual sin poder verificar— sería peor: un
    // Checkout manipulado pagaría un centavo. Sin precio pactado no se concede.
    const captured: { upsert: Record<string, unknown> | null } = { upsert: null };
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const handled = await handleStoreMembershipEvent(
      adminSpy(captured),
      checkoutEvent(
        { tenant_id: "tenant-1", store_id: STORE, owner_id: USER, kind: "store_membership" },
        MEMBERSHIP_PRICE_CENTS,
      ),
    );

    // Se dio por atendido (nadie más lo va a mirar) pero NO se activó.
    expect(handled).toBe(true);
    expect(captured.upsert).toBeNull();
    // Y quedó el rastro para reconciliar a mano en el Dashboard.
    const mensaje = errorSpy.mock.calls.flat().join(" ");
    expect(mensaje).toContain("cs_1");
    expect(mensaje).toContain(STORE);
  });
});
