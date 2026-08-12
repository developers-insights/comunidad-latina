import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * =============================================================================
 * RESOLVER UNA SOLICITUD DE CREADOR — verificado en el BACKEND
 * =============================================================================
 *
 * Aprobar a alguien como creador es autorizarlo a cobrar. Que el botón no se
 * dibuje para un `member` no prueba nada: una server action es un POST al que
 * se le puede pegar sin pasar por la pantalla. Lo que se fija acá:
 *
 *  1. Un `member` —y también un `moderator`— no resuelve nada, y ni siquiera se
 *     llega a armar la consulta.
 *  2. Un `domain_admin` no puede resolver una solicitud de OTRA comunidad: el
 *     `tenant_id` sale del JWT y el formulario no puede sobreescribirlo.
 *  3. La RPC se llama con el CLIENTE DEL STAFF y con los nombres y valores
 *     EXACTOS de la migración 0032 (`p_profile_id`, `p_decision`, `p_note`).
 *     Con el admin client la propia función levantaría `AUTH_REQUIRED`.
 *  4. Rechazar, suspender o pedir datos SIN motivo no pasa, aunque el cliente
 *     mande el POST igual.
 *  5. Cada decisión queda auditada — con ids y estados, nunca con el texto del
 *     motivo (§5.4).
 */

const mocks = vi.hoisted(() => ({
  getStaffContext: vi.fn(),
  logAdminAction: vi.fn(async () => true),
  revalidatePath: vi.fn(),
}));

vi.mock("../../guard", () => ({
  getStaffContext: mocks.getStaffContext,
  logAdminAction: mocks.logAdminAction,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { resolveCreatorActivation, type ResolveCreatorState } from "./actions";

const MY_TENANT = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT = "99999999-9999-4999-8999-999999999999";
const ADMIN_ID = "22222222-2222-4222-8222-222222222222";
const CREATOR_ID = "33333333-3333-4333-8333-333333333333";
const IDLE: ResolveCreatorState = { status: "idle" };

const MOTIVO = "El portafolio no muestra trabajos propios.";

interface SelectCall {
  table: string;
  filters: Array<[string, unknown]>;
}
interface RpcCall {
  fn: string;
  args: Record<string, unknown>;
}

function createSupabaseStub(
  options: {
    /** Fila que devuelve la lectura previa. `null` ⇒ no existe en este tenant. */
    row?: { profile_id: string; status: string } | null;
    readError?: { message: string };
    rpcError?: { message: string };
  } = {},
) {
  const selects: SelectCall[] = [];
  const rpcs: RpcCall[] = [];
  const row = options.row === undefined ? { profile_id: CREATOR_ID, status: "platform_review_pending" } : options.row;

  const from = vi.fn((table: string) => ({
    select: () => {
      const call: SelectCall = { table, filters: [] };
      selects.push(call);
      const chain = {
        eq(column: string, value: unknown) {
          call.filters.push([column, value]);
          return chain;
        },
        async maybeSingle() {
          if (options.readError) return { data: null, error: options.readError };
          return { data: row, error: null };
        },
      };
      return chain;
    },
  }));

  const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
    rpcs.push({ fn, args });
    return { data: null, error: options.rpcError ?? null };
  });

  return { client: { from, rpc }, selects, rpcs, from, rpc };
}

function signedInAs(
  role = "domain_admin",
  tenantId: string | null = MY_TENANT,
  supabase: unknown = {},
) {
  mocks.getStaffContext.mockImplementation(async (min: string) => {
    const rank: Record<string, number> = { moderator: 1, domain_admin: 2, global_admin: 3 };
    if ((rank[role] ?? 0) < rank[min]) return null;
    return { supabase, user: { id: ADMIN_ID }, role, tenantId };
  });
}

function form(over: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.set("profileId", CREATOR_ID);
  fd.set("decision", "approved");
  for (const [key, value] of Object.entries(over)) fd.set(key, value);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("resolveCreatorActivation — quién puede decidir", () => {
  it("un member no resuelve nada", async () => {
    mocks.getStaffContext.mockResolvedValue(null);
    const stub = createSupabaseStub();

    const state = await resolveCreatorActivation(IDLE, form());

    expect(state.status).toBe("error");
    expect(stub.from).not.toHaveBeenCalled();
    expect(stub.rpc).not.toHaveBeenCalled();
    expect(mocks.logAdminAction).not.toHaveBeenCalled();
  });

  it("un moderator tampoco: acá el rango exigido es domain_admin", async () => {
    const stub = createSupabaseStub();
    signedInAs("moderator", MY_TENANT, stub.client);

    const state = await resolveCreatorActivation(IDLE, form());

    expect(state.status).toBe("error");
    expect(stub.rpcs).toHaveLength(0);
  });

  it("sin tenant en el JWT no se resuelve (nunca 'todas las comunidades')", async () => {
    const stub = createSupabaseStub();
    signedInAs("domain_admin", null, stub.client);

    const state = await resolveCreatorActivation(IDLE, form());

    expect(state.status).toBe("error");
    expect(stub.rpcs).toHaveLength(0);
  });
});

describe("resolveCreatorActivation — aislamiento entre comunidades", () => {
  it("la lectura previa se acota SIEMPRE al tenant del JWT", async () => {
    // `creator_profiles_select` es USING(true): sin este filtro se leería el
    // perfil de cualquier comunidad.
    const stub = createSupabaseStub();
    signedInAs("domain_admin", MY_TENANT, stub.client);

    await resolveCreatorActivation(IDLE, form());

    expect(stub.selects[0].table).toBe("creator_profiles");
    expect(stub.selects[0].filters).toContainEqual(["tenant_id", MY_TENANT]);
    expect(stub.selects[0].filters).toContainEqual(["profile_id", CREATOR_ID]);
  });

  it("un tenant_id inyectado en el formulario se ignora", async () => {
    const stub = createSupabaseStub();
    signedInAs("domain_admin", MY_TENANT, stub.client);

    const fd = form();
    fd.set("tenant_id", OTHER_TENANT);
    fd.set("tenantId", OTHER_TENANT);

    const state = await resolveCreatorActivation(IDLE, fd);

    expect(state.status).toBe("success");
    expect(stub.selects[0].filters).toContainEqual(["tenant_id", MY_TENANT]);
    expect(mocks.logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: MY_TENANT }),
    );
  });

  it("una solicitud de otra comunidad se ve como inexistente", async () => {
    const stub = createSupabaseStub({ row: null });
    signedInAs("domain_admin", MY_TENANT, stub.client);

    const state = await resolveCreatorActivation(IDLE, form());

    expect(state.status).toBe("error");
    expect(stub.rpcs).toHaveLength(0);
    expect(mocks.logAdminAction).not.toHaveBeenCalled();
  });
});

