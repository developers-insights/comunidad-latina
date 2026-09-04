import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * =============================================================================
 * EL AVISO DE "TE RESPONDIERON EL PEDIDO" NO LLEVA EL TEXTO
 * =============================================================================
 *
 * Llevaba 120 caracteres del cuerpo de la respuesta, y era el ÚNICO aviso de la
 * app que lo hacía: el chat 1-a-1 y `avisarAlGrupo` mandan sólo "abrí para
 * leerlo", con el motivo escrito al lado («la bandeja se lee de costado en
 * pantallas compartidas»).
 *
 * Acá pesa más que allá: el tablón de pedidos es la superficie donde el
 * producto invita a dejar un teléfono o una dirección para que te contacten, y
 * un extracto de eso viaja al centro de notificaciones y a la pantalla de
 * bloqueo, donde lo lee cualquiera que esté al lado.
 *
 * Estos tests son la red de ese criterio. El primero es el importante: usa un
 * texto con un teléfono adentro y verifica que NADA de él salga en el aviso.
 */

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));

import { notifyHelpReply } from "./notify";

const TENANT = "019f39cf-5115-70bf-8a9e-8db074bf07d6";
const PEDIDO = "019f0000-0000-7000-8000-0000000000a1";
const AUTOR_DEL_PEDIDO = "de5520a5-2701-4617-a24d-0ecaeb5c0629";
const QUIEN_RESPONDE = "67a54dc8-35a9-4294-89bb-b325917e7a8d";

/** El caso real: alguien contesta un pedido dejando su número. */
const RESPUESTA_CON_TELEFONO =
  "Yo tengo una silla de ruedas que no uso, te la presto. Llamame al 917-555-0142 " +
  "o pasá por Roosevelt 4021, apartamento 3B, después de las seis.";

function adminStub(displayName: string | null = "Rosanna") {
  const rpcCalls: { nombre: string; args: Record<string, unknown> }[] = [];
  const client = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: displayName === null ? null : { display_name: displayName },
            error: null,
          }),
        }),
      }),
    }),
    rpc: async (nombre: string, args: Record<string, unknown>) => {
      rpcCalls.push({ nombre, args });
      return { data: null, error: null };
    },
  };
  return { client, rpcCalls };
}

const ENTRADA = {
  tenantId: TENANT,
  noticeId: PEDIDO,
  noticeAuthorId: AUTOR_DEL_PEDIDO,
  actorId: QUIEN_RESPONDE,
  body: RESPUESTA_CON_TELEFONO,
  replyCount: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("notifyHelpReply", () => {
  it("el aviso NO lleva ni un pedazo del texto de la respuesta", async () => {
    const admin = adminStub();
    mocks.createAdminClient.mockReturnValue(admin.client);

    await notifyHelpReply(ENTRADA);

    expect(admin.rpcCalls).toHaveLength(1);
    const args = admin.rpcCalls[0].args;
    expect(args.p_body).toBeNull();

    // Ni el teléfono, ni la dirección, ni el arranque del texto: se comprueba
    // sobre TODO lo que viaja, no sólo sobre el cuerpo, porque un extracto que
    // se mudara al título sería exactamente el mismo problema.
    // Los fragmentos se eligen largos a propósito: un "917" suelto matchea
    // dentro de cualquier uuid y el test daría rojo por su propio fixture.
    const todo = JSON.stringify(args);
    for (const dato of [
      "917-555-0142",
      "Roosevelt 4021",
      "apartamento 3B",
      "silla de ruedas",
      "después de las seis",
    ]) {
      expect(todo).not.toContain(dato);
    }
  });

  it("el título sigue diciendo quién respondió: es lo que hace que se abra", async () => {
    const admin = adminStub("Rosanna");
    mocks.createAdminClient.mockReturnValue(admin.client);

    await notifyHelpReply(ENTRADA);

    expect(admin.rpcCalls[0].args.p_title).toBe("Rosanna respondió tu pedido");
    expect(admin.rpcCalls[0].args.p_href).toBe(`/comunidad/pedir-ayuda/${PEDIDO}`);
  });

  it("con varias respuestas agrupa, y tampoco ahí se cuela texto", async () => {
    const admin = adminStub("Rosanna");
    mocks.createAdminClient.mockReturnValue(admin.client);

    await notifyHelpReply({ ...ENTRADA, replyCount: 4 });

    const args = admin.rpcCalls[0].args;
    expect(String(args.p_title)).toContain("respondieron");
    expect(args.p_body).toBeNull();
  });

  it("no se auto-avisa: quien responde su propio pedido no gasta ni una consulta", async () => {
    const admin = adminStub();
    mocks.createAdminClient.mockReturnValue(admin.client);

    await notifyHelpReply({ ...ENTRADA, actorId: AUTOR_DEL_PEDIDO });

    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(admin.rpcCalls).toHaveLength(0);
  });

  it("sin nombre no se avisa: un aviso que dice 'Alguien' es peor que ninguno", async () => {
    const admin = adminStub(null);
    mocks.createAdminClient.mockReturnValue(admin.client);

    await notifyHelpReply(ENTRADA);

    expect(admin.rpcCalls).toHaveLength(0);
  });

  it("nunca lanza: una respuesta ya guardada no se desarma por un aviso", async () => {
    mocks.createAdminClient.mockImplementation(() => {
      throw new Error("sin service role");
    });

    await expect(notifyHelpReply(ENTRADA)).resolves.toBeUndefined();
  });
});
