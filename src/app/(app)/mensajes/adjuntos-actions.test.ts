import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests del CONTRATO de las server actions de adjuntos.
 *
 * Bordes mockeados con el patrón del repo (`grupos/actions.test.ts`,
 * `inline-actions.test.ts`): `vi.hoisted` + `vi.mock` + un stub thenable del
 * query builder. No se toca ni Supabase ni la RLS real.
 *
 * QUÉ SE VERIFICA ACÁ Y QUÉ NO. La autorización vive en las policies de la 0136
 * y la 0140, no en este archivo. Lo que se prueba es el trabajo de la action:
 * que zod corte antes de tocar la base, que el `tenant_id` y el `sender_id`
 * salgan del JWT y NUNCA del cliente, que un `path` ajeno no llegue nunca a un
 * insert, y que la firma de las URLs se pida con el cliente del usuario (que es
 * lo que hace que la policy de lectura de la 0140 sirva para algo).
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
  createNotification: vi.fn(async () => ({ ok: true as const })),
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
  enviarAdjuntoAction,
  firmarAdjuntosAction,
  prepararAdjuntosAction,
} from "./adjuntos-actions";

/* -------------------------------- Fixtures -------------------------------- */

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "99999999-9999-4999-8999-999999999999";
const OTRO_ID = "88888888-8888-4888-8888-888888888888";
const CONV_ID = "22222222-2222-4222-8222-222222222222";
const GROUP_ID = "33333333-3333-4333-8333-333333333333";
const UUID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

const RUTA_PROPIA = `${TENANT_ID}/${USER_ID}/chat-${UUID}.jpg`;
const RUTA_AJENA = `${TENANT_ID}/${OTRO_ID}/chat-${UUID}.jpg`;

type OpResult = { data?: unknown; error?: unknown };
type RecordedCall = { table: string; method: string; args: unknown[] };

function crearStub(
  config: {
    single?: Record<string, OpResult>;
    terminal?: Record<string, OpResult>;
    firmas?: OpResult;
  } = {},
) {
  const calls: RecordedCall[] = [];

  const from = vi.fn((table: string) => {
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
      Promise.resolve(config.terminal?.[table] ?? { data: null, error: null }).then(
        resolve,
        reject,
      );
    return builder;
  });

  const createSignedUrls = vi.fn(async () => config.firmas ?? { data: [], error: null });
  const storageFrom = vi.fn(() => ({ createSignedUrls }));

  return {
    client: { from, storage: { from: storageFrom } },
    calls,
    createSignedUrls,
    storageFrom,
  };
}

function guardOk(stub: ReturnType<typeof crearStub>) {
  mocks.requireTenantMatch.mockResolvedValue({
    ok: true,
    tenant: { id: TENANT_ID },
    supabase: stub.client,
    user: { id: USER_ID },
  });
}

/** Una conversación aceptada de la que soy participante. */
const CONVERSACION_ACEPTADA = {
  data: {
    id: CONV_ID,
    tenant_id: TENANT_ID,
    status: "accepted",
    created_by: USER_ID,
    counterpart_id: OTRO_ID,
  },
};

const DESTINO_DIRECTO = { tipo: "directo" as const, conversationId: CONV_ID };

const ARCHIVO_VALIDO = {
  tipo: "archivo" as const,
  path: RUTA_PROPIA,
  mime: "image/jpeg",
  bytes: 400_000,
};

function insertDe(stub: ReturnType<typeof crearStub>, tabla: string) {
  return stub.calls.find((c) => c.table === tabla && c.method === "insert")?.args[0] as
    | Record<string, unknown>
    | undefined;
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
});

/* --------------------------- prepararAdjuntosAction ----------------------- */

