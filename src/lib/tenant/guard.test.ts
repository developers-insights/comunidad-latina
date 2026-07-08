import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tenant } from "./resolve";

const mocks = vi.hoisted(() => ({
  getTenant: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock("./resolve", () => ({ getTenant: mocks.getTenant }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));

import { getTenantMismatch, requireTenantMatch } from "./guard";

/* ------------------------------- Fixtures --------------------------------- */

const DOMINICANOS: Tenant = {
  id: "11111111-1111-4111-8111-111111111111",
  slug: "dominicanos",
  name: "Dominicanos",
  brandHex: "#1A5EDB",
  logoUrl: null,
  locale: "es-US",
  currency: "USD",
  modules: {},
  theme: null,
  isFallback: false,
};

const COMUNIDAD_LATINA_ROW = {
  id: "22222222-2222-4222-8222-222222222222",
  slug: "comunidadlatina",
  name: "Comunidad Latina",
};

function member(tenantId: string | null, role = "member") {
  return {
    id: "99999999-9999-4999-8999-999999999999",
    app_metadata: tenantId === null ? { role } : { tenant_id: tenantId, role },
  };
}

/** Mock del cliente Supabase: solo lo que `guard.ts` realmente toca. */
function stubSupabase(user: unknown, tenantRow: unknown = null) {
  const maybeSingle = vi.fn(async () => ({ data: tenantRow, error: null }));
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  const getUser = vi.fn(async () => ({ data: { user }, error: null }));
  return { client: { auth: { getUser }, from }, from, getUser };
}

function useSupabase(user: unknown, tenantRow: unknown = null) {
  const stub = stubSupabase(user, tenantRow);
  mocks.createClient.mockResolvedValue(stub.client);
  return stub;
}

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getTenant.mockResolvedValue(DOMINICANOS);
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
});

/* --------------------------- requireTenantMatch --------------------------- */

describe("requireTenantMatch", () => {
  it("deja pasar cuando el tenant del JWT coincide con el del request", async () => {
    useSupabase(member(DOMINICANOS.id));

    const guard = await requireTenantMatch();

    expect(guard.ok).toBe(true);
    if (!guard.ok) throw new Error("esperaba ok");
    expect(guard.tenant.slug).toBe("dominicanos");
    expect(guard.user.id).toBe("99999999-9999-4999-8999-999999999999");
  });

  it("devuelve 'unauthenticated' sin sesión, sin tocar la tabla tenants", async () => {
    const stub = useSupabase(null);

    const guard = await requireTenantMatch();

    expect(guard.ok).toBe(false);
    if (guard.ok) throw new Error("esperaba fallo");
    expect(guard.reason).toBe("unauthenticated");
    expect(guard.user).toBeNull();
    expect(stub.from).not.toHaveBeenCalled();
  });

  it("detecta la divergencia y nombra la comunidad real del usuario", async () => {
    const stub = useSupabase(member(COMUNIDAD_LATINA_ROW.id), COMUNIDAD_LATINA_ROW);

    const guard = await requireTenantMatch();

    expect(guard.ok).toBe(false);
    if (guard.ok || guard.reason !== "tenant-mismatch") throw new Error("esperaba mismatch");
    expect(guard.homeTenant).toEqual(COMUNIDAD_LATINA_ROW);
    expect(guard.message).toContain("Dominicanos");
    expect(guard.message).toContain("Comunidad Latina");
    expect(stub.from).toHaveBeenCalledWith("tenants");
  });

  it("degrada el copy sin inventar nombre si el tenant del JWT no se resuelve", async () => {
    useSupabase(member(COMUNIDAD_LATINA_ROW.id), null);

    const guard = await requireTenantMatch();

    if (guard.ok || guard.reason !== "tenant-mismatch") throw new Error("esperaba mismatch");
    expect(guard.homeTenant).toBeNull();
    expect(guard.message).toContain("otra comunidad");
  });

  it("trata una sesión sin claim de tenant como divergencia y no consulta tenants", async () => {
    const stub = useSupabase(member(null));

    const guard = await requireTenantMatch();

    if (guard.ok || guard.reason !== "tenant-mismatch") throw new Error("esperaba mismatch");
    expect(guard.homeTenant).toBeNull();
    // Sin claim no hay id que buscar: nada de queries de más.
    expect(stub.from).not.toHaveBeenCalled();
  });

  it("no exime al global_admin: el `?t=` del panel tampoco habilita escrituras", async () => {
    useSupabase(member(COMUNIDAD_LATINA_ROW.id, "global_admin"), COMUNIDAD_LATINA_ROW);

    const guard = await requireTenantMatch();

    expect(guard.ok).toBe(false);
    if (guard.ok) throw new Error("esperaba fallo");
    expect(guard.reason).toBe("tenant-mismatch");
  });

  // ---- Regresión: una caída de DB no es "estás en otra comunidad" ---------

  it("con el tenant en fallback devuelve 'tenant-unavailable', no divergencia", async () => {
    mocks.getTenant.mockResolvedValue({ ...DOMINICANOS, isFallback: true });
    const stub = useSupabase(member(COMUNIDAD_LATINA_ROW.id), COMUNIDAD_LATINA_ROW);

    const guard = await requireTenantMatch();

    if (guard.ok) throw new Error("esperaba fallo");
    expect(guard.reason).toBe("tenant-unavailable");
    // Copy de degradación elegante (§7), no una acusación falsa.
    expect(guard.message).toContain("no es tu culpa");
    expect(guard.message).not.toContain("comunidad");
    expect(stub.from).not.toHaveBeenCalled();
  });

  it("tampoco deja pasar una escritura cuando el id del fallback coincide de casualidad", async () => {
    mocks.getTenant.mockResolvedValue({ ...DOMINICANOS, isFallback: true });
    useSupabase(member(DOMINICANOS.id));

    const guard = await requireTenantMatch();

    expect(guard.ok).toBe(false);
    if (guard.ok) throw new Error("esperaba fallo");
    expect(guard.reason).toBe("tenant-unavailable");
  });

  it("loguea la divergencia sin PII: solo slugs y si había claim", async () => {
    useSupabase(member(COMUNIDAD_LATINA_ROW.id), COMUNIDAD_LATINA_ROW);

    await requireTenantMatch();

    expect(warn).toHaveBeenCalledTimes(1);
    const [, meta] = warn.mock.calls[0] as [string, Record<string, unknown>];
    expect(meta).toEqual({
      requestTenant: "dominicanos",
      homeTenant: "comunidadlatina",
      hasTenantClaim: true,
    });
    // Nada de ids de usuario ni emails en el log.
    expect(JSON.stringify(meta)).not.toContain("9999");
  });
});

/* ---------------------------- getTenantMismatch --------------------------- */

describe("getTenantMismatch", () => {
  it("no avisa nada cuando el tenant coincide", async () => {
    useSupabase(member(DOMINICANOS.id));
    await expect(getTenantMismatch()).resolves.toBeNull();
  });

  it("no avisa nada a un anónimo (la lectura pública es cross-tenant a propósito)", async () => {
    useSupabase(null);
    await expect(getTenantMismatch()).resolves.toBeNull();
  });

  it("no muestra el banner cuando el tenant está en fallback", async () => {
    mocks.getTenant.mockResolvedValue({ ...DOMINICANOS, isFallback: true });
    useSupabase(member(COMUNIDAD_LATINA_ROW.id), COMUNIDAD_LATINA_ROW);

    await expect(getTenantMismatch()).resolves.toBeNull();
  });

  it("devuelve la comunidad actual y la del usuario ante divergencia", async () => {
    useSupabase(member(COMUNIDAD_LATINA_ROW.id), COMUNIDAD_LATINA_ROW);

    const mismatch = await getTenantMismatch();

    expect(mismatch?.current.name).toBe("Dominicanos");
    expect(mismatch?.home?.slug).toBe("comunidadlatina");
  });
});
