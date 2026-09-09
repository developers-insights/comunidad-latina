import { beforeEach, describe, expect, it, vi } from "vitest";

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

interface SourceRow {
  kind: string;
  body: string;
  adjunto: Record<string, unknown> | null;
  ubicacion: Record<string, unknown> | null;
  compartido_kind: string | null;
  compartido_id: string | null;
  deleted_at: string | null;
}

function crearStub(source: SourceRow | null) {
  const insertados: { tabla: string; fila: Record<string, unknown> }[] = [];
  const consultas: { tabla: string; filtros: [string, unknown][] }[] = [];

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
  const supabase = { from, rpc };
  return { supabase, insertados, consultas, rpc };
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

const casos: { nombre: string; source: SourceRow }[] = [
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
});

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
            adjunto: caso.source.adjunto,
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
});