describe("prepararAdjuntosAction", () => {
  it("el cliente NO elige el prefijo: la ruta sale del guard y del JWT", async () => {
    const stub = crearStub();
    guardOk(stub);

    const resultado = await prepararAdjuntosAction({ mimes: ["image/jpeg"] });

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.rutas[0].path.startsWith(`${TENANT_ID}/${USER_ID}/`)).toBe(true);
    expect(resultado.rutas[0].path.endsWith(".jpg")).toBe(true);
  });

  it("devuelve una ruta por tipo, en el mismo orden", async () => {
    const stub = crearStub();
    guardOk(stub);

    const resultado = await prepararAdjuntosAction({
      mimes: ["image/png", "audio/webm", "video/mp4"],
    });

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.rutas.map((r) => r.mime)).toEqual([
      "image/png",
      "audio/webm",
      "video/mp4",
    ]);
    expect(resultado.rutas.map((r) => r.path.split(".").pop())).toEqual([
      "png",
      "webm",
      "mp4",
    ]);
  });

  it("un tipo que el bucket no acepta no recibe ruta", async () => {
    const stub = crearStub();
    guardOk(stub);

    expect(await prepararAdjuntosAction({ mimes: ["application/zip"] })).toEqual({
      ok: false,
      code: "tipo",
    });
  });

  it("dos rutas seguidas del mismo tipo no colisionan", async () => {
    const stub = crearStub();
    guardOk(stub);

    const resultado = await prepararAdjuntosAction({
      mimes: ["image/jpeg", "image/jpeg"],
    });
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.rutas[0].path).not.toBe(resultado.rutas[1].path);
  });

  it("corta ANTES de tocar la base cuando la lista está vacía", async () => {
    expect(await prepararAdjuntosAction({ mimes: [] })).toEqual({
      ok: false,
      code: "invalid",
    });
    expect(mocks.requireTenantMatch).not.toHaveBeenCalled();
  });

  it("sin sesión no arma nada", async () => {
    mocks.requireTenantMatch.mockResolvedValue({
      ok: false,
      reason: "unauthenticated",
      tenant: { id: TENANT_ID },
      supabase: {},
      user: null,
    });
    expect(await prepararAdjuntosAction({ mimes: ["image/jpeg"] })).toEqual({
      ok: false,
      code: "unauthenticated",
    });
  });
});

/* ----------------------------- enviarAdjuntoAction ------------------------ */

describe("enviarAdjuntoAction — seguridad del path", () => {
  it("un path del prefijo de OTRA persona no llega nunca a un insert", async () => {
    const stub = crearStub({ single: { conversations: CONVERSACION_ACEPTADA } });
    guardOk(stub);

    const resultado = await enviarAdjuntoAction({
      destino: DESTINO_DIRECTO,
      contenido: { ...ARCHIVO_VALIDO, path: RUTA_AJENA },
    });

    expect(resultado).toEqual({ ok: false, code: "forbidden" });
    expect(insertDe(stub, "messages")).toBeUndefined();
  });

  it.each([
    ["traversal", `${TENANT_ID}/${USER_ID}/chat-${UUID}..jpg`],
    ["nombre elegido a mano", `${TENANT_ID}/${USER_ID}/secreto.jpg`],
    ["el bucket adelante", `chat-media/${TENANT_ID}/${USER_ID}/chat-${UUID}.jpg`],
  ])("rechaza un path con %s", async (_caso, path) => {
    const stub = crearStub({ single: { conversations: CONVERSACION_ACEPTADA } });
    guardOk(stub);

    const resultado = await enviarAdjuntoAction({
      destino: DESTINO_DIRECTO,
      contenido: { ...ARCHIVO_VALIDO, path },
    });

    expect(resultado).toEqual({ ok: false, code: "forbidden" });
    expect(insertDe(stub, "messages")).toBeUndefined();
  });
});

