import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * =============================================================================
 * CHECK AZUL — nadie contrata, cancela ni canjea lo de otro
 * =============================================================================
 *
 * Las server actions son endpoints POST públicos: que el formulario no ofrezca
 * una opción no impide que alguien la mande igual. Lo que se prueba acá es que
 * cada decisión de plata la toma el SERVIDOR con la sesión, no el request.
 *
 * También se prueba la cadena del precio: lo que la action decidió cobrar viaja
 * en `metadata.price_cents`, y es contra ESE número que el webhook verifica
 * antes de encender la insignia. Sin ese eslabón, una comunidad con precio
 * propio cobraría y el webhook no concedería nada.
 */

const mocks = vi.hoisted(() => ({
  requireTenantMatch: vi.fn(),
  sessionsCreate: vi.fn(),
  portalCreate: vi.fn(),
  limit: vi.fn(() => ({ ok: true })),
  admin: vi.fn(),
}));

vi.mock("@/lib/config/services", () => ({ isStripeConfigured: true }));
vi.mock("@/lib/tenant/guard", () => ({ requireTenantMatch: mocks.requireTenantMatch }));
vi.mock("@/lib/rate-limit", () => ({ limit: mocks.limit, HOUR_MS: 3_600_000 }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => mocks.admin() }));
vi.mock("@/lib/stripe", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/stripe")>()),
  getStripe: () => ({
    checkout: { sessions: { create: mocks.sessionsCreate } },
    billingPortal: { sessions: { create: mocks.portalCreate } },
  }),
}));

import { VERIFICACION_PLANES, verificacionMontoCentavos } from "@/lib/verificacion/catalogo";
import { activarCheckAzul, canjearImpulsoDeRegalo } from "./actions";

const TENANT = "019fa477-58e6-7ab9-ae4f-cc41716fa001";
const USER = "019fa477-58e6-7ab9-ae4f-cc41716fa002";
const OTRO = "019fa477-58e6-7ab9-ae4f-cc41716fa003";
const LISTING = "019fa477-58e6-7ab9-ae4f-cc41716fa004";
const GRANT = "019fa477-58e6-7ab9-ae4f-cc41716fa005";

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

function priceRow(variant: string, cents: number, currency = "USD"): PriceRow {
  return {
    id: `p-${variant}`,
    product: "verificacion",
    variant,
    billing_interval: "mensual",
    amount_cents: cents,
    currency,
    active: true,
    updated_at: null,
  };
}

/** Cliente del usuario: precios, perfil, suscripción previa, aviso, crédito. */
function userSupabase(opts: {
  precios?: PriceRow[];
  identityVerified?: boolean;
  suscripcion?: Record<string, unknown> | null;
  listing?: Record<string, unknown> | null;
  grant?: Record<string, unknown> | null;
}) {
  const datosPorTabla: Record<string, unknown> = {
    profiles: { id: USER, identity_verified: opts.identityVerified ?? true },
    verification_subscriptions: opts.suscripcion ?? null,
    listings: opts.listing === undefined
      ? { id: LISTING, tenant_id: TENANT, status: "published", created_by: USER, area_label: "Corona" }
      : opts.listing,
    verification_boost_grants: opts.grant ?? null,
    tenants: { country_focus: "DO" },
  };

  return {
    rpc: async () => ({ data: [], error: null }),
    from(tabla: string) {
      // `tenant_prices` se lee con `.select().eq()` y se ESPERA ahí mismo; el
      // resto sigue encadenando `.eq().eq().maybeSingle()`. Son dos formas
      // incompatibles en un solo builder, así que se distinguen por tabla —
      // un doble que sólo soportara una de las dos no ejercitaría el código real.
      if (tabla === "tenant_prices") {
        return {
          select: () => ({ eq: async () => ({ data: opts.precios ?? [], error: null }) }),
        };
      }

      const chain = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        limit: () => chain,
        maybeSingle: async () => ({ data: datosPorTabla[tabla] ?? null, error: null }),
      };
      return chain;
    },
  };
}

