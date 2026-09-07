import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests del CONTRATO de las acciones sobre un mensaje (0136 + 0138).
 *
 * Bordes mockeados con el patrón del repo (`compartir-actions.test.ts`,
 * `grupos/actions.test.ts`): `vi.hoisted` + `vi.mock` + un stub thenable del
 * query builder. No se toca ni Supabase ni la RLS real.
 *
 * QUÉ SE VERIFICA Y QUÉ NO. Acá se verifica lo que ESTAS actions deciden: que
 * zod corte antes de tocar la base, que el `tenant_id` salga del guard y nunca
 * del input, que cambiar de reacción BORRE la anterior (la unicidad de la 0007),
 * que un `kind` de más de 64 caracteres no llegue a la base, y que el "no" de
 * los triggers de la 0136 se traduzca por TOKEN y no por su texto en español.
 * La AUTORIZACIÓN no se testea acá porque no vive acá: vive en las policies.
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
  reportScamAction: vi.fn(async () => ({ ok: true as const })),
  reportarMensajeDeGrupoAction: vi.fn(async () => ({ ok: true as const })),
  borrarMensajeDeGrupoAction: vi.fn(async () => ({ ok: true as const })),
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
vi.mock("./actions", () => ({ reportScamAction: mocks.reportScamAction }));
vi.mock("./grupos/actions", () => ({
  reportarMensajeDeGrupoAction: mocks.reportarMensajeDeGrupoAction,
  borrarMensajeDeGrupoAction: mocks.borrarMensajeDeGrupoAction,
}));

import {
  editarMensajeAction,
  eliminarMensajeAction,
  reaccionarAMensajeAction,
  reportarMensajeAction,
} from "./mensaje-actions";

/* -------------------------------- Fixtures -------------------------------- */

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const OTRO_TENANT = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const USER_ID = "99999999-9999-4999-8999-999999999999";
const MENSAJE_ID = "44444444-4444-4444-8444-444444444444";
const HILO_ID = "55555555-5555-4555-8555-555555555555";

type Operacion =
  | { op: "insert"; tabla: string; fila: Record<string, unknown> }
  | { op: "update"; tabla: string; parche: Record<string, unknown> }
  | { op: "delete"; tabla: string; filtros: Record<string, unknown> };

/**
 * Stub del query builder. Registra cada operación para poder afirmar sobre la
 * FILA —que es el contrato real con la 0136/0138— y no sólo sobre el retorno.
 */
function crearStub(
  config: {
    insertError?: { code?: string; message?: string };
    updateError?: { code?: string; message?: string };
    deleteError?: { code?: string; message?: string };
    updateCount?: number;
  } = {},
) {
  const operaciones: Operacion[] = [];

  const from = vi.fn((tabla: string) => {
    const filtros: Record<string, unknown> = {};

    const thenable = (resultado: unknown) => ({
      eq(columna: string, valor: unknown) {
        filtros[columna] = valor;
        return this;
      },
      then(resolve: (valor: unknown) => unknown) {
        return Promise.resolve(resultado).then(resolve);
      },
    });

    return {
      insert(fila: Record<string, unknown>) {
        operaciones.push({ op: "insert", tabla, fila });
        return Promise.resolve({ error: config.insertError ?? null });
      },
      update(parche: Record<string, unknown>) {
        operaciones.push({ op: "update", tabla, parche });
        return thenable({
          error: config.updateError ?? null,
          count: config.updateError ? null : (config.updateCount ?? 1),
        });
      },
      delete() {
        operaciones.push({ op: "delete", tabla, filtros });
        return thenable({ error: config.deleteError ?? null });
      },
    };
  });

  return { supabase: { from }, operaciones };
}

