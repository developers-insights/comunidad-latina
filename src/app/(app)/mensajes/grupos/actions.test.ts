import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests de las server actions de GRUPOS.
 *
 * Bordes mockeados con el patrón del repo (`inline-actions.test.ts`,
 * `lib/tenant/guard.test.ts`): `vi.hoisted` + `vi.mock` + un stub thenable del
 * query builder. No se toca ni Supabase ni la RLS real.
 *
 * QUÉ SE VERIFICA ACÁ Y QUÉ NO. Estos tests cubren el CONTRATO de la action:
 * que zod corte antes de tocar la base, que cada código de Postgres se
 * traduzca al copy correcto, y que el aviso al grupo no rompa el envío. La
 * autorización NO se testea acá porque no vive acá: vive en las policies de la
 * 0133, y lo que se puede afirmar de ellas sin una base está en
 * `src/lib/messaging/grupos.test.ts`. Lo que sí se verifica es que la action
 * TRADUZCA bien el "no" de la base (42501 → forbidden), que es su trabajo.
 */

const mocks = vi.hoisted(() => ({
  requireTenantMatch: vi.fn(),
  revalidatePath: vi.fn(),
  limit: vi.fn(() => ({ ok: true, remaining: 10, retryAfterMs: 0 })),
  moderateText: vi.fn(async () => ({
    flagged: false,
    categories: [] as string[],
    score: 0,
    skipped: true,
  })),
  // Los parámetros van declarados —aunque no se usen— para que
  // `mock.calls[n][1]` tenga tipo: sin firma, vitest infiere una tupla vacía y
  // leer el segundo argumento es un error de compilación.
  createNotification: vi.fn(async (_admin: unknown, _input: unknown) => ({
    ok: true as const,
  })),
}));

vi.mock("@/lib/tenant/guard", () => ({ requireTenantMatch: mocks.requireTenantMatch }));
vi.mock("@/lib/rate-limit", () => ({
  limit: mocks.limit,
  HOUR_MS: 3_600_000,
  DAY_MS: 86_400_000,
}));
vi.mock("@/lib/moderation", () => ({ moderateText: mocks.moderateText }));
vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
  unstable_cache: (fn: unknown) => fn,
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => ({}) as never) }));
vi.mock("@/lib/notifications/notify", () => ({
  createNotification: mocks.createNotification,
}));

import {
  borrarMensajeDeGrupoAction,
  crearGrupoAction,
  editarGrupoAction,
  enviarMensajeAlGrupoAction,
  expulsarDelGrupoAction,
  invitarAlGrupoAction,
  unirmeAlGrupoAction,
} from "./actions";

/* -------------------------------- Fixtures -------------------------------- */

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "99999999-9999-4999-8999-999999999999";
const OTRO_ID = "88888888-8888-4888-8888-888888888888";
const GROUP_ID = "22222222-2222-4222-8222-222222222222";
const MESSAGE_ID = "33333333-3333-4333-8333-333333333333";
const OTRO_TENANT_ID = "44444444-4444-4444-8444-444444444444";

type OpResult = { data?: unknown; error?: unknown; count?: number | null };

type RecordedCall = { table: string; method: string; args: unknown[] };

/**
 * Stub del query builder. Cada tabla puede tener su respuesta terminal (lo que
 * devuelve el `await` del builder) y su respuesta de `maybeSingle`.
 */