async function contratar(opts: Parameters<typeof userSupabase>[0] & { tier?: string } = {}) {
  const supabase = userSupabase(opts);
  mocks.requireTenantMatch.mockResolvedValue({
    ok: true,
    tenant: { id: TENANT, slug: "comunidadlatina" },
    user: { id: USER, email: "rosa@test.com" },
    supabase,
  });
  mocks.sessionsCreate.mockResolvedValue({ id: "cs_1", url: "https://stripe.test/cs_1" });

  const result = await activarCheckAzul({ tier: opts.tier ?? "negocio" });
  const payload = mocks.sessionsCreate.mock.calls.at(-1)?.[0];
  return {
    result,
    stripe: payload?.line_items?.[0]?.price_data as
      | { currency: string; unit_amount: number }
      | undefined,
    metadata: payload?.metadata as Record<string, string> | undefined,
    subMetadata: payload?.subscription_data?.metadata as Record<string, string> | undefined,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.limit.mockReturnValue({ ok: true });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});

/* -------------------------------------------------------------------------- */

describe("activarCheckAzul — la identidad es requisito, no adorno", () => {
  it("SIN identidad verificada no se abre ningún Checkout", async () => {
    const { result } = await contratar({ identityVerified: false });

    expect(result.status).toBe("sin_identidad");
    expect(mocks.sessionsCreate).not.toHaveBeenCalled();
  });

  it("con identidad verificada sí se abre", async () => {
    const { result } = await contratar({ identityVerified: true });
    expect(result).toMatchObject({ status: "redirect" });
  });

  it("con el check YA activo no se abre un segundo Checkout", async () => {
    const { result } = await contratar({
      suscripcion: { id: "s1", status: "active", stripe_customer_id: "cus_1" },
    });

    expect(result.status).toBe("error");
    expect(mocks.sessionsCreate).not.toHaveBeenCalled();
  });

  it("con una suscripción VENCIDA sí deja reactivar, y reusa su customer", async () => {
    await contratar({
      suscripcion: { id: "s1", status: "expired", stripe_customer_id: "cus_viejo" },
    });

    expect(mocks.sessionsCreate.mock.calls.at(-1)?.[0]?.customer).toBe("cus_viejo");
  });
});

describe("activarCheckAzul — a quién se le enciende lo decide la sesión", () => {
  /**
   * EL TEST DE AUTORIZACIÓN QUE IMPORTA. El input sólo trae el escalón. Aunque
   * alguien mande `profile_id` o `tenant_id` en el body, la action los ignora:
   * los toma del guard. Si esto dejara de ser cierto, cualquiera podría
   * encenderle —o hacerle pagar— la insignia a otra persona.
   */
  it("el profile_id de la metadata es SIEMPRE el de la sesión, no el del request", async () => {
    const supabase = userSupabase({});
    mocks.requireTenantMatch.mockResolvedValue({
      ok: true,
      tenant: { id: TENANT, slug: "comunidadlatina" },
      user: { id: USER, email: "rosa@test.com" },
      supabase,
    });
    mocks.sessionsCreate.mockResolvedValue({ id: "cs_1", url: "https://stripe.test/cs_1" });

    await activarCheckAzul({
      tier: "negocio",
      profile_id: OTRO,
      tenant_id: "tenant-ajeno",
      price_cents: "1",
    });

    const metadata = mocks.sessionsCreate.mock.calls.at(-1)?.[0]?.metadata;
    expect(metadata.profile_id).toBe(USER);
    expect(metadata.tenant_id).toBe(TENANT);
    expect(metadata.price_cents).not.toBe("1");
  });

  it("sin sesión no se cobra nada", async () => {
    mocks.requireTenantMatch.mockResolvedValue({ ok: false, reason: "unauthenticated" });
    expect(await activarCheckAzul({ tier: "persona" })).toEqual({ status: "sin_sesion" });
    expect(mocks.sessionsCreate).not.toHaveBeenCalled();
  });

  it("un escalón inventado no llega a Stripe", async () => {
    const { result } = await contratar({ tier: "gratis" });
    expect(result.status).toBe("error");
    expect(mocks.sessionsCreate).not.toHaveBeenCalled();
  });
});

