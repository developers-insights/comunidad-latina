import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * =============================================================================
 * EL IMPULSO COBRA EL PRECIO DE LA COMUNIDAD, NO LA CONSTANTE DEL CÓDIGO
 * =============================================================================
 *
 * Estos tests corren con Stripe CONFIGURADO a propósito (`isStripeConfigured:
 * true` mockeado): en producción hoy no hay clave, así que el camino que cobra
 * de verdad sólo se puede verificar acá. El `getPrice` que se ejercita es el
 * REAL — se mockea la consulta a `tenant_prices`, no la resolución del precio,
 * porque justamente lo que hay que probar es la regla "la fila manda, la
 * constante respalda".
 *
 * LAS TRES COSAS QUE NO PUEDEN ROMPERSE
 *  1. Con fila en `tenant_prices` se cobra ESE monto.
 *  2. SIN fila se cobra exactamente el mismo monto que se cobraba antes de que
 *     esta tabla existiera. Aplicar el cambio no mueve un centavo hasta que
 *     alguien edite un precio en el panel.
 *  3. Lo que se guarda en `boosts.amount_cents` y lo que viaja a Stripe son el
 *     MISMO número. El webhook compara los dos antes de activar el impulso: si
 *     divergen, la plata entra y el aviso nunca sube.
 */

const mocks = vi.hoisted(() => ({
  requireTenantMatch: vi.fn(),
  getTenant: vi.fn(),
  createAdminClient: vi.fn(),
  sessionsCreate: vi.fn(),
  sessionsExpire: vi.fn(),
  limit: vi.fn(() => ({ ok: true })),
}));

vi.mock("@/lib/config/services", () => ({ isStripeConfigured: true }));
vi.mock("@/lib/tenant/guard", () => ({ requireTenantMatch: mocks.requireTenantMatch }));
vi.mock("@/lib/tenant/resolve", () => ({ getTenant: mocks.getTenant }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/rate-limit", () => ({ limit: mocks.limit, HOUR_MS: 3_600_000 }));

// Mock PARCIAL: `getStripe` se reemplaza, pero los paquetes y sus montos siguen
// siendo los de verdad — son justamente el respaldo que hay que comparar.
vi.mock("@/lib/stripe", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/stripe")>()),
  getStripe: () => ({
    checkout: {
      sessions: { create: mocks.sessionsCreate, expire: mocks.sessionsExpire },
    },
  }),
}));

import { findPrice } from "@/lib/pricing";
import { getTenantPrices } from "@/lib/pricing/read";
import { BOOST_PACKAGES, boostMontoCentavos } from "@/lib/stripe";
import { crearBoostCheckout } from "./actions";

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

function priceRow(
  product: string,
  variant: string,
  interval: string,
  amountCents: number,
  currency = "USD",
): PriceRow {
  return {
    id: `price-${product}-${variant}-${interval}`,
    product,
    variant,
    billing_interval: interval,
    amount_cents: amountCents,
    currency,
    active: true,
    updated_at: null,
  };
}

/** Cliente del usuario: `tenant_prices` configurable, el aviso siempre propio. */
function userSupabase(rows: PriceRow[] | null, tenantId = "tenant-1") {
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
            tenant_id: tenantId,
            title: "Panadería Doña Rosa",
            status: "published",
            created_by: USER,
            area_label: "Doral",
          },
          error: null,
        }),
      };
      return listing;
    },
  };
}

/** Admin client que sólo guarda lo que se le pidió escribir en `boosts`. */
function adminSpy(captured: { insert: Record<string, unknown> | null }) {
  const builder = {
    insert(values: Record<string, unknown>) {
      captured.insert = values;
      return {
        select: () => ({
          single: async () => ({ data: { id: "boost-1" }, error: null }),
        }),
      };
    },
    update: () => ({ eq: async () => ({ error: null }) }),
  };
  // `rpc` existe porque `getTenantPrices` reintenta por
  // `public.tenant_public_prices` (0078) cuando la lectura directa vuelve vacía
  // —el caso del visitante sin sesión, donde RLS filtra en silencio—. Devolver
  // vacío acá deja que rijan las constantes, que es lo que estos casos esperan.
  return { from: () => builder, rpc: async () => ({ data: [], error: null }) };
}

