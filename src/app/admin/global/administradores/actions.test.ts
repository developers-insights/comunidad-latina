import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests de la asignación de roles de staff.
 *
 * Esta es la action MÁS PELIGROSA del panel: usa el admin client (service role)
 * para escribir el claim que gobierna toda la RLS. Los tests están escritos
 * como intentos de abuso, no como "camino feliz + un par de errores":
 *
 *  · Un rol que no es global_admin no llega ni a instanciar el admin client.
 *  · Un `tenantId` de formulario no puede mover a nadie de comunidad — el
 *    tenant del destinatario sale SIEMPRE de la base.
 *  · Nadie se edita a sí mismo (un súper admin no puede degradarse por error).
 *  · Un `global_admin` existente no se toca desde esta pantalla.
 *  · No se puede otorgar `global_admin` (no está en el enum de zod).
 *
 * En todos los casos hostiles se verifica que `updateUserById` NO se haya
 * llamado: el mensaje de error es lo de menos, lo que importa es que el claim
 * quedó intacto.
 */

const mocks = vi.hoisted(() => ({
  getStaffContext: vi.fn(),
  logAdminAction: vi.fn(async () => true),
  revalidatePath: vi.fn(),
  updateUserById: vi.fn(
    async (_id: string, _attrs: unknown) =>
      ({ data: {}, error: null }) as { data: unknown; error: { message: string } | null },
  ),
  profileUpdate: vi.fn(
    async (_payload: unknown) => ({ error: null }) as { error: { message: string } | null },
  ),
}));

vi.mock("../../guard", () => ({
  getStaffContext: mocks.getStaffContext,
  logAdminAction: mocks.logAdminAction,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    auth: { admin: { updateUserById: mocks.updateUserById } },
    from: () => ({
      update: (payload: unknown) => {
        const chain = {
          eq: () => chain,
          then: (resolve: (value: unknown) => unknown) =>
            mocks.profileUpdate(payload).then(resolve),
        };
        return chain;
      },
    }),
  }),
}));

import { assignStaffRole, type StaffActionState } from "./actions";

const IDLE: StaffActionState = { status: "idle" };

const ACTOR_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TARGET_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";

function createSupabaseStub(profile: {
  id: string;
  tenant_id: string;
  display_name: string;
  role: string;
} | null) {
  const from = vi.fn(() => ({
    select: () => ({
      eq: () => ({ maybeSingle: async () => ({ data: profile, error: null }) }),
    }),
  }));
  return { client: { from } };
}

function useGlobalAdmin(stub: { client: unknown }) {
  mocks.getStaffContext.mockImplementation(async (min: string) => {
    if (min !== "global_admin") return null;
    return {
      supabase: stub.client,
      user: { id: ACTOR_ID },
      role: "global_admin",
      tenantId: TENANT_A,
    };
  });
}

