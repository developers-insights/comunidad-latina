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

import {
  resolveScamReport,
  updateTenantModules,
  type DomainActionState,
} from "./actions";
import { toModuleColumns } from "./modules";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const IDLE: DomainActionState = { status: "idle" };
const REPORT_ID = "33333333-3333-4333-8333-333333333333";
const MESSAGE_ID = "44444444-4444-4444-8444-444444444444";
const LISTING_ID = "55555555-5555-4555-8555-555555555555";

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
  "comunidad",
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
    // Las 10 claves canónicas viajan siempre: nada queda en estado ambiguo.
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

/* ------------- updateTenantModules · selector de comunidad (0060+) ---------- */

/**
 * Desde que el panel tiene selector de comunidad, el formulario puede traer un
 * `tenantId`. Es dato del cliente: estos tests fijan que sea una PROPUESTA que
 * `canWriteTenant` acepta o rechaza, y nunca una orden.
 */
describe("updateTenantModules · comunidad del formulario", () => {
  const OTHER_TENANT = "44444444-4444-4444-8444-444444444444";

  function modulesFormFor(tenantId: string): FormData {
    const fd = modulesForm({ feed: "on" });
    fd.set("tenantId", tenantId);
    return fd;
  }

  it("un domain_admin que manda OTRO tenant es rechazado, no redirigido al suyo", async () => {
    useStaff("domain_admin", TENANT_ID);
    mocks.createAdminClient.mockReturnValue(createAdminStub().client);

    const state = await updateTenantModules(IDLE, modulesFormFor(OTHER_TENANT));

    expect(state.status).toBe("error");
    // Lo importante: no se escribió NADA. Ni en el tenant ajeno ni en el propio
    // — un fallback silencioso ejecutaría una acción distinta de la pedida.
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.logAdminAction).not.toHaveBeenCalled();
  });

  it("un domain_admin que manda su propio tenant sí guarda", async () => {
    useStaff("domain_admin", TENANT_ID);
    mocks.createAdminClient.mockReturnValue(createAdminStub().client);

    const state = await updateTenantModules(IDLE, modulesFormFor(TENANT_ID));

    expect(state.status).toBe("success");
    expect(mocks.logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_ID }),
    );
  });

  it("un global_admin sí puede guardar los módulos de otra comunidad", async () => {
    useStaff("global_admin", TENANT_ID);
    const admin = createAdminStub();
    mocks.createAdminClient.mockReturnValue(admin.client);

    const state = await updateTenantModules(IDLE, modulesFormFor(OTHER_TENANT));

    expect(state.status).toBe("success");
    expect(mocks.logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "tenant.modules_updated",
        tenantId: OTHER_TENANT,
        subjectId: OTHER_TENANT,
      }),
    );
  });

  it("un `tenantId` con basura no escribe nada, ni siquiera en la comunidad propia", async () => {
    useStaff("global_admin", TENANT_ID);
    mocks.createAdminClient.mockReturnValue(createAdminStub().client);

    const fd = modulesForm({ feed: "on" });
    fd.set("tenantId", "todas");

    const state = await updateTenantModules(IDLE, fd);

    // `canWriteTenant` exige forma de uuid, así que "todas" no llega nunca a un
    // `.eq('id', …)`: la action rechaza en vez de escribir a ciegas.
    expect(state.status).toBe("error");
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });
});

/* --------------------- Resolver un reporte (H-2, 0135) -------------------- */

/**
 * Un reporte sobre un MENSAJE DE GRUPO no tenía ninguna acción posible: el
 * `if` de `resolveScamReport` sólo actuaba sobre `listing`, así que "Confirmar"
 * cerraba la fila del reporte y el mensaje seguía ahí. El botón promete
 * «Confirmar baja el contenido reportado» y para el contenido más difícil de
 * moderar era mentira.
 *
 * Estos tests fijan las dos mitades: que se baje cuando corresponde, y que
 * NO se toque nada cuando el reporte se descarta.
 */
type ReporteStub = {
  target_kind: string;
  target_id: string;
};

interface Escrito {
  tabla: string;
  payload: Record<string, unknown>;
}