describe("enviarAdjuntoAction — la puerta del servidor", () => {
  it("el tipo se valida acá, no sólo en el navegador", async () => {
    const stub = crearStub({ single: { conversations: CONVERSACION_ACEPTADA } });
    guardOk(stub);

    const resultado = await enviarAdjuntoAction({
      destino: DESTINO_DIRECTO,
      contenido: {
        ...ARCHIVO_VALIDO,
        path: `${TENANT_ID}/${USER_ID}/chat-${UUID}.zip`,
        mime: "application/zip",
      },
    });

    expect(resultado).toEqual({ ok: false, code: "tipo" });
    expect(insertDe(stub, "messages")).toBeUndefined();
  });

  it("el peso se valida acá con el techo del TIPO", async () => {
    const stub = crearStub({ single: { conversations: CONVERSACION_ACEPTADA } });
    guardOk(stub);

    const resultado = await enviarAdjuntoAction({
      destino: DESTINO_DIRECTO,
      contenido: { ...ARCHIVO_VALIDO, bytes: 9 * 1024 * 1024 },
    });

    expect(resultado).toEqual({ ok: false, code: "peso" });
  });

  it("una onda fuera de rango no se guarda: la dibuja el teléfono de otra persona", async () => {
    const stub = crearStub({ single: { conversations: CONVERSACION_ACEPTADA } });
    guardOk(stub);

    const resultado = await enviarAdjuntoAction({
      destino: DESTINO_DIRECTO,
      contenido: {
        tipo: "archivo",
        path: `${TENANT_ID}/${USER_ID}/chat-${UUID}.webm`,
        mime: "audio/webm",
        bytes: 30_000,
        onda: [10, 999],
      },
    });

    expect(resultado).toEqual({ ok: false, code: "invalid" });
  });

  it("comparte el techo de mensajes: los adjuntos no son una puerta lateral", async () => {
    const stub = crearStub({ single: { conversations: CONVERSACION_ACEPTADA } });
    guardOk(stub);
    mocks.limit.mockReturnValue({ ok: false, remaining: 0, retryAfterMs: 1000 });

    const resultado = await enviarAdjuntoAction({
      destino: DESTINO_DIRECTO,
      contenido: ARCHIVO_VALIDO,
    });

    expect(resultado).toEqual({ ok: false, code: "rate-limited" });
    expect(mocks.limit).toHaveBeenCalledWith(`mensaje:${USER_ID}`, 120, 3_600_000);
  });

  it("una conversación que no está aceptada no recibe fotos", async () => {
    const stub = crearStub({
      single: {
        conversations: {
          data: { ...CONVERSACION_ACEPTADA.data, status: "pending" },
        },
      },
    });
    guardOk(stub);

    const resultado = await enviarAdjuntoAction({
      destino: DESTINO_DIRECTO,
      contenido: ARCHIVO_VALIDO,
    });

    expect(resultado).toEqual({ ok: false, code: "forbidden" });
    expect(insertDe(stub, "messages")).toBeUndefined();
  });

  it("el pie de foto pasa por la misma moderación que un mensaje", async () => {
    const stub = crearStub({ single: { conversations: CONVERSACION_ACEPTADA } });
    guardOk(stub);
    mocks.moderateText.mockResolvedValue({
      flagged: true,
      categories: ["harassment"],
      score: 1,
      skipped: false,
    });

    const resultado = await enviarAdjuntoAction({
      destino: DESTINO_DIRECTO,
      contenido: { ...ARCHIVO_VALIDO, pie: "algo feo" },
    });

    expect(resultado).toEqual({ ok: false, code: "flagged" });
    expect(insertDe(stub, "messages")).toBeUndefined();
  });

  it("sin pie no se llama a moderar (no hay texto que moderar)", async () => {
    const stub = crearStub({ single: { conversations: CONVERSACION_ACEPTADA } });
    guardOk(stub);

    await enviarAdjuntoAction({ destino: DESTINO_DIRECTO, contenido: ARCHIVO_VALIDO });

    expect(mocks.moderateText).not.toHaveBeenCalled();
  });
});