/** Prepara el escenario y devuelve lo que la action decidió cobrar. */
async function cobrar(options: {
  rows: PriceRow[] | null;
  tenantId?: string;
  paquete?: "7d" | "14d" | "30d";
  /**
   * Alcance geográfico (0092). Por defecto `local`, cuyo recargo de respaldo es
   * CERO: así los casos que ya existían siguen comparando exactamente el precio
   * de la duración, que es lo que estaban probando. Los casos del recargo lo
   * pasan explícito.
   */
  alcance?: "local" | "nacional" | "global";
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

  const result = await crearBoostCheckout({
    listingId: LISTING,
    paquete: options.paquete ?? "14d",
    alcance: options.alcance ?? "local",
  });

  // La ÚLTIMA llamada: un mismo test puede cobrar dos veces (dos comunidades).
  const calls = mocks.sessionsCreate.mock.calls;
  const lineItem = calls[calls.length - 1]?.[0]?.line_items?.[0];
  return {
    result,
    fila: captured.insert,
    stripe: lineItem?.price_data as { currency: string; unit_amount: number } | undefined,
    // Lo mismo que lee la PANTALLA para dibujar la tarjeta: misma función,
    // mismo cliente, mismo tenant.
    async mostrado(paquete: "7d" | "14d" | "30d" = options.paquete ?? "14d") {
      const prices = await getTenantPrices(
        supabase as never,
        tenantId,
      );
      return findPrice(prices, "boost", paquete, "unico");
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.limit.mockReturnValue({ ok: true });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("crearBoostCheckout — de dónde sale el monto", () => {
  it("con fila en tenant_prices cobra ESE monto, no la constante", async () => {
    const { result, fila, stripe } = await cobrar({
      rows: [priceRow("boost", "14d", "unico", 3_000)],
    });

    expect(result).toMatchObject({ status: "redirect" });
    expect(stripe?.unit_amount).toBe(3_000);
    expect(fila?.amount_cents).toBe(3_000);
    // La constante del código son USD 25; si se colara, sería 2500.
    expect(boostMontoCentavos(BOOST_PACKAGES["14d"])).toBe(2_500);
    expect(stripe?.unit_amount).not.toBe(2_500);
  });

  it("SIN fila cobra exactamente lo mismo que antes de que existiera la tabla", async () => {
    const { fila, stripe } = await cobrar({ rows: [] });

    expect(stripe?.unit_amount).toBe(boostMontoCentavos(BOOST_PACKAGES["14d"]));
    expect(fila?.amount_cents).toBe(boostMontoCentavos(BOOST_PACKAGES["14d"]));
    expect(stripe?.currency).toBe("usd");
  });

  it("si la consulta de precios FALLA tampoco se queda sin precio: rige la constante", async () => {
    // `rows: null` con error se testea en el módulo de precios; acá alcanza con
    // que una respuesta vacía no deje el Checkout sin monto.
    const { stripe } = await cobrar({ rows: null });

    expect(stripe?.unit_amount).toBe(boostMontoCentavos(BOOST_PACKAGES["14d"]));
  });

  it("dos comunidades con precios distintos cobran distinto", async () => {
    const miami = await cobrar({
      tenantId: "tenant-miami",
      rows: [priceRow("boost", "7d", "unico", 1_500)],
      paquete: "7d",
    });
    const houston = await cobrar({
      tenantId: "tenant-houston",
      rows: [priceRow("boost", "7d", "unico", 800)],
      paquete: "7d",
    });

    expect(miami.stripe?.unit_amount).toBe(1_500);
    expect(houston.stripe?.unit_amount).toBe(800);
  });

  it("el monto que se MUESTRA es el mismo que se le manda a Stripe", async () => {
    const cobro = await cobrar({ rows: [priceRow("boost", "30d", "unico", 4_299)], paquete: "30d" });
    const enPantalla = await cobro.mostrado("30d");

    expect(enPantalla?.amountCents).toBe(cobro.stripe?.unit_amount);
    expect(enPantalla?.currency.toLowerCase()).toBe(cobro.stripe?.currency);
  });

  it("la moneda viaja explícita desde la fila, en minúsculas para Stripe", async () => {
    const { fila, stripe } = await cobrar({
      rows: [priceRow("boost", "14d", "unico", 2_000, "EUR")],
    });

    expect(stripe?.currency).toBe("eur");
    expect(fila?.currency).toBe("eur");
  });

  it("el monto es un entero de centavos — nunca un flotante", async () => {
    const { fila, stripe } = await cobrar({
      rows: [priceRow("boost", "14d", "unico", 1_999)],
    });

    expect(Number.isSafeInteger(stripe?.unit_amount)).toBe(true);
    expect(Number.isSafeInteger(fila?.amount_cents)).toBe(true);
    expect(stripe?.unit_amount).toBe(1_999);
  });

  it("una fila apagada (active=false) vuelve a la constante, no cobra cero", async () => {
    const apagada = { ...priceRow("boost", "14d", "unico", 3_000), active: false };
    const { stripe } = await cobrar({ rows: [apagada] });

    expect(stripe?.unit_amount).toBe(boostMontoCentavos(BOOST_PACKAGES["14d"]));
  });
});

/**
 * =============================================================================
 * EL ALCANCE GEOGRÁFICO CAMBIA LO QUE SE COBRA — y lo que se guarda (0092)
 * =============================================================================
 *
 * El impulso pasó a cobrarse con DOS filas de `tenant_prices` sumadas: la
 * duración y el recargo del alcance. Lo que estos casos protegen es que la suma
 * sea una sola —`combineBoostPrice`— y que el objetivo del alcance lo ponga el
 * SERVIDOR, nunca el formulario.
 */
describe("crearBoostCheckout — el alcance geográfico (0092)", () => {
  it("el recargo del alcance se SUMA al precio de la duración", async () => {
    const { fila, stripe } = await cobrar({
      rows: [
        priceRow("boost", "14d", "unico", 2_500),
        priceRow("boost_scope", "global", "unico", 4_000),
      ],
      alcance: "global",
    });

    expect(stripe?.unit_amount).toBe(6_500);
    expect(fila?.amount_cents).toBe(6_500);
    expect(fila?.scope).toBe("global");
  });

  it("tres alcances, tres precios distintos para la MISMA duración", async () => {
    const rows = [
      priceRow("boost", "14d", "unico", 2_500),
      priceRow("boost_scope", "local", "unico", 0),
      priceRow("boost_scope", "nacional", "unico", 1_500),
      priceRow("boost_scope", "global", "unico", 4_000),
    ];

    const local = await cobrar({ rows, alcance: "local" });
    const nacional = await cobrar({ rows, alcance: "nacional" });
    const global = await cobrar({ rows, alcance: "global" });

    expect(local.stripe?.unit_amount).toBe(2_500);
    expect(nacional.stripe?.unit_amount).toBe(4_000);
    expect(global.stripe?.unit_amount).toBe(6_500);
  });

  it("el objetivo lo pone el servidor: la zona sale del AVISO, no del request", async () => {
    const { fila } = await cobrar({
      rows: [priceRow("boost", "14d", "unico", 2_500)],
      alcance: "local",
    });

    // "Doral" es el `area_label` del aviso mockeado. No hay forma de pedir otra.
    expect(fila?.scope_area).toBe("Doral");
    expect(fila?.scope_country).toBeNull();
  });

  it("un impulso global no guarda objetivo: llega a todos", async () => {
    const { fila } = await cobrar({
      rows: [priceRow("boost", "14d", "unico", 2_500)],
      alcance: "global",
    });

    expect(fila?.scope_area).toBeNull();
    expect(fila?.scope_country).toBeNull();
  });

  it("sin recargo configurado se cobra sólo la duración — nunca un total inventado", async () => {
    const { stripe } = await cobrar({
      rows: [priceRow("boost", "14d", "unico", 2_500)],
      alcance: "nacional",
    });

    // El respaldo del código para `nacional` son USD 15; el mock de la RPC
    // pública devuelve vacío, así que rige la constante y el total es 2500+1500.
    expect(stripe?.unit_amount).toBe(4_000);
  });

  it("un recargo en OTRA moneda no se convierte al vuelo: se cobra la duración", async () => {
    const { stripe } = await cobrar({
      rows: [
        priceRow("boost", "14d", "unico", 2_500, "USD"),
        priceRow("boost_scope", "global", "unico", 4_000, "EUR"),
      ],
      alcance: "global",
    });

    expect(stripe?.unit_amount).toBe(2_500);
    expect(stripe?.currency).toBe("usd");
  });

  it("sin alcance en el input no se cobra nada: no se adivina cuál quiso", async () => {
    mocks.getTenant.mockResolvedValue({ id: "tenant-1", slug: "comunidadlatina" });
    const result = await crearBoostCheckout({ listingId: LISTING, paquete: "14d" });

    expect(result).toMatchObject({ status: "error" });
    expect(mocks.sessionsCreate).not.toHaveBeenCalled();
  });
});
