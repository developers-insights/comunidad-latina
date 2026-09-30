import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireTenantMatch: vi.fn(),
  revalidatePath: vi.fn(),
  avisarAceptacion: vi.fn(async () => undefined),
}));

vi.mock("@/lib/tenant/guard", () => ({ requireTenantMatch: mocks.requireTenantMatch }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/notifications/solicitud-server", () => ({
  avisarAceptacion: mocks.avisarAceptacion,
}));

import { responderSolicitudAction } from "./solicitud-actions";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const YO = "99999999-9999-4999-8999-999999999999";
const OTRO = "88888888-8888-4888-8888-888888888888";
const CONV = "55555555-5555-4555-8555-555555555555";
const AVISO = "66666666-6666-4666-8666-666666666666";

type Conversacion = {
  id: string;
  tenant_id: string;
  status: string;
  created_by: string;
  counterpart_id: string;
} | null;

function stub(opciones: {
  conversacion: Conversacion;
  rpcError?: { message: string } | null;
  updateError?: { message: string } | null;
}) {
  const updates: { table: string; values: unknown; filtros: [string, unknown][] }[] = [];
  const rpc = vi.fn(async () => ({ data: null, error: opciones.rpcError ?? null }));

  const from = vi.fn((table: string) => {
    const filtros: [string, unknown][] = [];
    let values: unknown = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = {
      select: () => builder,
      update: (v: unknown) => {
        values = v;
        return builder;
      },
      eq: (col: string, val: unknown) => {
        filtros.push([col, val]);
        return builder;
      },
      is: (col: string, val: unknown) => {
        filtros.push([col, val]);
        return builder;
      },
      maybeSingle: async () => ({ data: opciones.conversacion, error: null }),
      then: (resolve: (r: unknown) => void) => {
        updates.push({ table, values, filtros });
        resolve({
          data: table === "conversations" ? [{ id: CONV }] : null,
          error: table === "conversations" ? (opciones.updateError ?? null) : null,
        });
      },
    };
    return builder;
  });

  mocks.requireTenantMatch.mockResolvedValue({
    ok: true,
    tenant: { id: TENANT_ID },
    supabase: { rpc, from },
    user: { id: YO },
  });
  return { rpc, updates };
}

const pendiente = {
  id: CONV,
  tenant_id: TENANT_ID,
  status: "pending",
  created_by: OTRO,
  counterpart_id: YO,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("responderSolicitudAction", () => {
  it("confirmar acepta, avisa a quien la mandó y marca el aviso leído", async () => {
    const { rpc, updates } = stub({ conversacion: pendiente });

    const r = await responderSolicitudAction({
      notificationId: AVISO,
      conversationId: CONV,
      decision: "confirmar",
    });

    expect(r).toEqual({ ok: true, estado: "aceptada" });
    expect(rpc).toHaveBeenCalledWith("accept_conversation", { p_conversation_id: CONV });
    expect(mocks.avisarAceptacion).toHaveBeenCalledWith(expect.anything(), {
      userId: YO,
      tenantId: TENANT_ID,
      solicitanteId: OTRO,
      conversationId: CONV,
    });
    const leida = updates.find((u) => u.table === "notifications");
    expect(leida?.filtros).toContainEqual(["id", AVISO]);
  });

  it("confirmar dos veces no vuelve a aceptar ni a avisar", async () => {
    const { rpc } = stub({ conversacion: { ...pendiente, status: "accepted" } });

    const r = await responderSolicitudAction({
      notificationId: AVISO,
      conversationId: CONV,
      decision: "confirmar",
    });

    expect(r).toEqual({ ok: true, estado: "aceptada" });
    expect(rpc).not.toHaveBeenCalled();
    expect(mocks.avisarAceptacion).not.toHaveBeenCalled();
  });

  it("eliminar pasa la conversación a blocked sólo si seguía pendiente", async () => {
    const { updates } = stub({ conversacion: pendiente });

    const r = await responderSolicitudAction({
      notificationId: AVISO,
      conversationId: CONV,
      decision: "eliminar",
    });

    expect(r).toEqual({ ok: true, estado: "eliminada" });
    const cambio = updates.find((u) => u.table === "conversations");
    expect(cambio?.values).toEqual({ status: "blocked" });
    expect(cambio?.filtros).toContainEqual(["status", "pending"]);
    expect(mocks.avisarAceptacion).not.toHaveBeenCalled();
  });

  it("eliminar una ya eliminada es idempotente", async () => {
    const { updates } = stub({ conversacion: { ...pendiente, status: "blocked" } });

    const r = await responderSolicitudAction({
      notificationId: AVISO,
      conversationId: CONV,
      decision: "eliminar",
    });

    expect(r).toEqual({ ok: true, estado: "eliminada" });
    expect(updates.some((u) => u.table === "conversations")).toBe(false);
  });

  it("no se puede eliminar una solicitud que ya se aceptó", async () => {
    stub({ conversacion: { ...pendiente, status: "accepted" } });

    const r = await responderSolicitudAction({
      notificationId: AVISO,
      conversationId: CONV,
      decision: "eliminar",
    });

    expect(r).toEqual({ ok: false, code: "ya_resuelta", estado: "aceptada" });
  });

  it("confirmar una solicitud eliminada contesta ya_resuelta", async () => {
    const { rpc } = stub({ conversacion: { ...pendiente, status: "blocked" } });

    const r = await responderSolicitudAction({
      notificationId: AVISO,
      conversationId: CONV,
      decision: "confirmar",
    });

    expect(r).toEqual({ ok: false, code: "ya_resuelta", estado: "eliminada" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("quien mandó la solicitud no puede responderla", async () => {
    stub({ conversacion: { ...pendiente, created_by: YO, counterpart_id: OTRO } });

    const r = await responderSolicitudAction({
      notificationId: AVISO,
      conversationId: CONV,
      decision: "confirmar",
    });

    expect(r).toEqual({ ok: false, code: "no_disponible" });
  });

  it("una conversación que no se ve (cancelada o de otra comunidad) no está disponible", async () => {
    stub({ conversacion: null });

    const r = await responderSolicitudAction({
      notificationId: AVISO,
      conversationId: CONV,
      decision: "confirmar",
    });

    expect(r).toEqual({ ok: false, code: "no_disponible" });
  });

  it("si la RPC falla devuelve error y no avisa", async () => {
    stub({ conversacion: pendiente, rpcError: { message: "boom" } });

    const r = await responderSolicitudAction({
      notificationId: AVISO,
      conversationId: CONV,
      decision: "confirmar",
    });

    expect(r).toEqual({ ok: false, code: "error" });
    expect(mocks.avisarAceptacion).not.toHaveBeenCalled();
  });

  it("valida la entrada antes de tocar la sesión", async () => {
    const r = await responderSolicitudAction({
      notificationId: "x",
      conversationId: CONV,
      decision: "confirmar",
    });
    expect(r).toEqual({ ok: false, code: "invalid" });
    expect(mocks.requireTenantMatch).not.toHaveBeenCalled();
  });

  it("sin sesión contesta unauthenticated", async () => {
    mocks.requireTenantMatch.mockResolvedValue({ ok: false, reason: "unauthenticated" });
    const r = await responderSolicitudAction({
      notificationId: AVISO,
      conversationId: CONV,
      decision: "eliminar",
    });
    expect(r).toEqual({ ok: false, code: "unauthenticated" });
  });
});