describe("activarCheckAzul — de dónde sale el monto", () => {
  it("SIN fila en tenant_prices cobra la constante del código", async () => {
    const { stripe } = await contratar({ precios: [] });

    expect(stripe?.unit_amount).toBe(verificacionMontoCentavos(VERIFICACION_PLANES.negocio));
    expect(stripe?.unit_amount).toBe(999);
    expect(stripe?.currency).toBe("usd");
  });

  it("los tres escalones son los tres precios del cliente", () => {
    expect(verificacionMontoCentavos(VERIFICACION_PLANES.persona)).toBe(699);
    expect(verificacionMontoCentavos(VERIFICACION_PLANES.negocio)).toBe(999);
    expect(verificacionMontoCentavos(VERIFICACION_PLANES.profesional)).toBe(1_999);
  });

  it("con fila propia cobra ESE monto — el precio es por comunidad", async () => {
    const { stripe, metadata } = await contratar({
      precios: [priceRow("negocio", 1_499)],
    });

    expect(stripe?.unit_amount).toBe(1_499);
    expect(metadata?.price_cents).toBe("1499");
  });

  it("lo pactado viaja en la metadata de la Session Y de la suscripción", async () => {
    // Las dos, porque los eventos `customer.subscription.*` y las facturas NO
    // traen la metadata de la Session: sin repetirla, el regalo mensual no
    // sabría de qué producto es la factura.
    const { metadata, subMetadata } = await contratar({ precios: [priceRow("negocio", 1_499)] });

    expect(metadata?.kind).toBe("verificacion");
    expect(subMetadata).toEqual(metadata);
  });

  it("la moneda viaja explícita, en minúsculas para Stripe y en ISO en la metadata", async () => {
    const { stripe, metadata } = await contratar({
      precios: [priceRow("negocio", 2_000, "EUR")],
    });

    expect(stripe?.currency).toBe("eur");
    expect(metadata?.price_currency).toBe("EUR");
  });
});

/* -------------------------------------------------------------------------- */

/** Admin client del canje: recuerda updates e inserts, y simula la carrera. */
function adminCanje(opts: { reclamaOk?: boolean; capt: Record<string, unknown[]> }) {
  const { capt } = opts;
  const reclamaOk = opts.reclamaOk ?? true;

  return {
    from(tabla: string) {
      const chain: Record<string, unknown> = {};
      Object.assign(chain, {
        select: () => chain,
        eq: () => chain,
        lt: () => chain,
        maybeSingle: async () => ({
          // `update ... where status='pendiente'` devuelve fila sólo si ganó la
          // carrera. `null` = otro pedido ya lo gastó.
          data: reclamaOk ? { id: GRANT } : null,
          error: null,
        }),
        single: async () => ({ data: { id: "boost-nuevo" }, error: null }),
        update: (values: Record<string, unknown>) => {
          (capt[`update:${tabla}`] ??= []).push(values);
          return chain;
        },
        insert: (values: Record<string, unknown>) => {
          (capt[`insert:${tabla}`] ??= []).push(values);
          return chain;
        },
        then: (resolve: (v: unknown) => unknown) => resolve({ data: null, error: null }),
      });
      return chain;
    },
  };
}

const GRANT_VIVO = {
  id: GRANT,
  tenant_id: TENANT,
  profile_id: USER,
  status: "pendiente",
  expires_at: new Date(Date.now() + 5 * 86_400_000).toISOString(),
  duration_days: 7,
};