function crearStub(config: {
  terminal?: Record<string, OpResult>;
  single?: Record<string, OpResult>;
  lista?: Record<string, OpResult>;
  /** Respuesta por nombre de RPC (`expulsar_de_grupo`, 0135). */
  rpc?: Record<string, OpResult>;
} = {}) {
  const calls: RecordedCall[] = [];

  const from = vi.fn((table: string) => {
    const terminal = () =>
      config.lista?.[table] ??
      config.terminal?.[table] ?? { data: null, error: null, count: 1 };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = {};
    for (const metodo of ["insert", "update", "delete", "select"]) {
      builder[metodo] = vi.fn((...args: unknown[]) => {
        calls.push({ table, method: metodo, args });
        return builder;
      });
    }
    for (const encadenable of ["eq", "in", "order", "limit", "neq"]) {
      builder[encadenable] = vi.fn(() => builder);
    }
    builder.maybeSingle = vi.fn(
      async () => config.single?.[table] ?? { data: null, error: null },
    );
    builder.then = (resolve: (v: OpResult) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(terminal()).then(resolve, reject);
    return builder;
  });

  const rpcCalls: [string, unknown][] = [];
  const rpc = vi.fn(async (nombre: string, args: unknown) => {
    rpcCalls.push([nombre, args]);
    return config.rpc?.[nombre] ?? { data: null, error: null };
  });
  return { client: { from, rpc }, calls, rpcCalls };
}

function guardOk(stub: ReturnType<typeof crearStub>) {
  mocks.requireTenantMatch.mockResolvedValue({
    ok: true,
    tenant: { id: TENANT_ID },
    supabase: stub.client,
    user: { id: USER_ID },
  });
}

const grupoValido = {
  name: "Ciclistas de Corona",
  description: "Salimos los domingos temprano.",
  category: "deportes",
  visibility: "public",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.limit.mockReturnValue({ ok: true, remaining: 10, retryAfterMs: 0 });
  mocks.moderateText.mockResolvedValue({
    flagged: false,
    categories: [],
    score: 0,
    skipped: true,
  });
});

/* ------------------------------- Crear grupo ------------------------------ */

describe("crearGrupoAction", () => {
  it("zod corta ANTES de tocar la base: nombre de dos letras no llega al guard", async () => {
    const resultado = await crearGrupoAction({ ...grupoValido, name: "Ok" });

    expect(resultado).toEqual({ ok: false, code: "invalid" });
    expect(mocks.requireTenantMatch).not.toHaveBeenCalled();
  });

  it("una categoría que la base rechazaría no sale de la app", async () => {
    const resultado = await crearGrupoAction({ ...grupoValido, category: "bicicleta" });

    expect(resultado).toEqual({ ok: false, code: "invalid" });
    expect(mocks.requireTenantMatch).not.toHaveBeenCalled();
  });

  it("crea con el tenant y el autor del JWT, nunca los del cliente", async () => {
    const stub = crearStub({ single: { chat_groups: { data: { id: GROUP_ID } } } });
    guardOk(stub);

    const resultado = await crearGrupoAction(grupoValido);

    expect(resultado).toEqual({ ok: true, groupId: GROUP_ID });
    const insert = stub.calls.find((c) => c.method === "insert");
    expect(insert?.args[0]).toMatchObject({
      tenant_id: TENANT_ID,
      created_by: USER_ID,
      name: "Ciclistas de Corona",
      category: "deportes",
      visibility: "public",
    });
  });

  it("el nombre se normaliza (espacios de más) antes de guardarlo", async () => {
    const stub = crearStub({ single: { chat_groups: { data: { id: GROUP_ID } } } });
    guardOk(stub);

    await crearGrupoAction({ ...grupoValido, name: "  Ciclistas   de   Corona  " });

    const insert = stub.calls.find((c) => c.method === "insert");
    expect((insert?.args[0] as { name: string }).name).toBe("Ciclistas de Corona");
  });

  it("un nombre repetido en la comunidad (23505) tiene copy propio, no 'algo salió mal'", async () => {
    const stub = crearStub({ terminal: {}, single: { chat_groups: { error: { code: "23505" } } } });
    guardOk(stub);

    const resultado = await crearGrupoAction(grupoValido);

    expect(resultado).toEqual({ ok: false, code: "duplicate" });
  });

  it("el nombre y la descripción pasan por moderación: son públicos antes de entrar", async () => {
    mocks.moderateText.mockResolvedValue({
      flagged: true,
      categories: ["harassment"],
      score: 1,
      skipped: false,
    });
    const stub = crearStub();
    guardOk(stub);

    const resultado = await crearGrupoAction(grupoValido);

    expect(resultado).toEqual({ ok: false, code: "flagged" });
    expect(stub.calls.some((c) => c.method === "insert")).toBe(false);
  });

  it("con el cupo diario agotado no se crea nada", async () => {
    mocks.limit.mockReturnValue({ ok: false, remaining: 0, retryAfterMs: 1000 });
    const stub = crearStub();
    guardOk(stub);

    const resultado = await crearGrupoAction(grupoValido);

    expect(resultado).toEqual({ ok: false, code: "rate-limited" });
    expect(stub.calls).toHaveLength(0);
  });
});