describe("enviarAdjuntoAction — lo que se guarda", () => {
  it("guarda el mensaje con el tenant y el autor del JWT, y el kind del mime", async () => {
    const stub = crearStub({ single: { conversations: CONVERSACION_ACEPTADA } });
    guardOk(stub);

    const resultado = await enviarAdjuntoAction({
      destino: DESTINO_DIRECTO,
      contenido: { ...ARCHIVO_VALIDO, nombre: "playa.jpg", ancho: 1600, alto: 900 },
    });

    expect(resultado).toEqual({ ok: true });
    expect(insertDe(stub, "messages")).toMatchObject({
      tenant_id: TENANT_ID,
      sender_id: USER_ID,
      conversation_id: CONV_ID,
      kind: "imagen",
      body: "",
      ubicacion: null,
      compartido_kind: null,
      adjunto: {
        path: RUTA_PROPIA,
        mime: "image/jpeg",
        bytes: 400_000,
        nombre: "playa.jpg",
        ancho: 1600,
        alto: 900,
      },
    });
  });

  it("el mime se guarda PELADO aunque llegue con el codec de MediaRecorder", async () => {
    const stub = crearStub({ single: { conversations: CONVERSACION_ACEPTADA } });
    guardOk(stub);

    await enviarAdjuntoAction({
      destino: DESTINO_DIRECTO,
      contenido: {
        tipo: "archivo",
        path: `${TENANT_ID}/${USER_ID}/chat-${UUID}.webm`,
        mime: "audio/webm;codecs=opus",
        bytes: 30_000,
        duracion_ms: 7_400,
        onda: [0, 50, 100],
      },
    });

    const fila = insertDe(stub, "messages");
    expect(fila).toMatchObject({ kind: "audio" });
    expect((fila?.adjunto as { mime: string }).mime).toBe("audio/webm");
    expect((fila?.adjunto as { onda: number[] }).onda).toEqual([0, 50, 100]);
    expect((fila?.adjunto as { duracion_ms: number }).duracion_ms).toBe(7_400);
  });

  it('"Mi perfil" sólo puede ser el propio: el id sale del JWT', async () => {
    const stub = crearStub({ single: { conversations: CONVERSACION_ACEPTADA } });
    guardOk(stub);

    // Un cliente modificado manda además el id de otra persona: se ignora.
    const resultado = await enviarAdjuntoAction({
      destino: DESTINO_DIRECTO,
      contenido: { tipo: "perfil", compartido_id: OTRO_ID } as never,
    });

    expect(resultado).toEqual({ ok: true });
    expect(insertDe(stub, "messages")).toMatchObject({
      kind: "perfil",
      compartido_kind: "profile",
      compartido_id: USER_ID,
      adjunto: null,
    });
  });

  it("la ubicación se redondea: se manda un punto, no la posición exacta", async () => {
    const stub = crearStub({ single: { conversations: CONVERSACION_ACEPTADA } });
    guardOk(stub);

    await enviarAdjuntoAction({
      destino: DESTINO_DIRECTO,
      contenido: {
        tipo: "ubicacion",
        lat: 25.7616798123,
        lng: -80.1917902456,
        etiqueta: "  La plaza  ",
      },
    });

    expect(insertDe(stub, "messages")).toMatchObject({
      kind: "ubicacion",
      adjunto: null,
      ubicacion: { lat: 25.7617, lng: -80.1918, etiqueta: "La plaza" },
    });
  });

  it("una coordenada imposible ni sale de la app", async () => {
    const stub = crearStub({ single: { conversations: CONVERSACION_ACEPTADA } });
    guardOk(stub);

    const resultado = await enviarAdjuntoAction({
      destino: DESTINO_DIRECTO,
      contenido: { tipo: "ubicacion", lat: 120, lng: 0 },
    });

    expect(resultado).toEqual({ ok: false, code: "invalid" });
    expect(mocks.requireTenantMatch).not.toHaveBeenCalled();
  });

  it("en un grupo escribe en chat_group_messages con el group_id", async () => {
    const stub = crearStub();
    guardOk(stub);

    const resultado = await enviarAdjuntoAction({
      destino: { tipo: "grupo", groupId: GROUP_ID },
      contenido: ARCHIVO_VALIDO,
    });

    expect(resultado).toEqual({ ok: true });
    expect(insertDe(stub, "chat_group_messages")).toMatchObject({
      tenant_id: TENANT_ID,
      sender_id: USER_ID,
      group_id: GROUP_ID,
      kind: "imagen",
    });
  });

  it("traduce el 42501 de la RLS a un 'no' que la pantalla entiende", async () => {
    const stub = crearStub({
      terminal: { chat_group_messages: { error: { code: "42501" } } },
    });
    guardOk(stub);

    const resultado = await enviarAdjuntoAction({
      destino: { tipo: "grupo", groupId: GROUP_ID },
      contenido: ARCHIVO_VALIDO,
    });

    expect(resultado).toEqual({ ok: false, code: "forbidden" });
  });

  it("un destino que no es un uuid corta antes del guard", async () => {
    const resultado = await enviarAdjuntoAction({
      destino: { tipo: "directo", conversationId: "no-soy-un-uuid" },
      contenido: ARCHIVO_VALIDO,
    });

    expect(resultado).toEqual({ ok: false, code: "invalid" });
    expect(mocks.requireTenantMatch).not.toHaveBeenCalled();
  });
});