describe("resolveCreatorActivation — el contrato de la RPC (0032)", () => {
  it("aprueba llamando a la RPC con los nombres y valores exactos de la migración", async () => {
    const stub = createSupabaseStub();
    signedInAs("domain_admin", MY_TENANT, stub.client);

    const state = await resolveCreatorActivation(IDLE, form());

    expect(state.status).toBe("success");
    expect(stub.rpcs).toHaveLength(1);
    expect(stub.rpcs[0].fn).toBe("admin_resolve_creator_activation");
    expect(stub.rpcs[0].args).toMatchObject({
      p_profile_id: CREATOR_ID,
      p_decision: "approved",
    });
  });

  it("acepta las cuatro decisiones del CHECK y ninguna más", async () => {
    signedInAs("domain_admin", MY_TENANT, createSupabaseStub().client);

    for (const decision of ["approved", "needs_info", "rejected", "suspended"]) {
      const stub = createSupabaseStub();
      signedInAs("domain_admin", MY_TENANT, stub.client);
      const state = await resolveCreatorActivation(IDLE, form({ decision, note: MOTIVO }));
      expect(state.status, decision).toBe("success");
      expect(stub.rpcs[0].args.p_decision).toBe(decision);
    }

    for (const decision of ["aprobar", "banned", "APPROVED", ""]) {
      const stub = createSupabaseStub();
      signedInAs("domain_admin", MY_TENANT, stub.client);
      const state = await resolveCreatorActivation(IDLE, form({ decision, note: MOTIVO }));
      expect(state.status, decision).toBe("error");
      expect(stub.rpcs).toHaveLength(0);
    }
  });

  it("el motivo viaja en p_note, el parámetro que declara la migración", async () => {
    const stub = createSupabaseStub();
    signedInAs("domain_admin", MY_TENANT, stub.client);

    await resolveCreatorActivation(IDLE, form({ decision: "rejected", note: MOTIVO }));

    expect(stub.rpcs[0].args.p_note).toBe(MOTIVO);
  });

  it("un FORBIDDEN de la base no se disfraza de éxito ni se audita", async () => {
    const stub = createSupabaseStub({
      rpcError: { message: "FORBIDDEN: necesitás permisos de moderación." },
    });
    signedInAs("domain_admin", MY_TENANT, stub.client);

    const state = await resolveCreatorActivation(IDLE, form());

    expect(state.status).toBe("error");
    // Y el mensaje crudo del SQL no llega a la pantalla.
    if (state.status === "error") expect(state.message).not.toContain("FORBIDDEN");
    expect(mocks.logAdminAction).not.toHaveBeenCalled();
  });

  it("un error de lectura no se convierte en 'no existe' ni sigue de largo", async () => {
    const stub = createSupabaseStub({ readError: { message: "connection reset" } });
    signedInAs("domain_admin", MY_TENANT, stub.client);

    const state = await resolveCreatorActivation(IDLE, form());

    expect(state.status).toBe("error");
    expect(stub.rpcs).toHaveLength(0);
    expect(console.error).toHaveBeenCalled();
  });
});

