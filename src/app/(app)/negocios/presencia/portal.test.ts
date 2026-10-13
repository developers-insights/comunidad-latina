import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * El portal de Stripe deja cancelar y cambiar la tarjeta del customer que se le
 * pasa, sin preguntar nada más. Entregarle el customer equivocado es entregarle
 * a un vecino la facturación de otro, así que el fake de Supabase aplica los
 * filtros de verdad: si la action no filtra por dueño y por comunidad, la fila
 * ajena aparece y el test lo ve.
 */

const mocks = vi.hoisted(() => ({
  getIdentidadActiva: vi.fn(),
  requireTenantMatch: vi.fn(),
  portalCreate: vi.fn(),
  config: { stripe: true },
}));

vi.mock("@/lib/config/services", () => ({
  get isStripeConfigured() {
    return mocks.config.stripe;
  },
}));
vi.mock("@/lib/perfil-activo/identidad", () => ({
  getIdentidadActiva: mocks.getIdentidadActiva,
}));
vi.mock("@/lib/tenant/guard", () => ({ requireTenantMatch: mocks.requireTenantMatch }));
vi.mock("@/lib/tenant/resolve", () => ({ getTenant: vi.fn() }));
vi.mock("@/lib/stripe", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/stripe")>()),
  getStripe: () => ({ billingPortal: { sessions: { create: mocks.portalCreate } } }),
}));

import { abrirPortalPresencia } from "./actions";

const USER = "019fa477-58e6-7ab9-ae4f-cc41716f6420";
const OTRO = "019fa477-0000-7000-8000-000000000002";
const TENANT = "tenant-1";

interface Fila {
  id: string;
  name: string;
  owner_id: string;
  tenant_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  plan: string;
  plan_status: string;
}

const PROPIA: Fila = {
  id: "biz-1",
  name: "Panadería",
  owner_id: USER,
  tenant_id: TENANT,
  stripe_customer_id: "cus_rosa",
  stripe_subscription_id: "sub_rosa",
  plan: "destacado",
  plan_status: "active",
};
const AJENA_MISMO_TENANT: Fila = {
  id: "biz-9",
  name: "Ferretería de otro",
  owner_id: OTRO,
  tenant_id: TENANT,
  stripe_customer_id: "cus_otro",
  stripe_subscription_id: "sub_otro",
  plan: "pro",
  plan_status: "active",
};
const PROPIA_OTRO_TENANT: Fila = {
  id: "biz-7",
  name: "Panadería en Houston",
  owner_id: USER,
  tenant_id: "tenant-houston",
  stripe_customer_id: "cus_rosa_houston",
  stripe_subscription_id: "sub_rosa_houston",
  plan: "pro",
  plan_status: "active",
};

function filtrante(filas: Fila[]) {
  const filtros: Array<[string, unknown]> = [];
  const builder = {
    select: () => builder,
    eq: (columna: string, valor: unknown) => {
      filtros.push([columna, valor]);
      return builder;
    },
    order: async () => ({
      data: filas.filter((fila) =>
        filtros.every(([columna, valor]) => fila[columna as keyof Fila] === valor),
      ),
      error: null,
    }),
  };
  return { from: () => builder, filtros };
}

function sesion(filas: Fila[]) {
  const supabase = filtrante(filas);
  mocks.requireTenantMatch.mockResolvedValue({
    ok: true,
    tenant: { id: TENANT, slug: "comunidadlatina" },
    user: { id: USER, email: "rosa@test.com" },
    supabase,
  });
  mocks.portalCreate.mockResolvedValue({ url: "https://billing.stripe.test/p_1" });
  return supabase;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.config.stripe = true;
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  mocks.getIdentidadActiva.mockResolvedValue({ tipo: "personal" });
});