function guardOk(stub: { supabase: unknown }) {
  mocks.requireTenantMatch.mockResolvedValue({
    ok: true,
    tenant: { id: TENANT_ID },
    supabase: stub.supabase,
    user: { id: USER_ID },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.limit.mockReturnValue({ ok: true, remaining: 10, retryAfterMs: 0 });
  mocks.moderateText.mockResolvedValue({
    flagged: false,
    categories: [],
    score: 0,
    skipped: true,
  });
  mocks.reportScamAction.mockResolvedValue({ ok: true });
  mocks.reportarMensajeDeGrupoAction.mockResolvedValue({ ok: true });
  mocks.borrarMensajeDeGrupoAction.mockResolvedValue({ ok: true });
});

/* ------------------------------- Reaccionar ------------------------------- */

describe("reaccionarAMensajeAction", () => {
  it("zod corta antes de tocar la base", async () => {
    const stub = crearStub();
    guardOk(stub);

    const resultado = await reaccionarAMensajeAction({
      ambito: "directo",
      mensajeId: "no-es-un-uuid",
      hiloId: HILO_ID,
      kind: "❤️",
    });

    expect(resultado).toEqual({ ok: false, code: "invalid" });
    expect(stub.operaciones).toHaveLength(0);
  });

  it("rechaza un `kind` más largo que el CHECK de la 0138", async () => {
    const stub = crearStub();
    guardOk(stub);

    const resultado = await reaccionarAMensajeAction({
      ambito: "directo",
      mensajeId: MENSAJE_ID,
      hiloId: HILO_ID,
      kind: "x".repeat(65),
    });

    expect(resultado).toEqual({ ok: false, code: "invalid" });
    expect(stub.operaciones).toHaveLength(0);
  });

  it("BORRA la reacción anterior antes de insertar la nueva", async () => {
    const stub = crearStub();
    guardOk(stub);

    const resultado = await reaccionarAMensajeAction({
      ambito: "directo",
      mensajeId: MENSAJE_ID,
      hiloId: HILO_ID,
      kind: ":klk:",
    });

    expect(resultado).toEqual({ ok: true });
    // Ese orden ES el contrato: `reactions_update` está en `using(false)`, así
    // que un upsert fallaría siempre y "una por persona" se hace con el delete.
    expect(stub.operaciones.map((o) => o.op)).toEqual(["delete", "insert"]);
  });

  it("el tenant_id sale del guard, nunca del input", async () => {
    const stub = crearStub();
    guardOk(stub);

    await reaccionarAMensajeAction({
      ambito: "directo",
      mensajeId: MENSAJE_ID,
      hiloId: HILO_ID,
      kind: "❤️",
      // Un cliente malicioso mandando su propio tenant: se ignora entero.
      ...({ tenantId: OTRO_TENANT } as unknown as Record<string, never>),
    });

    const insert = stub.operaciones.find((o) => o.op === "insert");
    expect(insert).toBeDefined();
    expect(insert && "fila" in insert && insert.fila).toMatchObject({
      tenant_id: TENANT_ID,
      profile_id: USER_ID,
      subject_kind: "message",
      subject_id: MENSAJE_ID,
      kind: "❤️",
    });
  });

  it("un mensaje de grupo entra como `group_message`", async () => {
    const stub = crearStub();
    guardOk(stub);

    await reaccionarAMensajeAction({
      ambito: "grupo",
      mensajeId: MENSAJE_ID,
      hiloId: HILO_ID,
      kind: "👍",
    });

    const insert = stub.operaciones.find((o) => o.op === "insert");
    expect(insert && "fila" in insert && insert.fila.subject_kind).toBe("group_message");
  });

  it("nunca manda `entity_listing_id`: la 0138 lo prohíbe en un chat", async () => {
    const stub = crearStub();
    guardOk(stub);

    await reaccionarAMensajeAction({
      ambito: "directo",
      mensajeId: MENSAJE_ID,
      hiloId: HILO_ID,
      kind: "❤️",
    });

    const insert = stub.operaciones.find((o) => o.op === "insert");
    expect(insert && "fila" in insert && insert.fila).not.toHaveProperty(
      "entity_listing_id",
    );
  });

  it("con `kind: null` sólo borra", async () => {
    const stub = crearStub();
    guardOk(stub);

    const resultado = await reaccionarAMensajeAction({
      ambito: "directo",
      mensajeId: MENSAJE_ID,
      hiloId: HILO_ID,
      kind: null,
    });

    expect(resultado).toEqual({ ok: true });
    expect(stub.operaciones.map((o) => o.op)).toEqual(["delete"]);
  });

  it("un 23505 es la carrera de otra pestaña, no un error", async () => {
    const stub = crearStub({ insertError: { code: "23505" } });
    guardOk(stub);

    const resultado = await reaccionarAMensajeAction({
      ambito: "directo",
      mensajeId: MENSAJE_ID,
      hiloId: HILO_ID,
      kind: "❤️",
    });

    expect(resultado).toEqual({ ok: true });
  });

  it("un 42501 es la policy diciendo que no", async () => {
    const stub = crearStub({ insertError: { code: "42501" } });
    guardOk(stub);

    const resultado = await reaccionarAMensajeAction({
      ambito: "directo",
      mensajeId: MENSAJE_ID,
      hiloId: HILO_ID,
      kind: "❤️",
    });

    expect(resultado).toEqual({ ok: false, code: "forbidden" });
  });

  it("NO revalida el hilo: la pastilla ya se pintó de forma optimista", async () => {
    const stub = crearStub();
    guardOk(stub);

    await reaccionarAMensajeAction({
      ambito: "directo",
      mensajeId: MENSAJE_ID,
      hiloId: HILO_ID,
      kind: "❤️",
    });

    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("respeta el techo por persona", async () => {
    const stub = crearStub();
    guardOk(stub);
    mocks.limit.mockReturnValue({ ok: false, remaining: 0, retryAfterMs: 1000 });

    const resultado = await reaccionarAMensajeAction({
      ambito: "directo",
      mensajeId: MENSAJE_ID,
      hiloId: HILO_ID,
      kind: "❤️",
    });

    expect(resultado).toEqual({ ok: false, code: "rate-limited" });
    expect(stub.operaciones).toHaveLength(0);
  });

  it("sin sesión no llega a la base", async () => {
    const stub = crearStub();
    mocks.requireTenantMatch.mockResolvedValue({ ok: false, reason: "unauthenticated" });

    const resultado = await reaccionarAMensajeAction({
      ambito: "directo",
      mensajeId: MENSAJE_ID,
      hiloId: HILO_ID,
      kind: "❤️",
    });

    expect(resultado).toEqual({ ok: false, code: "unauthenticated" });
    expect(stub.operaciones).toHaveLength(0);
  });
});

/* --------------------------------- Editar --------------------------------- */

describe("editarMensajeAction", () => {
  it("sólo manda `body`: el resto de las columnas las pisa el trigger", async () => {
    const stub = crearStub();
    guardOk(stub);

    const resultado = await editarMensajeAction({
      ambito: "directo",
      mensajeId: MENSAJE_ID,
      hiloId: HILO_ID,
      body: "  ahora sí  ",
    });

    expect(resultado).toEqual({ ok: true });
    const update = stub.operaciones.find((o) => o.op === "update");
    expect(update && "parche" in update && update.parche).toEqual({ body: "ahora sí" });
    // `editado_at` lo escribe la BASE (0136 §5), nunca el cliente.
    expect(update && "parche" in update && update.parche).not.toHaveProperty("editado_at");
  });

  it("traduce EDIT_WINDOW_CLOSED por su token, no por el texto en español", async () => {
    const stub = crearStub({
      updateError: {
        code: "P0001",
        message:
          "EDIT_WINDOW_CLOSED: los mensajes se pueden corregir hasta 15 minutos después de enviarlos.",
      },
    });
    guardOk(stub);

    const resultado = await editarMensajeAction({
      ambito: "directo",
      mensajeId: MENSAJE_ID,
      hiloId: HILO_ID,
      body: "tarde",
    });

    expect(resultado).toEqual({ ok: false, code: "edit-window-closed" });
  });

  it("traduce NOT_MESSAGE_AUTHOR y MESSAGE_DELETED", async () => {
    guardOk(crearStub({ updateError: { message: "NOT_MESSAGE_AUTHOR: no sos vos." } }));
    await expect(
      editarMensajeAction({
        ambito: "grupo",
        mensajeId: MENSAJE_ID,
        hiloId: HILO_ID,
        body: "x",
      }),
    ).resolves.toEqual({ ok: false, code: "not-author" });

    guardOk(crearStub({ updateError: { message: "MESSAGE_DELETED: ya no está." } }));
    await expect(
      editarMensajeAction({
        ambito: "grupo",
        mensajeId: MENSAJE_ID,
        hiloId: HILO_ID,
        body: "x",
      }),
    ).resolves.toEqual({ ok: false, code: "deleted" });
  });

  it("cero filas tocadas es la policy, no un error de red", async () => {
    const stub = crearStub({ updateCount: 0 });
    guardOk(stub);

    const resultado = await editarMensajeAction({
      ambito: "directo",
      mensajeId: MENSAJE_ID,
      hiloId: HILO_ID,
      body: "hola",
    });

    expect(resultado).toEqual({ ok: false, code: "forbidden" });
  });

  it("el texto corregido pasa por la misma moderación que el original", async () => {
    const stub = crearStub();
    guardOk(stub);
    mocks.moderateText.mockResolvedValue({
      flagged: true,
      categories: ["harassment"],
      score: 90,
      skipped: false,
    });

    const resultado = await editarMensajeAction({
      ambito: "directo",
      mensajeId: MENSAJE_ID,
      hiloId: HILO_ID,
      body: "algo feo",
    });

    expect(resultado).toEqual({ ok: false, code: "flagged" });
    expect(stub.operaciones).toHaveLength(0);
  });

  it("un cuerpo vacío no llega a la base", async () => {
    const stub = crearStub();
    guardOk(stub);

    const resultado = await editarMensajeAction({
      ambito: "directo",
      mensajeId: MENSAJE_ID,
      hiloId: HILO_ID,
      body: "   ",
    });

    expect(resultado).toEqual({ ok: false, code: "invalid" });
    expect(stub.operaciones).toHaveLength(0);
  });

  it("revalida el hilo que corresponde a cada ámbito", async () => {
    guardOk(crearStub());
    await editarMensajeAction({
      ambito: "directo",
      mensajeId: MENSAJE_ID,
      hiloId: HILO_ID,
      body: "hola",
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/mensajes/${HILO_ID}`);

    guardOk(crearStub());
    await editarMensajeAction({
      ambito: "grupo",
      mensajeId: MENSAJE_ID,
      hiloId: HILO_ID,
      body: "hola",
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/mensajes/grupos/${HILO_ID}`);
  });
});

/* -------------------------------- Eliminar -------------------------------- */

describe("eliminarMensajeAction", () => {
  it("en el chat de dos pone `deleted_at` y nada más", async () => {
    const stub = crearStub();
    guardOk(stub);

    const resultado = await eliminarMensajeAction({
      ambito: "directo",
      mensajeId: MENSAJE_ID,
      hiloId: HILO_ID,
    });

    expect(resultado).toEqual({ ok: true });
    const update = stub.operaciones.find((o) => o.op === "update");
    expect(update && "tabla" in update && update.tabla).toBe("messages");
    expect(
      update && "parche" in update && Object.keys(update.parche),
    ).toEqual(["deleted_at"]);
  });

  it("cero filas = `messages_update` exige ser el autor, sin rama de moderación", async () => {
    const stub = crearStub({ updateCount: 0 });
    guardOk(stub);

    const resultado = await eliminarMensajeAction({
      ambito: "directo",
      mensajeId: MENSAJE_ID,
      hiloId: HILO_ID,
    });

    expect(resultado).toEqual({ ok: false, code: "forbidden" });
  });

  it("en grupos delega en la action que ya existe, sin duplicar la regla", async () => {
    const stub = crearStub();
    guardOk(stub);

    const resultado = await eliminarMensajeAction({
      ambito: "grupo",
      mensajeId: MENSAJE_ID,
      hiloId: HILO_ID,
    });

    expect(resultado).toEqual({ ok: true });
    expect(mocks.borrarMensajeDeGrupoAction).toHaveBeenCalledWith({
      groupId: HILO_ID,
      messageId: MENSAJE_ID,
    });
    expect(stub.operaciones).toHaveLength(0);
  });

  it("traduce el `forbidden` que devuelve la action de grupos", async () => {
    guardOk(crearStub());
    mocks.borrarMensajeDeGrupoAction.mockResolvedValue({
      ok: false,
      code: "forbidden",
    } as never);

    await expect(
      eliminarMensajeAction({ ambito: "grupo", mensajeId: MENSAJE_ID, hiloId: HILO_ID }),
    ).resolves.toEqual({ ok: false, code: "forbidden" });
  });
});

/* -------------------------------- Reportar -------------------------------- */

describe("reportarMensajeAction", () => {
  it("el chat de dos va por report_scam con kind=message", async () => {
    const resultado = await reportarMensajeAction({
      ambito: "directo",
      mensajeId: MENSAJE_ID,
      reason: "datos_falsos",
      details: "  algo  ",
    });

    expect(resultado).toEqual({ ok: true });
    expect(mocks.reportScamAction).toHaveBeenCalledWith({
      targetKind: "message",
      targetId: MENSAJE_ID,
      reason: "datos_falsos",
      details: "algo",
    });
    expect(mocks.reportarMensajeDeGrupoAction).not.toHaveBeenCalled();
  });

  it("el grupo va por su propia RPC", async () => {
    await reportarMensajeAction({
      ambito: "grupo",
      mensajeId: MENSAJE_ID,
      reason: "otro",
    });

    expect(mocks.reportarMensajeDeGrupoAction).toHaveBeenCalledWith({
      messageId: MENSAJE_ID,
      reason: "otro",
      details: undefined,
    });
    expect(mocks.reportScamAction).not.toHaveBeenCalled();
  });

  it("propaga el techo diario de denuncias", async () => {
    mocks.reportScamAction.mockResolvedValue({
      ok: false,
      code: "rate-limited",
    } as never);

    await expect(
      reportarMensajeAction({
        ambito: "directo",
        mensajeId: MENSAJE_ID,
        reason: "otro",
      }),
    ).resolves.toEqual({ ok: false, code: "rate-limited" });
  });

  it("un motivo vacío no sale de zod", async () => {
    const resultado = await reportarMensajeAction({
      ambito: "directo",
      mensajeId: MENSAJE_ID,
      reason: "",
    });

    expect(resultado).toEqual({ ok: false, code: "invalid" });
    expect(mocks.reportScamAction).not.toHaveBeenCalled();
  });
});
