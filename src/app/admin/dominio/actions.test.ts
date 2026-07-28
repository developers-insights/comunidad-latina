import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests de `updateTenantModules` — el tercer estado "Muy pronto" (feedback 27/7).
 *
 * Lo que fijan:
 *  1. AUTORIZACIÓN — un `moderator` no cambia módulos, y ni siquiera se
 *     construye el admin client.
 *  2. EL CONTRATO DE LAS DOS COLUMNAS — `modules` sigue siendo Record<string,
 *     boolean> con la misma forma de siempre; `modules_soon` es su hermana.
 *  3. LA COMBINACIÓN IMPOSIBLE — nunca sale `enabled && soon` de esta action.
 *  4. EL MERGE SIMÉTRICO — las dos columnas se leen y se mergean igual, así una
 *     clave que este panel no administra no queda con on/off en una y sin su
 *     "muy pronto" en la otra.
 */

const mocks = vi.hoisted(() => ({
  getStaffContext: vi.fn(),
  logAdminAction: vi.fn(async () => {}),
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  createAdminClient: vi.fn(),
}));

vi.mock("../guard", () => ({
  getStaffContext: mocks.getStaffContext,
  logAdminAction: mocks.logAdminAction,
}));
vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
  revalidateTag: mocks.revalidateTag,
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));

import { updateTenantModules, type DomainActionState } from "./actions";
import { toModuleColumns } from "./modules";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const IDLE: DomainActionState = { status: "idle" };

const ALL_KEYS = [
  "feed",
  "propiedades",
  "negocios",
  "profesionales",
  "eventos",
  "empleos",
  "mensajes",
  "marketplace",
  "creadores",
  "videos",
] as const;

interface UpdateCall {
  payload: Record<string, unknown>;
}

/**
 * Admin client stub. `existingModules` / `existingModulesSoon` son lo que ya hay
 * guardado (la action lee las dos columnas para no pisar claves que no
 * administra).
 */
function createAdminStub(
  options: {
    hardError?: boolean;
    existingModules?: Record<string, boolean> | null;
    existingModulesSoon?: Record<string, boolean> | null;
  } = {},
) {
  const updates: UpdateCall[] = [];
  const from = vi.fn(() => ({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        maybeSingle: vi.fn(async () => ({
          data: {
            modules: options.existingModules === undefined ? {} : options.existingModules,
            modules_soon:
              options.existingModulesSoon === undefined ? {} : options.existingModulesSoon,
          },
          error: null,
        })),
      })),
    })),
    update: vi.fn((payload: Record<string, unknown>) => {
      updates.push({ payload });
      return {
        eq: vi.fn(async () => {
          if (options.hardError) return { error: { code: "42501", message: "denied" } };
          return { error: null };
        }),
      };
    }),
  }));
  return { client: { from }, updates };
}

function useStaff(role = "domain_admin", tenantId: string | null = TENANT_ID) {
  mocks.getStaffContext.mockImplementation(async (min: string) => {
    const rank: Record<string, number> = { moderator: 1, domain_admin: 2, global_admin: 3 };
    if (rank[role] < rank[min]) return null;
    return { supabase: {}, user: { id: USER_ID }, role, tenantId };
  });
}

