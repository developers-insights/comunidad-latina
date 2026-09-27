import { beforeEach, describe, expect, it, vi } from "vitest";

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
vi.mock("@/lib/stripe", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/stripe")>()),
  getStripe: () => ({
    checkout: { sessions: { create: mocks.sessionsCreate, expire: mocks.sessionsExpire } },
  }),
}));

import { BOOST_PACKAGES, boostMontoCentavos } from "@/lib/stripe";
import { crearImpulsoDePerfilCheckout } from "./actions";

const USER = "019fa477-58e6-7ab9-ae4f-cc41716f6420";
const TENANT = "tenant-1";

type Fila = Record<string, unknown>;

/** Builder encadenable: cualquier filtro devuelve el mismo objeto y se resuelve con `result`. */
function chain(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "eq", "neq", "gt", "in", "order", "limit"]) {
    builder[m] = () => builder;
  }
  builder.maybeSingle = async () => result;
  builder.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return builder;
}

function userSupabase(options: {
  perfil?: Fila | null;
  vigentes?: Fila[];
  precios?: Fila[];
}) {
  return {
    rpc: async () => ({ data: [], error: null }),
    from(table: string) {
      if (table === "tenant_prices") return chain({ data: options.precios ?? [], error: null });
      if (table === "creator_profiles") {
        return chain({ data: options.perfil === undefined ? null : options.perfil, error: null });
      }
      if (table === "creator_profile_boosts") {
        return chain({ data: options.vigentes ?? [], error: null });
      }
      throw new Error(`tabla inesperada ${table}`);
    },
  };
}

function adminSpy(captured: {
  insert: Fila | null;
  updates: Fila[];
  linkError?: unknown;
}) {
  return {
    from: () => ({
      insert(values: Fila) {
        captured.insert = values;
        return {
          select: () => ({ single: async () => ({ data: { id: "cpb-1" }, error: null }) }),
        };
      },
      update(values: Fila) {
        captured.updates.push(values);
        const esVinculo = "stripe_checkout_session_id" in values;
        return { eq: async () => ({ error: esVinculo ? (captured.linkError ?? null) : null }) };
      },
    }),
    rpc: async () => ({ data: [], error: null }),
  };
}

const APROBADO = { profile_id: USER, tenant_id: TENANT, status: "approved" };

function escenario(options: {
  perfil?: Fila | null;
  vigentes?: Fila[];
  precios?: Fila[];
  linkError?: unknown;
  guard?: unknown;
}) {
  const captured: { insert: Fila | null; updates: Fila[]; linkError?: unknown } = {
    insert: null,
    updates: [],
    linkError: options.linkError,
  };
  const supabase = userSupabase(options);
  mocks.getTenant.mockResolvedValue({ id: TENANT, slug: "dominicanos" });
  mocks.requireTenantMatch.mockResolvedValue(
    options.guard ?? {
      ok: true,
      tenant: { id: TENANT, slug: "dominicanos" },
      user: { id: USER, email: "yari@test.com" },
      supabase,
    },
  );
  mocks.createAdminClient.mockReturnValue(adminSpy(captured));
  mocks.sessionsCreate.mockResolvedValue({ id: "cs_1", url: "https://stripe.test/cs_1" });
  return captured;
}

function precio(variant: string, amount: number) {
  return {
    id: `p-${variant}`,
    product: "boost",
    variant,
    billing_interval: "unico",
    amount_cents: amount,
    currency: "USD",
    active: true,
    updated_at: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.limit.mockReturnValue({ ok: true });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});

