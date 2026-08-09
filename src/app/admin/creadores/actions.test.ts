import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * =============================================================================
 * PERMISOS DE LOS UMBRALES DE CREADOR — verificados en el BACKEND
 * =============================================================================
 *
 * Estos umbrales deciden quién puede cobrar en la comunidad. Que el botón no se
 * dibuje para un `member` no prueba nada: una server action es un endpoint POST
 * al que cualquiera puede pegarle sin pasar por la UI (lo dice la propia guía de
 * Next). Lo que se fija acá:
 *
 *  1. Un `member` (o un `moderator`) no escribe, y ni siquiera se llega a armar
 *     la consulta.
 *  2. Un `domain_admin` NO puede escribir la configuración de otro tenant: el
 *     `tenant_id` sale del JWT y el formulario no puede sobreescribirlo, ni
 *     mandando el campo a mano.
 *  3. Un booleano ausente aborta el guardado entero en vez de apagar un
 *     requisito que nadie quiso apagar.
 */

const mocks = vi.hoisted(() => ({
  getStaffContext: vi.fn(),
  logAdminAction: vi.fn(async () => true),
  revalidatePath: vi.fn(),
}));

vi.mock("../guard", () => ({
  getStaffContext: mocks.getStaffContext,
  logAdminAction: mocks.logAdminAction,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { updateCreatorEligibilityConfig, type CreatorConfigActionState } from "./actions";
import { THRESHOLD_FIELDS, configToRow, DEFAULT_ELIGIBILITY_CONFIG } from "@/lib/creators/eligibility";

const MY_TENANT = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT = "99999999-9999-4999-8999-999999999999";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const IDLE: CreatorConfigActionState = { status: "idle" };

interface UpsertCall {
  payload: Record<string, unknown>;
}

function createSupabaseStub(options: { hardError?: boolean } = {}) {
  const upserts: UpsertCall[] = [];
  const from = vi.fn(() => ({
    upsert: vi.fn(async (payload: Record<string, unknown>) => {
      upserts.push({ payload });
      if (options.hardError) return { error: { code: "42501", message: "denied" } };
      return { error: null };
    }),
  }));
  return { client: { from }, upserts, from };
}

function useStaff(role = "domain_admin", tenantId: string | null = MY_TENANT, supabase: unknown = {}) {
  mocks.getStaffContext.mockImplementation(async (min: string) => {
    const rank: Record<string, number> = { moderator: 1, domain_admin: 2, global_admin: 3 };
    if ((rank[role] ?? 0) < rank[min]) return null;
    return { supabase, user: { id: USER_ID }, role, tenantId };
  });
}

/** FormData completo y válido, sobre el que cada test hace su travesura. */
function configForm(over: Record<string, string> = {}): FormData {
  const row = configToRow(DEFAULT_ELIGIBILITY_CONFIG);
  const fd = new FormData();
  for (const field of THRESHOLD_FIELDS) {
    const value: number | boolean = row[field.column];
    fd.set(field.column, typeof value === "boolean" ? (value ? "si" : "no") : String(value));
  }
  for (const [key, value] of Object.entries(over)) fd.set(key, value);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("updateCreatorEligibilityConfig — quién puede escribir", () => {
  it("un member no escribe nada (getStaffContext devuelve null)", async () => {
    mocks.getStaffContext.mockResolvedValue(null);
    const stub = createSupabaseStub();

    const state = await updateCreatorEligibilityConfig(IDLE, configForm());

    expect(state.status).toBe("error");
    expect(stub.from).not.toHaveBeenCalled();
    expect(mocks.logAdminAction).not.toHaveBeenCalled();
  });

  it("un moderator tampoco: el rango exigido es domain_admin", async () => {
    const stub = createSupabaseStub();
    useStaff("moderator", MY_TENANT, stub.client);

    const state = await updateCreatorEligibilityConfig(IDLE, configForm());

    expect(state.status).toBe("error");
    expect(stub.upserts).toHaveLength(0);
  });

  it("sin tenant en el JWT no se escribe (nunca 'todas las comunidades')", async () => {
    const stub = createSupabaseStub();
    useStaff("domain_admin", null, stub.client);

    const state = await updateCreatorEligibilityConfig(IDLE, configForm());

    expect(state.status).toBe("error");
    expect(stub.upserts).toHaveLength(0);
  });

  it("un domain_admin guarda los umbrales de SU comunidad", async () => {
    const stub = createSupabaseStub();
    useStaff("domain_admin", MY_TENANT, stub.client);

    const state = await updateCreatorEligibilityConfig(IDLE, configForm({ min_followers: "500" }));

    expect(state.status).toBe("success");
    expect(stub.upserts).toHaveLength(1);
    expect(stub.upserts[0].payload).toMatchObject({
      tenant_id: MY_TENANT,
      min_followers: 500,
      updated_by: USER_ID,
    });
  });
});

describe("updateCreatorEligibilityConfig — aislamiento entre comunidades", () => {
  it("un tenant_id inyectado en el formulario NO se usa: manda el del JWT", async () => {
    const stub = createSupabaseStub();
    useStaff("domain_admin", MY_TENANT, stub.client);

    const fd = configForm();
    fd.set("tenant_id", OTHER_TENANT);
    fd.set("tenantId", OTHER_TENANT);

    const state = await updateCreatorEligibilityConfig(IDLE, fd);

    expect(state.status).toBe("success");
    expect(stub.upserts[0].payload.tenant_id).toBe(MY_TENANT);
    expect(mocks.logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: MY_TENANT }),
    );
  });

  it("una columna que el panel no administra no viaja al upsert", async () => {
    const stub = createSupabaseStub();
    useStaff("domain_admin", MY_TENANT, stub.client);

    const fd = configForm();
    fd.set("updated_by", "44444444-4444-4444-8444-444444444444");
    fd.set("columna_inventada", "1");

    await updateCreatorEligibilityConfig(IDLE, fd);

    const payload = stub.upserts[0].payload;
    expect(payload.updated_by).toBe(USER_ID);
    expect(payload).not.toHaveProperty("columna_inventada");
  });
});

describe("updateCreatorEligibilityConfig — validación", () => {
  it("un número fuera del rango del CHECK se rechaza acá, no con un 23514 crudo", async () => {
    const stub = createSupabaseStub();
    useStaff("domain_admin", MY_TENANT, stub.client);

    const outOfRange: Record<string, string>[] = [
      { min_age: "8" },
      { min_age: "120" },
      { min_user_score: "101" },
      { min_followers: "-5" },
    ];
    for (const bad of outOfRange) {
      const state = await updateCreatorEligibilityConfig(IDLE, configForm(bad));
      expect(state.status, JSON.stringify(bad)).toBe("error");
    }
    expect(stub.upserts).toHaveLength(0);
  });

  it("un booleano ausente aborta el guardado entero", async () => {
    // Con checkbox, "no tildado" viaja como campo ausente — indistinguible de
    // un campo que se perdió. Ahí un guardado a medias APAGARÍA requisitos que
    // nadie quiso apagar. Por eso la ausencia es un error, no un `false`.
    const stub = createSupabaseStub();
    useStaff("domain_admin", MY_TENANT, stub.client);

    const fd = configForm();
    fd.delete("require_identity_verified");

    const state = await updateCreatorEligibilityConfig(IDLE, fd);

    expect(state.status).toBe("error");
    expect(stub.upserts).toHaveLength(0);
  });

  it("un valor de toggle inventado tampoco pasa", async () => {
    const stub = createSupabaseStub();
    useStaff("domain_admin", MY_TENANT, stub.client);

    const state = await updateCreatorEligibilityConfig(
      IDLE,
      configForm({ require_identity_verified: "quizás" }),
    );

    expect(state.status).toBe("error");
    expect(stub.upserts).toHaveLength(0);
  });
});

describe("updateCreatorEligibilityConfig — efectos", () => {
  it("un rechazo de la RLS no se disfraza de éxito ni se audita", async () => {
    const stub = createSupabaseStub({ hardError: true });
    useStaff("domain_admin", MY_TENANT, stub.client);

    const state = await updateCreatorEligibilityConfig(IDLE, configForm());

    expect(state.status).toBe("error");
    expect(mocks.logAdminAction).not.toHaveBeenCalled();
  });

  it("audita el cambio con los valores exactos e invalida la pantalla del aspirante", async () => {
    const stub = createSupabaseStub();
    useStaff("domain_admin", MY_TENANT, stub.client);

    await updateCreatorEligibilityConfig(IDLE, configForm({ min_followers: "500" }));

    expect(mocks.logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: USER_ID,
        action: "creator_eligibility.updated",
        tenantId: MY_TENANT,
        meta: expect.objectContaining({ min_followers: 500 }),
      }),
    );
    // Sin esto, la solicitud del creador seguiría mostrando los umbrales viejos
    // como si estuvieran vigentes.
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/creadores/solicitud");
  });
});