/* -------------------------------- Membresía ------------------------------- */

describe("unirmeAlGrupoAction", () => {
  it("se suma como member y con el tenant del JWT", async () => {
    const stub = crearStub();
    guardOk(stub);

    const resultado = await unirmeAlGrupoAction(GROUP_ID);

    expect(resultado).toEqual({ ok: true, groupId: GROUP_ID });
    const insert = stub.calls.find((c) => c.method === "insert");
    expect(insert?.args[0]).toEqual({
      group_id: GROUP_ID,
      profile_id: USER_ID,
      tenant_id: TENANT_ID,
      role: "member",
    });
  });

  it("si ya estaba adentro (23505) contesta que sí: el resultado que quería ya es cierto", async () => {
    const stub = crearStub({ terminal: { chat_group_members: { error: { code: "23505" } } } });
    guardOk(stub);

    await expect(unirmeAlGrupoAction(GROUP_ID)).resolves.toEqual({
      ok: true,
      groupId: GROUP_ID,
    });
  });

  it("un grupo privado o cerrado lo rechaza la policy (42501) → forbidden", async () => {
    const stub = crearStub({ terminal: { chat_group_members: { error: { code: "42501" } } } });
    guardOk(stub);

    await expect(unirmeAlGrupoAction(GROUP_ID)).resolves.toEqual({
      ok: false,
      code: "forbidden",
    });
  });

  it("un id que no es uuid no llega al guard", async () => {
    await expect(unirmeAlGrupoAction("no-soy-un-uuid")).resolves.toEqual({
      ok: false,
      code: "invalid",
    });
    expect(mocks.requireTenantMatch).not.toHaveBeenCalled();
  });
});

describe("invitarAlGrupoAction", () => {
  it("suma a la persona y le avisa", async () => {
    const stub = crearStub({ single: { chat_groups: { data: { name: "Ciclistas" } } } });
    guardOk(stub);

    const resultado = await invitarAlGrupoAction({
      groupId: GROUP_ID,
      profileId: OTRO_ID,
    });

    expect(resultado.ok).toBe(true);
    expect(mocks.createNotification).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        profileId: OTRO_ID,
        kind: "group_message",
        category: "mensajes",
        href: `/mensajes/grupos/${GROUP_ID}`,
      }),
    );
  });

  it("ya era miembro → duplicate, no un error rojo", async () => {
    const stub = crearStub({ terminal: { chat_group_members: { error: { code: "23505" } } } });
    guardOk(stub);

    await expect(
      invitarAlGrupoAction({ groupId: GROUP_ID, profileId: OTRO_ID }),
    ).resolves.toEqual({ ok: false, code: "duplicate" });
  });

  it("bloqueo entre las dos personas → la policy dice que no (42501) → forbidden", async () => {
    const stub = crearStub({ terminal: { chat_group_members: { error: { code: "42501" } } } });
    guardOk(stub);

    await expect(
      invitarAlGrupoAction({ groupId: GROUP_ID, profileId: OTRO_ID }),
    ).resolves.toEqual({ ok: false, code: "forbidden" });
  });
});

/* --------------------------------- Mensajes ------------------------------- */

