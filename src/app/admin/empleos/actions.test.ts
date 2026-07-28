import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests de la server action del panel de Empleos.
 *
 * Lo que fijan, en orden de importancia:
 *  1. AUTORIZACIÓN POR ROL — un `moderator` no puede resolver postulaciones, y
 *     el rechazo pasa ANTES de tocar la DB.
 *  2. BARRERA DE PRIVACIDAD — sobre un aviso de un miembro no se resuelve nada,
 *     aunque el cliente mande el submit igual (el botón puede no existir; la
 *     autorización no vive en el botón).
 *  3. AUDITORÍA — cada resolución queda en audit_log a nombre de quien la hizo,
 *     con ids y NADA de contenido.
 *  4. La transición sigue siendo monótona (solo desde 'submitted').
 *  5. El aviso al postulante dice que respondió el equipo de la comunidad —
 *     el staff no se hace pasar por el empleador.
 */

const mocks = vi.hoisted(() => ({
  getStaffContext: vi.fn(),
  logAdminAction: vi.fn(async () => {}),
  revalidatePath: vi.fn(),
  createAdminClient: vi.fn(() => ({ admin: true })),
  createNotification: vi.fn(async () => ({ ok: true })),
}));

vi.mock("../guard", () => ({
  getStaffContext: mocks.getStaffContext,
  logAdminAction: mocks.logAdminAction,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/notifications/notify", () => ({ createNotification: mocks.createNotification }));

import { resolveJobApplication, type JobsActionState } from "./actions";

/* -------------------------------- Fixtures -------------------------------- */

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const STAFF_ID = "22222222-2222-4222-8222-222222222222";
const MEMBER_ID = "33333333-3333-4333-8333-333333333333";
const APPLICANT_ID = "44444444-4444-4444-8444-444444444444";
const JOB_ID = "55555555-5555-4555-8555-555555555555";
const APPLICATION_ID = "66666666-6666-4666-8666-666666666666";

const IDLE: JobsActionState = { status: "idle" };

const APPLICATION_ROW = {
  id: APPLICATION_ID,
  job_id: JOB_ID,
  applicant_id: APPLICANT_ID,
  tenant_id: TENANT_ID,
  status: "submitted",
};

/** Aviso de la PLATAFORMA: sin dueño miembro (`created_by is null`). */
const PLATFORM_JOB = {
  id: JOB_ID,
  title: "Mesera para restaurante en Corona",
  created_by: null as string | null,
  tenant_id: TENANT_ID,
};

type OpResult = { data?: unknown; error?: unknown };

interface RecordedCall {
  table: string;
  method: string;
  args: unknown[];
}

function createSupabaseStub(
  config: { application?: OpResult; job?: OpResult; update?: OpResult } = {},
) {
  const calls: RecordedCall[] = [];

  const resolveFor = (table: string, mode: string): OpResult => {
    if (table === "listings") return config.job ?? { data: PLATFORM_JOB, error: null };
    if (table === "job_applications") {
      if (mode === "update") {
        return config.update ?? { data: { id: APPLICATION_ID }, error: null };
      }
      return config.application ?? { data: APPLICATION_ROW, error: null };
    }
    return { data: null, error: null };
  };

  const from = vi.fn((table: string) => {
    let mode = "select";
    const record = (method: string) =>
      vi.fn((...args: unknown[]) => {
        calls.push({ table, method, args });
        if (method === "update") mode = method;
        return builder;
      });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = {
      select: record("select"),
      update: record("update"),
      eq: record("eq"),
      maybeSingle: vi.fn(async () => resolveFor(table, mode)),
      then: (resolve: (v: OpResult) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve(resolveFor(table, mode)).then(resolve, reject),
    };
    return builder;
  });

  return { client: { from }, from, calls };
}

function useStaff(
  overrides: { role?: string; tenantId?: string | null; userId?: string } = {},
  config: Parameters<typeof createSupabaseStub>[0] = {},
) {
  const stub = createSupabaseStub(config);
  mocks.getStaffContext.mockImplementation(async (min: string) => {
    const role = overrides.role ?? "domain_admin";
    const rank: Record<string, number> = { moderator: 1, domain_admin: 2, global_admin: 3 };
    // Espejo fiel del guard real: por debajo del mínimo devuelve null.
    if (rank[role] < rank[min]) return null;
    return {
      supabase: stub.client,
      user: { id: overrides.userId ?? STAFF_ID },
      role,
      tenantId: overrides.tenantId === undefined ? TENANT_ID : overrides.tenantId,
    };
  });
  return stub;
}

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createAdminClient.mockReturnValue({ admin: true });
  mocks.createNotification.mockResolvedValue({ ok: true });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

/* ------------------------------ Autorización ------------------------------ */

describe("resolveJobApplication · autorización por rol", () => {
  it("un moderator NO puede resolver postulaciones y no toca la DB", async () => {
    const stub = useStaff({ role: "moderator" });

    const state = await resolveJobApplication(
      IDLE,
      form({ applicationId: APPLICATION_ID, decision: "accept" }),
    );

    expect(state.status).toBe("error");
    expect(stub.from).not.toHaveBeenCalled();
    expect(mocks.logAdminAction).not.toHaveBeenCalled();
  });

  it("un domain_admin sí puede", async () => {
    useStaff({ role: "domain_admin" });

    const state = await resolveJobApplication(
      IDLE,
      form({ applicationId: APPLICATION_ID, decision: "accept" }),
    );

    expect(state.status).toBe("success");
  });

  it("un global_admin del mismo tenant sí puede", async () => {
    useStaff({ role: "global_admin" });

    const state = await resolveJobApplication(
      IDLE,
      form({ applicationId: APPLICATION_ID, decision: "decline" }),
    );

    expect(state.status).toBe("success");
  });

  it("sin tenant en el JWT nadie resuelve, tampoco un global_admin", async () => {
    // 0042 sacó el `or app.is_global_admin()`: la RLS exige
    // tenant_id = app.current_tenant_id() para todos. Sin tenant en el token,
    // la base no devolvería fila — la action dice lo mismo, y lo dice antes.
    const stub = useStaff({ role: "global_admin", tenantId: null });

    const state = await resolveJobApplication(
      IDLE,
      form({ applicationId: APPLICATION_ID, decision: "decline" }),
    );

    expect(state.status).toBe("error");
    expect(stub.calls.some((call) => call.method === "update")).toBe(false);
  });

  it("sin sesión staff devuelve error sin tocar nada", async () => {
    mocks.getStaffContext.mockResolvedValue(null);

    const state = await resolveJobApplication(
      IDLE,
      form({ applicationId: APPLICATION_ID, decision: "accept" }),
    );

    expect(state.status).toBe("error");
    expect(mocks.logAdminAction).not.toHaveBeenCalled();
  });

  it("un domain_admin de OTRO tenant no resuelve esta postulación", async () => {
    const stub = useStaff({ tenantId: "99999999-9999-4999-8999-999999999999" });

    const state = await resolveJobApplication(
      IDLE,
      form({ applicationId: APPLICATION_ID, decision: "accept" }),
    );

    expect(state.status).toBe("error");
    expect(stub.calls.some((call) => call.method === "update")).toBe(false);
  });

  it("un applicationId que no es uuid muere en zod, antes del guard", async () => {
    const state = await resolveJobApplication(
      IDLE,
      form({ applicationId: "no-es-uuid", decision: "accept" }),
    );

    expect(state.status).toBe("error");
    expect(mocks.getStaffContext).not.toHaveBeenCalled();
  });

  it("una decisión inventada muere en zod (nada de 'withdraw' por el admin)", async () => {
    const state = await resolveJobApplication(
      IDLE,
      form({ applicationId: APPLICATION_ID, decision: "withdraw" }),
    );

    expect(state.status).toBe("error");
    expect(mocks.getStaffContext).not.toHaveBeenCalled();
  });
});

/* --------------------------- Barrera de privacidad ------------------------- */

describe("resolveJobApplication · barrera de privacidad", () => {
  it("sobre un aviso de un MIEMBRO no resuelve, aunque llegue el submit", async () => {
    const stub = useStaff(
      {},
      { job: { data: { ...PLATFORM_JOB, created_by: MEMBER_ID }, error: null } },
    );

    const state = await resolveJobApplication(
      IDLE,
      form({ applicationId: APPLICATION_ID, decision: "accept" }),
    );

    expect(state.status).toBe("error");
    if (state.status !== "error") throw new Error("esperaba error");
    expect(state.message).toContain("miembro");
    expect(stub.calls.some((call) => call.method === "update")).toBe(false);
    expect(mocks.createNotification).not.toHaveBeenCalled();
  });

  it("sobre un aviso publicado por el PROPIO staff sí resuelve", async () => {
    useStaff({}, { job: { data: { ...PLATFORM_JOB, created_by: STAFF_ID }, error: null } });

    const state = await resolveJobApplication(
      IDLE,
      form({ applicationId: APPLICATION_ID, decision: "accept" }),
    );

    expect(state.status).toBe("success");
  });

  it("ni un global_admin se salta la barrera de un aviso ajeno", async () => {
    const stub = useStaff(
      { role: "global_admin" },
      { job: { data: { ...PLATFORM_JOB, created_by: MEMBER_ID }, error: null } },
    );

    const state = await resolveJobApplication(
      IDLE,
      form({ applicationId: APPLICATION_ID, decision: "accept" }),
    );

    expect(state.status).toBe("error");
    expect(stub.calls.some((call) => call.method === "update")).toBe(false);
  });
});

/* ------------------------- Resolución, audit y aviso ----------------------- */

describe("resolveJobApplication · efecto", () => {
  it("acepta con transición monótona desde 'submitted'", async () => {
    const stub = useStaff();

    const state = await resolveJobApplication(
      IDLE,
      form({ applicationId: APPLICATION_ID, decision: "accept" }),
    );

    expect(state.status).toBe("success");
    const updated = stub.calls.find((call) => call.method === "update");
    expect(updated?.table).toBe("job_applications");
    expect(updated?.args[0]).toEqual({ status: "accepted" });
    expect(stub.calls).toContainEqual({
      table: "job_applications",
      method: "eq",
      args: ["status", "submitted"],
    });
  });

  it("una postulación ya resuelta no se re-resuelve: avisa sin inventar", async () => {
    useStaff(
      {},
      {
        update: { data: null, error: null },
        // La re-lectura posterior la encuentra ya resuelta.
        application: { data: { ...APPLICATION_ROW, status: "accepted" }, error: null },
      },
    );

    const state = await resolveJobApplication(
      IDLE,
      form({ applicationId: APPLICATION_ID, decision: "decline" }),
    );

    expect(state.status).toBe("error");
    if (state.status !== "error") throw new Error("esperaba error");
    expect(state.message).toContain("ya respondió");
    expect(mocks.logAdminAction).not.toHaveBeenCalled();
    expect(mocks.createNotification).not.toHaveBeenCalled();
  });

  it("cero filas por RLS NO se disfraza de 'ya la respondió otra persona'", async () => {
    // Sigue en 'submitted' pero el UPDATE no tocó nada ⇒ fue un bloqueo de
    // permisos. Mandar a alguien a buscar una respuesta que nunca existió es
    // peor que decirle que no tiene permiso.
    useStaff({}, { update: { data: null, error: null } });

    const state = await resolveJobApplication(
      IDLE,
      form({ applicationId: APPLICATION_ID, decision: "decline" }),
    );

    expect(state.status).toBe("error");
    if (state.status !== "error") throw new Error("esperaba error");
    expect(state.message).toContain("administradores");
  });

  it("audita a nombre de quien actuó, con ids y SIN contenido", async () => {
    useStaff();

    await resolveJobApplication(
      IDLE,
      form({ applicationId: APPLICATION_ID, decision: "accept" }),
    );

    expect(mocks.logAdminAction).toHaveBeenCalledWith({
      actorId: STAFF_ID,
      action: "job_application.accepted",
      tenantId: TENANT_ID,
      subjectKind: "job_application",
      subjectId: APPLICATION_ID,
      meta: { job_id: JOB_ID, by: "staff" },
    });

    const [[logged]] = mocks.logAdminAction.mock.calls as unknown as [[{ meta: unknown }]];
    // El título del aviso es contenido: no entra al audit_log.
    expect(JSON.stringify(logged.meta)).not.toContain("Mesera");
  });

  it("rechazar audita con su propia acción", async () => {
    useStaff();

    await resolveJobApplication(
      IDLE,
      form({ applicationId: APPLICATION_ID, decision: "decline" }),
    );

    expect(mocks.logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: "job_application.declined" }),
    );
  });

  it("le avisa al postulante por el canal que YA usa el producto, y dice quién respondió", async () => {
    useStaff();

    await resolveJobApplication(
      IDLE,
      form({ applicationId: APPLICATION_ID, decision: "accept" }),
    );

    expect(mocks.createNotification).toHaveBeenCalledWith(
      { admin: true },
      expect.objectContaining({
        tenantId: TENANT_ID,
        profileId: APPLICANT_ID,
        kind: "job_application_update",
        href: `/empleos/${JOB_ID}`,
        body: expect.stringContaining("equipo de la comunidad"),
      }),
    );
  });

  it("una notificación caída NO tumba la decisión ya guardada", async () => {
    useStaff();
    mocks.createAdminClient.mockImplementation(() => {
      throw new Error("sin admin client");
    });

    const state = await resolveJobApplication(
      IDLE,
      form({ applicationId: APPLICATION_ID, decision: "accept" }),
    );

    expect(state.status).toBe("success");
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/admin/empleos/${JOB_ID}`);
  });

  it("una postulación inexistente no llega al update", async () => {
    const stub = useStaff({}, { application: { data: null, error: null } });

    const state = await resolveJobApplication(
      IDLE,
      form({ applicationId: APPLICATION_ID, decision: "accept" }),
    );

    expect(state.status).toBe("error");
    expect(stub.calls.some((call) => call.method === "update")).toBe(false);
  });

  it("revalida el panel y también el aviso público", async () => {
    useStaff();

    await resolveJobApplication(
      IDLE,
      form({ applicationId: APPLICATION_ID, decision: "accept" }),
    );

    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/empleos");
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/admin/empleos/${JOB_ID}`);
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/empleos/${JOB_ID}`);
  });
});
