import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireTenantMatch: vi.fn(),
  revalidatePath: vi.fn(),
  limit: vi.fn(() => ({ ok: true, remaining: 10, retryAfterMs: 0 })),
}));

vi.mock("@/lib/tenant/guard", () => ({ requireTenantMatch: mocks.requireTenantMatch }));
vi.mock("@/lib/rate-limit", () => ({ limit: mocks.limit, HOUR_MS: 3_600_000 }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { reenviarMensajeAction } from "./reenviar-mensaje-action";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "99999999-9999-4999-8999-999999999999";
const MENSAJE_ID = "55555555-5555-4555-8555-555555555555";
const HILO_ID = "33333333-3333-4333-8333-333333333333";
const GRUPO_ID = "22222222-2222-4222-8222-222222222222";
const PERSONA_ID = "88888888-8888-4888-8888-888888888888";
const DESTINO_HILO_ID = "77777777-7777-4777-8777-777777777777";
const COMPARTIDO_ID = "44444444-4444-4444-8444-444444444444";
const NUEVO_UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NUEVO_PATH_IMAGEN = `${TENANT_ID}/${USER_ID}/chat-${NUEVO_UUID}.jpg`;
const NUEVO_PATH_WEBM = `${TENANT_ID}/${USER_ID}/chat-${NUEVO_UUID}.webm`;
const NUEVO_PATH_PDF = `${TENANT_ID}/${USER_ID}/chat-${NUEVO_UUID}.pdf`;

interface SourceRow {
  kind: string;
  body: string;
  adjunto: Record<string, unknown> | null;
  ubicacion: Record<string, unknown> | null;
  compartido_kind: string | null;
  compartido_id: string | null;
  deleted_at: string | null;
}

function crearStub(source: SourceRow | null, copyError: { message: string } | null = null) {
  const insertados: { tabla: string; fila: Record<string, unknown> }[] = [];
  const consultas: { tabla: string; filtros: [string, unknown][] }[] = [];
  const copy = vi.fn(async () => ({ data: copyError ? null : {}, error: copyError }));
  const storageFrom = vi.fn(() => ({ copy }));

  const from = vi.fn((tabla: string) => {
    const filtros: [string, unknown][] = [];
    const builder = {
      select: vi.fn(() => builder),
      eq: vi.fn((columna: string, valor: unknown) => {
        filtros.push([columna, valor]);
        return builder;
      }),
      is: vi.fn((columna: string, valor: unknown) => {
        filtros.push([columna, valor]);
        return builder;
      }),
      maybeSingle: vi.fn(async () => {
        consultas.push({ tabla, filtros });
        return { data: source, error: null };
      }),
      insert: vi.fn(async (fila: Record<string, unknown>) => {
        insertados.push({ tabla, fila });
        return { data: null, error: null };
      }),
    };
    return builder;
  });

  const rpc = vi.fn(async () => ({ data: DESTINO_HILO_ID, error: null }));
  const supabase = { from, rpc, storage: { from: storageFrom } };
  return { supabase, insertados, consultas, rpc, copy, storageFrom };
}

function guardOk(stub: ReturnType<typeof crearStub>) {
  mocks.requireTenantMatch.mockResolvedValue({
    ok: true,
    tenant: { id: TENANT_ID, slug: "comunidad", name: "Comunidad" },
    user: { id: USER_ID },
    supabase: stub.supabase,
  });
}

const base = {
  origen: { ambito: "directo" as const, mensajeId: MENSAJE_ID, hiloId: HILO_ID },
  destinos: [{ tipo: "grupo" as const, id: GRUPO_ID }],
};

const casos: { nombre: string; source: SourceRow; pathReenviado?: string }[] = [
  {
    nombre: "texto",
    source: {
      kind: "texto",
      body: "Hola",
      adjunto: null,
      ubicacion: null,
      compartido_kind: null,
      compartido_id: null,
      deleted_at: null,
    },
  },
  {
    nombre: "foto",
    pathReenviado: NUEVO_PATH_IMAGEN,
    source: {
      kind: "imagen",
      body: "Pie",
      adjunto: { path: `${TENANT_ID}/${PERSONA_ID}/chat-foto.jpg`, mime: "image/jpeg", bytes: 20 },
      ubicacion: null,
      compartido_kind: null,
      compartido_id: null,
      deleted_at: null,
    },
  },
  {
    nombre: "audio",
    pathReenviado: NUEVO_PATH_WEBM,
    source: {
      kind: "audio",
      body: "",
      adjunto: { path: `${TENANT_ID}/${PERSONA_ID}/chat-audio.webm`, mime: "audio/webm", bytes: 30, duracion_ms: 1200 },
      ubicacion: null,
      compartido_kind: null,
      compartido_id: null,
      deleted_at: null,
    },
  },
  {
    nombre: "archivo",
    pathReenviado: NUEVO_PATH_PDF,
    source: {
      kind: "archivo",
      body: "",
      adjunto: { path: `${TENANT_ID}/${PERSONA_ID}/chat-doc.pdf`, mime: "application/pdf", bytes: 40, nombre: "doc.pdf" },
      ubicacion: null,
      compartido_kind: null,
      compartido_id: null,
      deleted_at: null,
    },
  },
  {
    nombre: "ubicación",
    source: {
      kind: "ubicacion",
      body: "",
      adjunto: null,
      ubicacion: { lat: 25.7617, lng: -80.1918, etiqueta: "La plaza" },
      compartido_kind: null,
      compartido_id: null,
      deleted_at: null,
    },
  },
  {
    nombre: "perfil",
    source: {
      kind: "perfil",
      body: "",
      adjunto: null,
      ubicacion: null,
      compartido_kind: "profile",
      compartido_id: COMPARTIDO_ID,
      deleted_at: null,
    },
  },
  {
    nombre: "contenido compartido",
    source: {
      kind: "contenido",
      body: "Mirá esto",
      adjunto: null,
      ubicacion: null,
      compartido_kind: "post",
      compartido_id: COMPARTIDO_ID,
      deleted_at: null,
    },
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.limit.mockReturnValue({ ok: true, remaining: 10, retryAfterMs: 0 });
  vi.spyOn(crypto, "randomUUID").mockReturnValue(NUEVO_UUID);
});

afterEach(() => vi.restoreAllMocks());

describe("reenviar un mensaje sin confiar en su contenido del cliente", () => {
  for (const caso of casos) {
    it(`relee y conserva ${caso.nombre}`, async () => {
      const stub = crearStub(caso.source);
      guardOk(stub);

      const resultado = await reenviarMensajeAction(base);

      expect(resultado).toEqual({ ok: true, enviados: 1, fallidos: 0 });
      expect(stub.consultas[0]).toEqual({
        tabla: "messages",
        filtros: [
          ["id", MENSAJE_ID],
          ["conversation_id", HILO_ID],
          ["tenant_id", TENANT_ID],
          ["deleted_at", null],
        ],
      });
      expect(stub.insertados).toEqual([
        {
          tabla: "chat_group_messages",
          fila: {
            tenant_id: TENANT_ID,
            sender_id: USER_ID,
            group_id: GRUPO_ID,
            kind: caso.source.kind,
            body: caso.source.body,
            adjunto: caso.pathReenviado
              ? { ...caso.source.adjunto, path: caso.pathReenviado }
              : caso.source.adjunto,
            ubicacion: caso.source.ubicacion,
            compartido_kind: caso.source.compartido_kind,
            compartido_id: caso.source.compartido_id,
          },
        },
      ]);
    });
  }

  it("no reenvía un mensaje que la RLS no devuelve", async () => {
    const stub = crearStub(null);
    guardOk(stub);

    expect(await reenviarMensajeAction(base)).toEqual({ ok: false, code: "forbidden" });
    expect(stub.insertados).toHaveLength(0);
  });

  it("abre el destino directo con el RPC protegido", async () => {
    const stub = crearStub(casos[0].source);
    guardOk(stub);

    const resultado = await reenviarMensajeAction({
      ...base,
      origen: { ambito: "grupo", mensajeId: MENSAJE_ID, hiloId: GRUPO_ID },
      destinos: [{ tipo: "persona", id: PERSONA_ID }],
    });

    expect(resultado).toEqual({ ok: true, enviados: 1, fallidos: 0 });
    expect(stub.consultas[0].tabla).toBe("chat_group_messages");
    expect(stub.rpc).toHaveBeenCalledWith("solicitar_contacto_directo", {
      p_profile_id: PERSONA_ID,
    });
    expect(stub.insertados[0]).toMatchObject({
      tabla: "messages",
      fila: { conversation_id: DESTINO_HILO_ID, sender_id: USER_ID },
    });
  });

  it("copia el adjunto una vez y usa el nuevo path propio en todos los destinos", async () => {
    const source = casos[1].source;
    const stub = crearStub(source);
    guardOk(stub);

    const resultado = await reenviarMensajeAction({
      ...base,
      destinos: [
        { tipo: "grupo", id: GRUPO_ID },
        { tipo: "persona", id: PERSONA_ID },
      ],
    });

    expect(resultado).toEqual({ ok: true, enviados: 2, fallidos: 0 });
    expect(stub.storageFrom).toHaveBeenCalledWith("chat-media");
    expect(stub.copy).toHaveBeenCalledOnce();
    expect(stub.copy).toHaveBeenCalledWith(source.adjunto?.path, NUEVO_PATH_IMAGEN);
    expect(stub.insertados).toHaveLength(2);
    for (const { fila } of stub.insertados) {
      expect(fila.adjunto).toEqual({ ...source.adjunto, path: NUEVO_PATH_IMAGEN });
    }
  });

  it("no inserta ningún destino cuando falla la copia del adjunto", async () => {
    const stub = crearStub(casos[1].source, { message: "storage error" });
    guardOk(stub);

    const resultado = await reenviarMensajeAction({
      ...base,
      destinos: [
        { tipo: "grupo", id: GRUPO_ID },
        { tipo: "persona", id: PERSONA_ID },
      ],
    });

    expect(resultado).toEqual({ ok: false, code: "error" });
    expect(stub.insertados).toHaveLength(0);
  });
});