describe("abrirPortalPresencia", () => {
  it("sin sesión no abre nada", async () => {
    mocks.requireTenantMatch.mockResolvedValue({
      ok: false,
      reason: "unauthenticated",
      message: "Iniciá sesión",
      user: null,
    });

    expect(await abrirPortalPresencia()).toEqual({ status: "sin_sesion" });
    expect(mocks.portalCreate).not.toHaveBeenCalled();
  });

  it("con la sesión de otra comunidad no abre nada", async () => {
    mocks.requireTenantMatch.mockResolvedValue({
      ok: false,
      reason: "tenant-mismatch",
      message: "Esta cuenta es de otra comunidad.",
      user: { id: USER },
    });

    expect(await abrirPortalPresencia()).toEqual({
      status: "error",
      message: "Esta cuenta es de otra comunidad.",
    });
    expect(mocks.portalCreate).not.toHaveBeenCalled();
  });

  it("caso feliz: abre el portal del customer propio y vuelve a /negocios/presencia", async () => {
    sesion([PROPIA, AJENA_MISMO_TENANT, PROPIA_OTRO_TENANT]);

    const result = await abrirPortalPresencia();

    expect(result).toEqual({ status: "redirect", url: "https://billing.stripe.test/p_1" });
    expect(mocks.portalCreate).toHaveBeenCalledTimes(1);
    const payload = mocks.portalCreate.mock.calls[0]?.[0] as {
      customer: string;
      return_url: string;
    };
    expect(payload.customer).toBe("cus_rosa");
    const base = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
    expect(payload.return_url).toBe(`${base}/negocios/presencia`);
  });

  it("el tenant sale del guard, no del cliente: filtra por dueño Y por comunidad", async () => {
    const supabase = sesion([PROPIA]);

    await abrirPortalPresencia();

    expect(supabase.filtros).toContainEqual(["owner_id", USER]);
    expect(supabase.filtros).toContainEqual(["tenant_id", TENANT]);
  });

  it("actuando como un negocio de OTRA persona no abre su facturación", async () => {
    sesion([PROPIA, AJENA_MISMO_TENANT]);
    mocks.getIdentidadActiva.mockResolvedValue({
      tipo: "negocio",
      negocio: { businessId: AJENA_MISMO_TENANT.id, nombre: "Ferretería", rol: "administrador" },
    });

    const result = await abrirPortalPresencia();

    expect(result).toMatchObject({ status: "error" });
    expect(mocks.portalCreate).not.toHaveBeenCalled();
  });

  it("con la cuenta propia en OTRA comunidad no abre nada desde ésta", async () => {
    sesion([PROPIA_OTRO_TENANT, AJENA_MISMO_TENANT]);

    const result = await abrirPortalPresencia();

    expect(result).toMatchObject({ status: "error" });
    expect(mocks.portalCreate).not.toHaveBeenCalled();
  });

  it("sin customer de Stripe todavía (nunca pagó) avisa en vez de fallar callado", async () => {
    sesion([
      {
        ...PROPIA,
        stripe_customer_id: null,
        stripe_subscription_id: null,
        plan: "none",
        plan_status: "inactive",
      },
    ]);

    const result = await abrirPortalPresencia();

    expect(result).toMatchObject({ status: "error" });
    expect((result as { message: string }).message.length).toBeGreaterThan(0);
    expect(mocks.portalCreate).not.toHaveBeenCalled();
  });

  it("con varios negocios y ninguno activo pide elegir, no adivina", async () => {
    sesion([PROPIA, { ...PROPIA, id: "biz-2", stripe_customer_id: "cus_rosa_2" }]);

    const result = await abrirPortalPresencia();

    expect(result).toMatchObject({ status: "error" });
    expect(mocks.portalCreate).not.toHaveBeenCalled();
  });

  it("Stripe sin configurar: estado degradado, sin tocar Stripe", async () => {
    mocks.config.stripe = false;
    sesion([PROPIA]);

    expect(await abrirPortalPresencia()).toEqual({ status: "no_configurado" });
    expect(mocks.portalCreate).not.toHaveBeenCalled();
  });

  it("si Stripe falla, la persona ve un mensaje y queda el log", async () => {
    sesion([PROPIA]);
    mocks.portalCreate.mockRejectedValue(new Error("No configuration provided"));

    const result = await abrirPortalPresencia();

    expect(result).toMatchObject({ status: "error" });
    expect(console.error).toHaveBeenCalled();
  });
});