describe("crearImpulsoDePerfilCheckout", () => {
  it("un paquete inválido no toca nada", async () => {
    escenario({ perfil: APROBADO });
    const result = await crearImpulsoDePerfilCheckout({ paquete: "90d" });
    expect(result.status).toBe("error");
    expect(mocks.sessionsCreate).not.toHaveBeenCalled();
  });

  it("sin sesión pide entrar", async () => {
    escenario({ guard: { ok: false, reason: "unauthenticated", message: "x" } });
    const result = await crearImpulsoDePerfilCheckout({ paquete: "7d" });
    expect(result).toEqual({ status: "sin_sesion" });
  });

  it("quien no es creador aprobado no puede pagar", async () => {
    const captured = escenario({ perfil: { ...APROBADO, status: "platform_review_pending" } });
    const result = await crearImpulsoDePerfilCheckout({ paquete: "7d" });
    expect(result.status).toBe("error");
    expect(captured.insert).toBeNull();
    expect(mocks.sessionsCreate).not.toHaveBeenCalled();
  });

  it("sin perfil de creador tampoco", async () => {
    const captured = escenario({ perfil: null });
    const result = await crearImpulsoDePerfilCheckout({ paquete: "7d" });
    expect(result.status).toBe("error");
    expect(captured.insert).toBeNull();
  });

  it("un perfil de otra comunidad no cuenta", async () => {
    const captured = escenario({ perfil: { ...APROBADO, tenant_id: "otra" } });
    const result = await crearImpulsoDePerfilCheckout({ paquete: "7d" });
    expect(result.status).toBe("error");
    expect(captured.insert).toBeNull();
  });

  it("con un impulso vigente no se vende otro encima", async () => {
    const captured = escenario({
      perfil: APROBADO,
      vigentes: [{ status: "active", ends_at: "2999-01-01T00:00:00.000Z" }],
    });
    const result = await crearImpulsoDePerfilCheckout({ paquete: "7d" });
    expect(result.status).toBe("error");
    expect(captured.insert).toBeNull();
  });

  it("el cupo por hora frena antes de tocar la base", async () => {
    const captured = escenario({ perfil: APROBADO });
    mocks.limit.mockReturnValue({ ok: false });
    const result = await crearImpulsoDePerfilCheckout({ paquete: "7d" });
    expect(result.status).toBe("error");
    expect(captured.insert).toBeNull();
  });

  it("cobra el precio del impulso de aviso de la comunidad y guarda el mismo número", async () => {
    const captured = escenario({ perfil: APROBADO, precios: [precio("14d", 1900)] });
    const result = await crearImpulsoDePerfilCheckout({ paquete: "14d" });

    expect(result).toEqual({ status: "redirect", url: "https://stripe.test/cs_1" });
    expect(captured.insert).toMatchObject({
      tenant_id: TENANT,
      creator_id: USER,
      package: "14d",
      duration_days: 14,
      amount_cents: 1900,
      currency: "usd",
      status: "pending_payment",
    });
    const args = mocks.sessionsCreate.mock.calls[0][0];
    expect(args.line_items[0].price_data).toMatchObject({ currency: "usd", unit_amount: 1900 });
    expect(args.metadata).toMatchObject({ creator_profile_boost_id: "cpb-1", tenant_id: TENANT });
    expect(args.success_url).toContain("/impulsar/perfil-creador?estado=exito");
    expect(captured.updates).toContainEqual({ stripe_checkout_session_id: "cs_1" });
  });

  it("sin fila de precio cobra la constante del impulso de siempre", async () => {
    const captured = escenario({ perfil: APROBADO, precios: [] });
    await crearImpulsoDePerfilCheckout({ paquete: "7d" });
    expect(captured.insert?.amount_cents).toBe(boostMontoCentavos(BOOST_PACKAGES["7d"]));
  });

  it("si no se pudo vincular la sesión, la expira y cancela el impulso", async () => {
    const captured = escenario({ perfil: APROBADO, linkError: { code: "XX000" } });
    const result = await crearImpulsoDePerfilCheckout({ paquete: "7d" });
    expect(result.status).toBe("error");
    expect(mocks.sessionsExpire).toHaveBeenCalledWith("cs_1");
    expect(captured.updates).toContainEqual({ status: "canceled" });
  });
});