/** Cliente del staff: resuelve el reporte y anota todo lo que se escribe. */
function staffSupabase(report: ReporteStub) {
  const escrituras: Escrito[] = [];
  const from = vi.fn((tabla: string) => {
    const builder: Record<string, unknown> = {};
    builder.update = vi.fn((payload: Record<string, unknown>) => {
      escrituras.push({ tabla, payload });
      return builder;
    });
    builder.eq = vi.fn(() => builder);
    builder.in = vi.fn(() => builder);
    builder.select = vi.fn(() => builder);
    builder.maybeSingle = vi.fn(async () => ({
      data:
        tabla === "scam_reports"
          ? { id: REPORT_ID, tenant_id: TENANT_ID, ...report }
          : null,
      error: null,
    }));
    // El `update(...).eq(...)` de las tablas objetivo se resuelve con el await.
    (builder as { then?: unknown }).then = (
      resolve: (v: { error: null }) => unknown,
      reject: (e: unknown) => unknown,
    ) => Promise.resolve({ error: null }).then(resolve, reject);
    return builder;
  });
  return { client: { from }, escrituras };
}

function reportForm(decision: "upheld" | "dismissed"): FormData {
  const fd = new FormData();
  fd.set("reportId", REPORT_ID);
  fd.set("decision", decision);
  return fd;
}

describe("resolveScamReport sobre un mensaje de grupo", () => {
  beforeEach(() => {
    useStaff("domain_admin");
  });

  it("confirmar el reporte BAJA el mensaje, en suave", async () => {
    const staff = staffSupabase({
      target_kind: "group_message",
      target_id: MESSAGE_ID,
    });
    mocks.getStaffContext.mockResolvedValue({
      supabase: staff.client,
      user: { id: USER_ID },
      role: "domain_admin",
      tenantId: TENANT_ID,
    });

    const state = await resolveScamReport(IDLE, reportForm("upheld"));
    expect(state.status).toBe("success");

    const bajada = staff.escrituras.find((e) => e.tabla === "chat_group_messages");
    expect(bajada).toBeDefined();
    // Borrado SUAVE: la fila sobrevive hasta la purga de 90 días, que es lo que
    // le permite a la moderación ver después qué se bajó. El DELETE físico que
    // la 0133 también le da al staff queda como opción nuclear.
    expect(Object.keys(bajada?.payload ?? {})).toEqual(["deleted_at"]);
    expect(typeof bajada?.payload.deleted_at).toBe("string");
  });

  it("descartar el reporte no toca el mensaje", async () => {
    const staff = staffSupabase({
      target_kind: "group_message",
      target_id: MESSAGE_ID,
    });
    mocks.getStaffContext.mockResolvedValue({
      supabase: staff.client,
      user: { id: USER_ID },
      role: "domain_admin",
      tenantId: TENANT_ID,
    });

    const state = await resolveScamReport(IDLE, reportForm("dismissed"));
    expect(state.status).toBe("success");
    expect(staff.escrituras.some((e) => e.tabla === "chat_group_messages")).toBe(false);
  });

  it("un reporte sobre un aviso sigue bajando el aviso y nada más", async () => {
    const staff = staffSupabase({ target_kind: "listing", target_id: LISTING_ID });
    mocks.getStaffContext.mockResolvedValue({
      supabase: staff.client,
      user: { id: USER_ID },
      role: "domain_admin",
      tenantId: TENANT_ID,
    });

    await resolveScamReport(IDLE, reportForm("upheld"));

    expect(staff.escrituras.some((e) => e.tabla === "listings")).toBe(true);
    expect(staff.escrituras.some((e) => e.tabla === "chat_group_messages")).toBe(false);
  });

  it("un reporte de mensaje DIRECTO no se toca: esos no los lee nadie (§5.4)", async () => {
    const staff = staffSupabase({ target_kind: "message", target_id: MESSAGE_ID });
    mocks.getStaffContext.mockResolvedValue({
      supabase: staff.client,
      user: { id: USER_ID },
      role: "domain_admin",
      tenantId: TENANT_ID,
    });

    await resolveScamReport(IDLE, reportForm("upheld"));

    expect(staff.escrituras.some((e) => e.tabla === "chat_group_messages")).toBe(false);
    expect(staff.escrituras.some((e) => e.tabla === "messages")).toBe(false);
  });
});