describe("resolveCreatorActivation — el motivo es obligatorio de verdad", () => {
  it("rechazar sin motivo no llega a la base", async () => {
    const stub = createSupabaseStub();
    signedInAs("domain_admin", MY_TENANT, stub.client);

    const state = await resolveCreatorActivation(IDLE, form({ decision: "rejected" }));

    expect(state.status).toBe("error");
    expect(stub.rpcs).toHaveLength(0);
    expect(stub.from).not.toHaveBeenCalled();
  });

  it("un motivo de dos letras tampoco es un motivo", async () => {
    const stub = createSupabaseStub();
    signedInAs("domain_admin", MY_TENANT, stub.client);

    const state = await resolveCreatorActivation(IDLE, form({ decision: "suspended", note: "no" }));

    expect(state.status).toBe("error");
    expect(stub.rpcs).toHaveLength(0);
  });

  it("aprobar NO exige motivo: nadie necesita que le expliquen un sí", async () => {
    const stub = createSupabaseStub();
    signedInAs("domain_admin", MY_TENANT, stub.client);

    const state = await resolveCreatorActivation(IDLE, form({ decision: "approved" }));

    expect(state.status).toBe("success");
  });
});

describe("resolveCreatorActivation — doble resolución", () => {
  it("no se vuelve a escribir una solicitud que ya está en ese estado", async () => {
    const stub = createSupabaseStub({ row: { profile_id: CREATOR_ID, status: "approved" } });
    signedInAs("domain_admin", MY_TENANT, stub.client);

    const state = await resolveCreatorActivation(IDLE, form({ decision: "approved" }));

    expect(state.status).toBe("error");
    expect(stub.rpcs).toHaveLength(0);
  });

  it("una solicitud que ni siquiera se envió no se puede resolver", async () => {
    const stub = createSupabaseStub({
      row: { profile_id: CREATOR_ID, status: "application_started" },
    });
    signedInAs("domain_admin", MY_TENANT, stub.client);

    const state = await resolveCreatorActivation(IDLE, form());

    expect(state.status).toBe("error");
    expect(stub.rpcs).toHaveLength(0);
  });

  it("una aprobada SÍ se puede suspender después", async () => {
    const stub = createSupabaseStub({ row: { profile_id: CREATOR_ID, status: "approved" } });
    signedInAs("domain_admin", MY_TENANT, stub.client);

    const state = await resolveCreatorActivation(
      IDLE,
      form({ decision: "suspended", note: MOTIVO }),
    );

    expect(state.status).toBe("success");
    expect(stub.rpcs[0].args.p_decision).toBe("suspended");
  });
});

describe("resolveCreatorActivation — auditoría y caché", () => {
  it("audita quién, sobre quién, de qué estado a cuál — y NUNCA el texto del motivo", async () => {
    const stub = createSupabaseStub({
      row: { profile_id: CREATOR_ID, status: "platform_review_pending" },
    });
    signedInAs("domain_admin", MY_TENANT, stub.client);

    await resolveCreatorActivation(IDLE, form({ decision: "rejected", note: MOTIVO }));

    expect(mocks.logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: ADMIN_ID,
        action: "creator_activation.rejected",
        tenantId: MY_TENANT,
        subjectKind: "creator_profile",
        subjectId: CREATOR_ID,
        meta: expect.objectContaining({
          from_status: "platform_review_pending",
          to_status: "rejected",
          note_length: MOTIVO.length,
        }),
      }),
    );

    // §5.4: el audit_log guarda ids, no contenido. El motivo es texto libre de
    // una persona sobre otra — queda su largo, jamás su cuerpo.
    const [[logged]] = mocks.logAdminAction.mock.calls as unknown as [[{ meta: unknown }]];
    expect(JSON.stringify(logged.meta)).not.toContain("portafolio");
  });

  it("invalida también la pantalla de quien solicitó", async () => {
    const stub = createSupabaseStub();
    signedInAs("domain_admin", MY_TENANT, stub.client);

    await resolveCreatorActivation(IDLE, form());

    // Sin esto, la persona seguiría viendo "tu solicitud está en revisión"
    // después de que ya se resolvió.
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/creadores/solicitud");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/creadores/solicitudes");
  });
});