describe("enviarMensajeAlGrupoAction", () => {
  it("guarda el mensaje con el sender del JWT y avisa al resto", async () => {
    const stub = crearStub({
      single: {
        chat_groups: { data: { name: "Ciclistas" } },
        profiles: { data: { display_name: "Ana" } },
      },
      lista: {
        chat_group_members: {
          data: [{ profile_id: USER_ID }, { profile_id: OTRO_ID }],
          error: null,
        },
      },
    });
    guardOk(stub);

    const resultado = await enviarMensajeAlGrupoAction({
      groupId: GROUP_ID,
      body: "  Buenas, ¿a qué hora salimos?  ",
    });

    expect(resultado).toEqual({ ok: true, groupId: GROUP_ID });
    const insert = stub.calls.find(
      (c) => c.table === "chat_group_messages" && c.method === "insert",
    );
    expect(insert?.args[0]).toEqual({
      tenant_id: TENANT_ID,
      group_id: GROUP_ID,
      sender_id: USER_ID,
      body: "Buenas, ¿a qué hora salimos?",
    });

    // A quien escribió NO se le avisa de su propio mensaje.
    const avisados = mocks.createNotification.mock.calls.map(
      (call) => (call[1] as { profileId: string }).profileId,
    );
    expect(avisados).toEqual([OTRO_ID]);
  });

  it("el aviso NUNCA lleva el texto del mensaje (se lee de costado en la bandeja)", async () => {
    const stub = crearStub({
      single: { chat_groups: { data: { name: "Ciclistas" } } },
      lista: { chat_group_members: { data: [{ profile_id: OTRO_ID }], error: null } },
    });
    guardOk(stub);

    await enviarMensajeAlGrupoAction({ groupId: GROUP_ID, body: "Dato sensible" });

    const aviso = mocks.createNotification.mock.calls[0]?.[1] as {
      title: string;
      body: string;
    };
    expect(aviso.body).not.toContain("Dato sensible");
    expect(aviso.title).not.toContain("Dato sensible");
  });

  it("un mensaje vacío no llega ni al guard", async () => {
    await expect(
      enviarMensajeAlGrupoAction({ groupId: GROUP_ID, body: "   " }),
    ).resolves.toEqual({ ok: false, code: "invalid" });
    expect(mocks.requireTenantMatch).not.toHaveBeenCalled();
  });

  it("moderación en rojo: no se guarda nada", async () => {
    mocks.moderateText.mockResolvedValue({
      flagged: true,
      categories: ["violence"],
      score: 1,
      skipped: false,
    });
    const stub = crearStub();
    guardOk(stub);

    const resultado = await enviarMensajeAlGrupoAction({
      groupId: GROUP_ID,
      body: "algo feo",
    });

    expect(resultado).toEqual({ ok: false, code: "flagged" });
    expect(stub.calls.some((c) => c.method === "insert")).toBe(false);
  });

  it("expulsado o grupo cerrado (42501) → forbidden, para que la pantalla se refresque", async () => {
    const stub = crearStub({ terminal: { chat_group_messages: { error: { code: "42501" } } } });
    guardOk(stub);

    await expect(
      enviarMensajeAlGrupoAction({ groupId: GROUP_ID, body: "hola" }),
    ).resolves.toEqual({ ok: false, code: "forbidden" });
  });

  it("comparte el techo con los mensajes directos: la misma key `mensaje:<uid>`", async () => {
    const stub = crearStub({
      single: { chat_groups: { data: { name: "Ciclistas" } } },
      lista: { chat_group_members: { data: [], error: null } },
    });
    guardOk(stub);

    await enviarMensajeAlGrupoAction({ groupId: GROUP_ID, body: "hola" });

    expect(mocks.limit).toHaveBeenCalledWith(`mensaje:${USER_ID}`, 120, 3_600_000);
  });

  it("si el aviso falla, el mensaje YA se entregó y la action sigue diciendo que sí", async () => {
    mocks.createNotification.mockRejectedValue(new Error("sin admin"));
    const stub = crearStub({
      single: { chat_groups: { data: { name: "Ciclistas" } } },
      lista: { chat_group_members: { data: [{ profile_id: OTRO_ID }], error: null } },
    });
    guardOk(stub);

    await expect(
      enviarMensajeAlGrupoAction({ groupId: GROUP_ID, body: "hola" }),
    ).resolves.toEqual({ ok: true, groupId: GROUP_ID });
  });
});

/* ------------------------- Los cierres de la 0135 ------------------------- */