/* ---------------------------- firmarAdjuntosAction ------------------------ */

describe("firmarAdjuntosAction", () => {
  it("firma con el cliente del USUARIO: la policy de la 0140 es la que decide", async () => {
    const stub = crearStub({
      firmas: { data: [{ path: RUTA_PROPIA, signedUrl: "https://x/firmada" }], error: null },
    });
    guardOk(stub);

    const resultado = await firmarAdjuntosAction({ paths: [RUTA_PROPIA] });

    expect(resultado).toEqual({ ok: true, urls: { [RUTA_PROPIA]: "https://x/firmada" } });
    expect(stub.storageFrom).toHaveBeenCalledWith("chat-media");
  });

  it("pide TODAS las firmas en un solo viaje (nada de N+1)", async () => {
    const stub = crearStub({ firmas: { data: [], error: null } });
    guardOk(stub);

    await firmarAdjuntosAction({ paths: [RUTA_PROPIA, RUTA_AJENA] });

    expect(stub.createSignedUrls).toHaveBeenCalledTimes(1);
    expect(stub.createSignedUrls.mock.calls[0][0]).toEqual([RUTA_PROPIA, RUTA_AJENA]);
  });

  it("no repite un path que vino dos veces", async () => {
    const stub = crearStub({ firmas: { data: [], error: null } });
    guardOk(stub);

    await firmarAdjuntosAction({ paths: [RUTA_PROPIA, RUTA_PROPIA] });

    expect(stub.createSignedUrls.mock.calls[0][0]).toEqual([RUTA_PROPIA]);
  });

  it("un path que la RLS no deja ver se omite, no rompe el resto", async () => {
    const stub = crearStub({
      firmas: {
        data: [
          { path: RUTA_PROPIA, signedUrl: "https://x/firmada" },
          { path: RUTA_AJENA, signedUrl: null, error: "Object not found" },
        ],
        error: null,
      },
    });
    guardOk(stub);

    const resultado = await firmarAdjuntosAction({
      paths: [RUTA_PROPIA, RUTA_AJENA],
    });

    expect(resultado).toEqual({ ok: true, urls: { [RUTA_PROPIA]: "https://x/firmada" } });
  });

  it("sin sesión no firma nada", async () => {
    mocks.requireTenantMatch.mockResolvedValue({
      ok: false,
      reason: "unauthenticated",
      tenant: { id: TENANT_ID },
      supabase: {},
      user: null,
    });

    expect(await firmarAdjuntosAction({ paths: [RUTA_PROPIA] })).toEqual({
      ok: false,
      code: "unauthenticated",
    });
  });

  it("una lista vacía no llega a Storage", async () => {
    expect(await firmarAdjuntosAction({ paths: [] })).toEqual({
      ok: false,
      code: "invalid",
    });
    expect(mocks.requireTenantMatch).not.toHaveBeenCalled();
  });
});