/** FormData con un estado por módulo; lo que no se pasa queda en "off". */
function modulesForm(states: Partial<Record<(typeof ALL_KEYS)[number], string>>): FormData {
  const fd = new FormData();
  for (const key of ALL_KEYS) fd.set(`module:${key}`, states[key] ?? "off");
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

/* ------------------------------ toModuleColumns ---------------------------- */

describe("toModuleColumns", () => {
  it("traduce los tres estados a las dos columnas", () => {
    expect(toModuleColumns({ feed: "on", marketplace: "soon", creadores: "off" })).toEqual({
      modules: { feed: true, marketplace: false, creadores: false },
      modulesSoon: { feed: false, marketplace: true, creadores: false },
    });
  });

  it("NUNCA produce enabled && soon a la vez", () => {
    const { modules, modulesSoon } = toModuleColumns({
      feed: "on",
      negocios: "soon",
      eventos: "off",
    });
    for (const key of Object.keys(modules)) {
      expect(modules[key] && modulesSoon[key]).toBe(false);
    }
  });

  it("`modules` sigue siendo Record<string, boolean> — no cambia de forma", () => {
    const { modules } = toModuleColumns({ feed: "soon" });
    expect(typeof modules.feed).toBe("boolean");
  });
});

/* --------------------------- updateTenantModules --------------------------- */

describe("updateTenantModules", () => {
  it("un moderator no cambia módulos y ni siquiera arma el admin client", async () => {
    useStaff("moderator");

    const state = await updateTenantModules(IDLE, modulesForm({ feed: "on" }));

    expect(state.status).toBe("error");
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.logAdminAction).not.toHaveBeenCalled();
  });

  it("sin tenant en el JWT no se escribe nada (nunca 'todos los tenants')", async () => {
    useStaff("domain_admin", null);

    const state = await updateTenantModules(IDLE, modulesForm({ feed: "on" }));

    expect(state.status).toBe("error");
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("guarda las dos columnas y solo para el tenant del propio JWT", async () => {
    useStaff();
    const admin = createAdminStub();
    mocks.createAdminClient.mockReturnValue(admin.client);

    const state = await updateTenantModules(
      IDLE,
      modulesForm({ feed: "on", marketplace: "soon", creadores: "off" }),
    );

    expect(state.status).toBe("success");
    expect(admin.updates).toHaveLength(1);
    const payload = admin.updates[0].payload as {
      modules: Record<string, boolean>;
      modules_soon: Record<string, boolean>;
    };
    expect(payload.modules.feed).toBe(true);
    expect(payload.modules.marketplace).toBe(false);
    expect(payload.modules_soon.marketplace).toBe(true);
    expect(payload.modules_soon.creadores).toBe(false);
    // Las 9 claves canónicas viajan siempre: nada queda en estado ambiguo.
    expect(Object.keys(payload.modules).sort()).toEqual([...ALL_KEYS].sort());
    expect(Object.keys(payload.modules_soon).sort()).toEqual([...ALL_KEYS].sort());
  });

  it("un valor inventado cae a 'off' — jamás prende una sección sola", async () => {
    useStaff();
    const admin = createAdminStub();
    mocks.createAdminClient.mockReturnValue(admin.client);

    const fd = modulesForm({});
    fd.set("module:negocios", "activo-siempre");

    await updateTenantModules(IDLE, fd);

    const payload = admin.updates[0].payload as {
      modules: Record<string, boolean>;
      modules_soon: Record<string, boolean>;
    };
    expect(payload.modules.negocios).toBe(false);
    expect(payload.modules_soon.negocios).toBe(false);
  });

  it("no borra claves de módulos que esta pantalla no administra", async () => {
    useStaff();
    // Una sección futura que todavía no está en MODULE_KEYS: un UPDATE que
    // reemplaza el jsonb entero la borraría —y borrarla la deja apagada— en
    // cada guardado, sin que nadie lo haya pedido.
    const admin = createAdminStub({
      existingModules: { seccion_futura: true, feed: false },
    });
    mocks.createAdminClient.mockReturnValue(admin.client);

    await updateTenantModules(IDLE, modulesForm({ feed: "on" }));

    const payload = admin.updates[0].payload as { modules: Record<string, boolean> };
    expect(payload.modules.seccion_futura).toBe(true);
    // Y lo que sí administra, lo pisa.
    expect(payload.modules.feed).toBe(true);
  });

  it("una clave de módulo inventada por el cliente se ignora", async () => {
    useStaff();
    const admin = createAdminStub();
    mocks.createAdminClient.mockReturnValue(admin.client);

    const fd = modulesForm({ feed: "on" });
    fd.set("module:superadmin", "on");

    await updateTenantModules(IDLE, fd);

    const payload = admin.updates[0].payload as { modules: Record<string, boolean> };
    expect(payload.modules).not.toHaveProperty("superadmin");
  });

  it("las DOS columnas se mergean igual — ninguna clave ajena queda a medias", async () => {
    useStaff();
    // Una sección que este panel no administra, con estado en las dos columnas.
    // Si `modules` se mergeara y `modules_soon` se reemplazara entero (como
    // pasaba antes), quedaría prendida en una columna y sin rastro en la otra:
    // un estado que nadie eligió.
    const admin = createAdminStub({
      existingModules: { seccion_futura: false },
      existingModulesSoon: { seccion_futura: true },
    });
    mocks.createAdminClient.mockReturnValue(admin.client);

    await updateTenantModules(IDLE, modulesForm({ feed: "on" }));

    const payload = admin.updates[0].payload as {
      modules: Record<string, boolean>;
      modules_soon: Record<string, boolean>;
    };
    expect(payload.modules.seccion_futura).toBe(false);
    expect(payload.modules_soon.seccion_futura).toBe(true);
    // Y lo canónico sigue pisando lo suyo en las dos.
    expect(payload.modules.feed).toBe(true);
    expect(payload.modules_soon.feed).toBe(false);
  });

  it("un error real de la DB no se disfraza de éxito", async () => {
    useStaff();
    const admin = createAdminStub({ hardError: true });
    mocks.createAdminClient.mockReturnValue(admin.client);

    const state = await updateTenantModules(IDLE, modulesForm({ feed: "on" }));

    expect(state.status).toBe("error");
    expect(mocks.logAdminAction).not.toHaveBeenCalled();
  });

  it("audita el cambio e invalida la caché del tenant", async () => {
    useStaff();
    mocks.createAdminClient.mockReturnValue(createAdminStub().client);

    await updateTenantModules(IDLE, modulesForm({ feed: "on", negocios: "soon" }));

    expect(mocks.logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: USER_ID,
        action: "tenant.modules_updated",
        tenantId: TENANT_ID,
      }),
    );
    // Sin esto el menú tardaría hasta 300s en reflejar el cambio.
    expect(mocks.revalidateTag).toHaveBeenCalledWith("tenants", "max");
  });
});