describe("borrarMensajeDeGrupoAction (H-1)", () => {
  /**
   * Hasta la 0135 esta action NO PODÍA FUNCIONAR NUNCA, ni para el autor ni
   * para quien administra: `chat_group_messages_select` exigía `deleted_at is
   * null`, y el USING de un SELECT se aplica también a la fila nueva de un
   * UPDATE, así que la fila borrada no podía existir y la base contestaba 42501
   * siempre. Lo que el test puede fijar desde acá es que la action traduzca
   * bien; que la policy ya no lo bloquee está probado contra la base (dry-run
   * con rollback) y escrito en `lib/messaging/grupos.test.ts`.
   */
  it("baja el mensaje y contesta que sí", async () => {
    const stub = crearStub({
      terminal: { chat_group_messages: { error: null, count: 1 } },
    });
    guardOk(stub);

    await expect(
      borrarMensajeDeGrupoAction({ groupId: GROUP_ID, messageId: MESSAGE_ID }),
    ).resolves.toEqual({ ok: true, groupId: GROUP_ID });

    const update = stub.calls.find(
      (c) => c.table === "chat_group_messages" && c.method === "update",
    );
    // Sólo `deleted_at`: el cuerpo no se toca desde acá (y el trigger de la
    // 0135 lo volvería a pisar si alguien lo intentara).
    expect(Object.keys(update?.args[0] as object)).toEqual(["deleted_at"]);
  });

  it("si no borró ninguna fila es un 'no' de la base, no un 'listo'", async () => {
    const stub = crearStub({
      terminal: { chat_group_messages: { error: null, count: 0 } },
    });
    guardOk(stub);

    await expect(
      borrarMensajeDeGrupoAction({ groupId: GROUP_ID, messageId: MESSAGE_ID }),
    ).resolves.toEqual({ ok: false, code: "forbidden" });
  });

  it("un id que no es uuid no llega al guard", async () => {
    await expect(
      borrarMensajeDeGrupoAction({ groupId: GROUP_ID, messageId: "nope" }),
    ).resolves.toEqual({ ok: false, code: "invalid" });
    expect(mocks.requireTenantMatch).not.toHaveBeenCalled();
  });
});

describe("expulsarDelGrupoAction, ahora con veto (H-3)", () => {
  /**
   * El cambio de fondo: dejó de ser un DELETE sobre `chat_group_members` para
   * ser UNA RPC. Si volviera a ser dos escrituras desde acá, expulsar de un
   * grupo público volvería a durar hasta el toque siguiente.
   */
  it("llama a la RPC y no borra la membresía por su cuenta", async () => {
    const stub = crearStub({ rpc: { expulsar_de_grupo: { data: "ok" } } });
    guardOk(stub);

    await expect(
      expulsarDelGrupoAction({ groupId: GROUP_ID, profileId: OTRO_ID }),
    ).resolves.toEqual({ ok: true, groupId: GROUP_ID });

    expect(stub.rpcCalls).toEqual([
      ["expulsar_de_grupo", { p_group: GROUP_ID, p_profile: OTRO_ID }],
    ]);
    // La atomicidad la da la función: acá no puede quedar media operación.
    expect(stub.calls.some((c) => c.method === "delete")).toBe(false);
  });

  it("'no_estaba' es éxito: el resultado que se quería ya es cierto", async () => {
    const stub = crearStub({ rpc: { expulsar_de_grupo: { data: "no_estaba" } } });
    guardOk(stub);

    await expect(
      expulsarDelGrupoAction({ groupId: GROUP_ID, profileId: OTRO_ID }),
    ).resolves.toEqual({ ok: true, groupId: GROUP_ID });
  });

  it("'sin_permiso' —un miembro común, o el dueño del grupo— es forbidden", async () => {
    const stub = crearStub({ rpc: { expulsar_de_grupo: { data: "sin_permiso" } } });
    guardOk(stub);

    await expect(
      expulsarDelGrupoAction({ groupId: GROUP_ID, profileId: OTRO_ID }),
    ).resolves.toEqual({ ok: false, code: "forbidden" });
  });
});

describe("unirmeAlGrupoAction: 'te sacaron' no es 'probá de nuevo' (H-3)", () => {
  it("con veto contesta banned, para que la pantalla lo diga en serio", async () => {
    const stub = crearStub({
      terminal: { chat_group_members: { error: { code: "42501" } } },
      single: { chat_group_bans: { data: { profile_id: USER_ID } } },
    });
    guardOk(stub);

    await expect(unirmeAlGrupoAction(GROUP_ID)).resolves.toEqual({
      ok: false,
      code: "banned",
    });
  });

  it("sin veto, el mismo 42501 sigue siendo forbidden (privado o cerrado)", async () => {
    const stub = crearStub({
      terminal: { chat_group_members: { error: { code: "42501" } } },
      single: { chat_group_bans: { data: null } },
    });
    guardOk(stub);

    await expect(unirmeAlGrupoAction(GROUP_ID)).resolves.toEqual({
      ok: false,
      code: "forbidden",
    });
  });

  it("un error que no es 42501 no dispara la consulta del veto", async () => {
    const stub = crearStub({
      terminal: { chat_group_members: { error: { code: "08006" } } },
    });
    guardOk(stub);

    await expect(unirmeAlGrupoAction(GROUP_ID)).resolves.toEqual({
      ok: false,
      code: "error",
    });
    expect(stub.calls.some((c) => c.table === "chat_group_bans")).toBe(false);
  });

  it("cuando entra bien, no se pregunta nada de vetos", async () => {
    const stub = crearStub();
    guardOk(stub);

    await unirmeAlGrupoAction(GROUP_ID);
    expect(stub.calls.some((c) => c.table === "chat_group_bans")).toBe(false);
  });
});