function form(fields: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.set("profileId", TARGET_ID);
  fd.set("tenantId", TENANT_A);
  fd.set("role", "domain_admin");
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

const memberInTenantA = {
  id: TARGET_ID,
  tenant_id: TENANT_A,
  display_name: "Rosa Martínez",
  role: "member",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.updateUserById.mockResolvedValue({ data: {}, error: null });
  mocks.profileUpdate.mockResolvedValue({ error: null });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("assignStaffRole · autorización", () => {
  it("un domain_admin no puede nombrar administradores", async () => {
    mocks.getStaffContext.mockResolvedValue(null);

    const state = await assignStaffRole(IDLE, form());

    expect(state.status).toBe("error");
    expect(mocks.updateUserById).not.toHaveBeenCalled();
    expect(mocks.logAdminAction).not.toHaveBeenCalled();
  });

  it("no se puede otorgar global_admin: el rol no existe para esta pantalla", async () => {
    const stub = createSupabaseStub(memberInTenantA);
    useGlobalAdmin(stub);

    const state = await assignStaffRole(IDLE, form({ role: "global_admin" }));

    expect(state.status).toBe("invalid");
    expect(mocks.getStaffContext).not.toHaveBeenCalled();
    expect(mocks.updateUserById).not.toHaveBeenCalled();
  });

  it("nadie se cambia sus propios permisos", async () => {
    const stub = createSupabaseStub({ ...memberInTenantA, id: ACTOR_ID });
    useGlobalAdmin(stub);

    const state = await assignStaffRole(IDLE, form({ profileId: ACTOR_ID }));

    expect(state.status).toBe("error");
    expect(mocks.updateUserById).not.toHaveBeenCalled();
  });

  it("un global_admin existente no se toca desde acá", async () => {
    const stub = createSupabaseStub({ ...memberInTenantA, role: "global_admin" });
    useGlobalAdmin(stub);

    const state = await assignStaffRole(IDLE, form({ role: "member" }));

    expect(state.status).toBe("error");
    if (state.status !== "error") throw new Error("esperaba error");
    expect(state.message).toContain("equipo de la plataforma");
    expect(mocks.updateUserById).not.toHaveBeenCalled();
  });
});

describe("assignStaffRole · el tenant sale de la base, no del formulario", () => {
  it("no se puede promover a alguien de OTRA comunidad", async () => {
    // El ataque: mandar el profileId de una cuenta del tenant B junto al
    // tenantId del A. Si el tenant se tomara del form, la persona quedaría
    // administrando una comunidad que no es la suya —y con el claim cambiado.
    const stub = createSupabaseStub({ ...memberInTenantA, tenant_id: TENANT_B });
    useGlobalAdmin(stub);

    const state = await assignStaffRole(IDLE, form({ tenantId: TENANT_A }));

    expect(state.status).toBe("error");
    if (state.status !== "error") throw new Error("esperaba error");
    expect(state.message).toContain("otra comunidad");
    expect(mocks.updateUserById).not.toHaveBeenCalled();
  });

  it("el claim se escribe con el tenant de la BASE, no con el del formulario", async () => {
    const stub = createSupabaseStub(memberInTenantA);
    useGlobalAdmin(stub);

    await assignStaffRole(IDLE, form());

    expect(mocks.updateUserById).toHaveBeenCalledWith(TARGET_ID, {
      app_metadata: { tenant_id: TENANT_A, role: "domain_admin" },
    });
  });

  it("un perfil inexistente no se inventa", async () => {
    const stub = createSupabaseStub(null);
    useGlobalAdmin(stub);

    const state = await assignStaffRole(IDLE, form());

    expect(state.status).toBe("error");
    expect(mocks.updateUserById).not.toHaveBeenCalled();
  });
});

describe("assignStaffRole · camino feliz", () => {
  it("promueve, sincroniza profiles.role y audita el antes → después", async () => {
    const stub = createSupabaseStub(memberInTenantA);
    useGlobalAdmin(stub);

    const state = await assignStaffRole(IDLE, form());

    expect(state.status).toBe("success");
    if (state.status !== "success") throw new Error("esperaba éxito");
    expect(state.message).toContain("Rosa Martínez");
    expect(mocks.profileUpdate).toHaveBeenCalledWith({ role: "domain_admin" });
    expect(mocks.logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "staff.granted",
        tenantId: TENANT_A,
        subjectId: TARGET_ID,
        meta: { from: "member", to: "domain_admin" },
      }),
    );
  });

  it("quitar permisos se audita como revocación", async () => {
    const stub = createSupabaseStub({ ...memberInTenantA, role: "domain_admin" });
    useGlobalAdmin(stub);

    const state = await assignStaffRole(IDLE, form({ role: "member" }));

    expect(state.status).toBe("success");
    expect(mocks.logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "staff.revoked",
        meta: { from: "domain_admin", to: "member" },
      }),
    );
  });

  it("si Supabase Auth rechaza el cambio, no se audita un permiso que no existe", async () => {
    const stub = createSupabaseStub(memberInTenantA);
    useGlobalAdmin(stub);
    mocks.updateUserById.mockResolvedValue({
      data: {},
      error: { message: "auth caído" },
    });

    const state = await assignStaffRole(IDLE, form());

    expect(state.status).toBe("error");
    expect(mocks.profileUpdate).not.toHaveBeenCalled();
    expect(mocks.logAdminAction).not.toHaveBeenCalled();
  });
});