async function canjear(opts: {
  grant?: Record<string, unknown> | null;
  listing?: Record<string, unknown> | null;
  reclamaOk?: boolean;
}) {
  const capt: Record<string, unknown[]> = {};
  const supabase = userSupabase({ grant: opts.grant ?? GRANT_VIVO, listing: opts.listing });
  mocks.requireTenantMatch.mockResolvedValue({
    ok: true,
    tenant: { id: TENANT, slug: "comunidadlatina" },
    user: { id: USER, email: "rosa@test.com" },
    supabase,
  });
  mocks.admin.mockReturnValue(adminCanje({ reclamaOk: opts.reclamaOk, capt }));

  const result = await canjearImpulsoDeRegalo({ grantId: GRANT, listingId: LISTING });
  return { result, capt };
}

describe("canjearImpulsoDeRegalo — un crédito, un impulso", () => {
  it("el camino feliz crea un impulso de REGALO: monto 0 y origen verificacion", async () => {
    const { result, capt } = await canjear({});

    expect(result.status).toBe("ok");
    const boost = capt["insert:boosts"]?.[0] as Record<string, unknown>;
    expect(boost).toMatchObject({
      amount_cents: 0,
      origin: "verificacion",
      duration_days: 7,
      package: "7d",
      status: "active",
      buyer_id: USER,
      listing_id: LISTING,
    });
  });

  /**
   * ⭐ LA CARRERA. Doble clic, dos pestañas, un reintento del cliente: el
   * `update ... where status='pendiente'` no afecta ninguna fila la segunda vez,
   * y ahí termina. Si esto fallara, un crédito daría dos impulsos gratis.
   */
  it("si otro pedido ya lo gastó, NO se crea un segundo impulso", async () => {
    const { result, capt } = await canjear({ reclamaOk: false });

    expect(result.status).toBe("error");
    expect(capt["insert:boosts"]).toBeUndefined();
  });

  it("un crédito YA USADO no se vuelve a canjear", async () => {
    const { result, capt } = await canjear({
      grant: { ...GRANT_VIVO, status: "usado" },
    });

    expect(result.status).toBe("error");
    expect(capt["insert:boosts"]).toBeUndefined();
  });

  it("un crédito VENCIDO no se canjea — el regalo es mensual, no un saldo", async () => {
    const { result, capt } = await canjear({
      grant: { ...GRANT_VIVO, expires_at: new Date(Date.now() - 86_400_000).toISOString() },
    });

    expect(result.status).toBe("error");
    expect(capt["insert:boosts"]).toBeUndefined();
  });

  it("un crédito de OTRA COMUNIDAD no se canjea", async () => {
    const { result, capt } = await canjear({
      grant: { ...GRANT_VIVO, tenant_id: "tenant-ajeno" },
    });

    expect(result.status).toBe("error");
    expect(capt["insert:boosts"]).toBeUndefined();
  });

  it("sobre un aviso AJENO no se canjea", async () => {
    const { result, capt } = await canjear({ listing: null });

    expect(result.status).toBe("error");
    expect(capt["insert:boosts"]).toBeUndefined();
  });

  it("sobre un aviso SIN publicar no se canjea", async () => {
    const { result, capt } = await canjear({
      listing: { id: LISTING, tenant_id: TENANT, status: "draft", created_by: USER, area_label: "Corona" },
    });

    expect(result.status).toBe("error");
    expect(capt["insert:boosts"]).toBeUndefined();
  });

  it("el alcance del regalo es LOCAL a la zona del aviso, no el más caro", async () => {
    // El recargo por alcance (0092) se cobra aparte. Regalar 'global' sería
    // regalar algo que nadie pagó.
    const { capt } = await canjear({});
    const boost = capt["insert:boosts"]?.[0] as Record<string, unknown>;

    expect(boost.scope).toBe("local");
    expect(boost.scope_area).toBe("Corona");
    expect(boost.scope_country).toBeNull();
  });

  it("un aviso sin zona cae a NACIONAL, que es lo que el CHECK de coherencia exige", async () => {
    const { capt } = await canjear({
      listing: { id: LISTING, tenant_id: TENANT, status: "published", created_by: USER, area_label: null },
    });
    const boost = capt["insert:boosts"]?.[0] as Record<string, unknown>;

    expect(boost.scope).toBe("nacional");
    expect(boost.scope_area).toBeNull();
  });
});