describe("invitarAlGrupoAction levanta el veto antes de sumar (H-3)", () => {
  it("borra el veto y recién después da el alta", async () => {
    const stub = crearStub({ single: { chat_groups: { data: { name: "Ciclistas" } } } });
    guardOk(stub);

    await expect(
      invitarAlGrupoAction({ groupId: GROUP_ID, profileId: OTRO_ID }),
    ).resolves.toMatchObject({ ok: true });

    const veto = stub.calls.findIndex(
      (c) => c.table === "chat_group_bans" && c.method === "delete",
    );
    const alta = stub.calls.findIndex(
      (c) => c.table === "chat_group_members" && c.method === "insert",
    );
    expect(veto).toBeGreaterThan(-1);
    expect(alta).toBeGreaterThan(-1);
    // El orden importa: al revés, un fallo del delete dejaría a la persona
    // adentro y vetada a la vez, y nadie entendería por qué no puede volver
    // si algún día se va sola.
    expect(veto).toBeLessThan(alta);
  });
});

describe("la foto del grupo tiene que ser de esta comunidad (H-9)", () => {
  const SUPA = "https://proyecto.supabase.co";
  const OLD = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const propia = `${SUPA}/storage/v1/object/public/avatars/${TENANT_ID}/${USER_ID}/g.jpg`;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = SUPA;
  });
  afterAll(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = OLD;
  });

  it("una URL de otro host no llega ni al guard", async () => {
    await expect(
      crearGrupoAction({
        ...grupoValido,
        avatarUrl: "https://rastreador.example/foto.jpg",
      }),
    ).resolves.toEqual({ ok: false, code: "invalid" });
    expect(mocks.requireTenantMatch).not.toHaveBeenCalled();
  });

  it("la foto de OTRA comunidad se corta con el tenant del guard, sin escribir", async () => {
    const stub = crearStub({ single: { chat_groups: { data: { id: GROUP_ID } } } });
    guardOk(stub);

    const ajena = `${SUPA}/storage/v1/object/public/avatars/${OTRO_TENANT_ID}/${USER_ID}/g.jpg`;
    await expect(
      crearGrupoAction({ ...grupoValido, avatarUrl: ajena }),
    ).resolves.toEqual({ ok: false, code: "invalid" });
    expect(stub.calls.some((c) => c.method === "insert")).toBe(false);
  });

  it("la foto propia se guarda como siempre", async () => {
    const stub = crearStub({ single: { chat_groups: { data: { id: GROUP_ID } } } });
    guardOk(stub);

    await expect(
      crearGrupoAction({ ...grupoValido, avatarUrl: propia }),
    ).resolves.toEqual({ ok: true, groupId: GROUP_ID });

    const insert = stub.calls.find((c) => c.method === "insert");
    expect((insert?.args[0] as { avatar_url: string }).avatar_url).toBe(propia);
  });

  it("sin foto se sigue pudiendo crear un grupo", async () => {
    const stub = crearStub({ single: { chat_groups: { data: { id: GROUP_ID } } } });
    guardOk(stub);

    await expect(crearGrupoAction(grupoValido)).resolves.toEqual({
      ok: true,
      groupId: GROUP_ID,
    });
  });

  it("editar tampoco acepta una foto ajena", async () => {
    const stub = crearStub({ terminal: { chat_groups: { error: null, count: 1 } } });
    guardOk(stub);

    const ajena = `${SUPA}/storage/v1/object/public/avatars/${OTRO_TENANT_ID}/${USER_ID}/g.jpg`;
    await expect(
      editarGrupoAction({ groupId: GROUP_ID, ...grupoValido, avatarUrl: ajena }),
    ).resolves.toEqual({ ok: false, code: "invalid" });
    expect(stub.calls.some((c) => c.method === "update")).toBe(false);
  });
});
