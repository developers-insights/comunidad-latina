import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests de `POST /api/llamadas/token`.
 *
 * Este endpoint ES la cerradura del módulo: el canal aleatorio de la 0139 y la
 * RLS no sirven de nada si acá se firma un token para cualquiera que traiga un
 * id. Lo que se afirma, en orden de importancia:
 *
 *  1. QUIEN NO ES PARTICIPANTE NO RECIBE TOKEN, y ni siquiera se llega a firmar
 *     uno — el builder no se llama.
 *  2. El `uid` que se firma sale de LA SESIÓN, no del body. Un pedido que
 *     intente elegir su uid o su canal no cambia nada.
 *  3. Una llamada terminada no emite token: cada emisión es la revalidación de
 *     que la llamada sigue viva, y cada minuto de canal se factura.
 *  4. El token vence en MINUTOS.
 *
 * ⚠️ Acá no hay ni un certificado real: `token-de-agora` está mockeado entero,
 * así que este archivo no necesita —ni tiene— una credencial de Agora.
 */

const mocks = vi.hoisted(() => ({
  requireTenantMatch: vi.fn(),
  limit: vi.fn(() => ({ ok: true, remaining: 10, retryAfterMs: 0 })),
  agoraEstaConfigurado: vi.fn(() => true),
  emitirTokenRtc: vi.fn(() => ({
    token: "token-firmado-de-mentira",
    appId: "app-id-de-prueba",
    expiraEn: Date.now() + 300_000,
  })),
}));

vi.mock("@/lib/tenant/guard", () => ({ requireTenantMatch: mocks.requireTenantMatch }));
vi.mock("@/lib/rate-limit", () => ({ limit: mocks.limit, HOUR_MS: 3_600_000 }));
vi.mock("@/lib/calls/token-de-agora", () => ({
  agoraEstaConfigurado: mocks.agoraEstaConfigurado,
  emitirTokenRtc: mocks.emitirTokenRtc,
  TOKEN_TTL_SEGUNDOS: 300,
}));

import { POST } from "./route";

const USER_ID = "99999999-9999-4999-8999-999999999999";
const CALL_ID = "11111111-1111-4111-8111-111111111111";
const CANAL_REAL = "a1b2c3d4-0000-4000-8000-000000000001";

interface Fila {
  data: unknown;
}

/**
 * Stub del cliente del usuario. Devuelve una fila distinta por tabla, que es lo
 * único que el handler consulta: `call_participants` (¿estás invitado?) y
 * `calls` (¿cuál es el canal y sigue viva?).
 */
function stubSupabase(filas: Record<string, Fila>) {
  const consultadas: string[] = [];
  const from = vi.fn((tabla: string) => {
    consultadas.push(tabla);
    const builder = {
      select: () => builder,
      eq: () => builder,
      maybeSingle: async () => filas[tabla] ?? { data: null },
    };
    return builder;
  });
  return { cliente: { from }, consultadas };
}

function guardOk(filas: Record<string, Fila>) {
  const { cliente, consultadas } = stubSupabase(filas);
  mocks.requireTenantMatch.mockResolvedValue({
    ok: true,
    tenant: { id: "22222222-2222-4222-8222-222222222222" },
    supabase: cliente,
    user: { id: USER_ID },
  });
  return consultadas;
}

function pedido(cuerpo: unknown) {
  return new Request("http://localhost/api/llamadas/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(cuerpo),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.limit.mockReturnValue({ ok: true, remaining: 10, retryAfterMs: 0 });
  mocks.agoraEstaConfigurado.mockReturnValue(true);
  mocks.emitirTokenRtc.mockReturnValue({
    token: "token-firmado-de-mentira",
    appId: "app-id-de-prueba",
    expiraEn: Date.now() + 300_000,
  });
});

describe("POST /api/llamadas/token", () => {
  it("le niega el token a quien no figura en call_participants, sin firmar nada", async () => {
    guardOk({ call_participants: { data: null } });

    const respuesta = await POST(pedido({ callId: CALL_ID }));

    expect(respuesta.status).toBe(403);
    await expect(respuesta.json()).resolves.toMatchObject({ error: "no_sos_participante" });
    expect(mocks.emitirTokenRtc).not.toHaveBeenCalled();
  });

  it("le niega el token a quien ya salió de la llamada (left_at no nulo), sin firmar nada", async () => {
    guardOk({
      call_participants: { data: { profile_id: USER_ID, left_at: "2026-09-08T20:00:00.000Z" } },
      calls: { data: { id: CALL_ID, canal: CANAL_REAL, status: "en_curso" } },
    });

    const respuesta = await POST(pedido({ callId: CALL_ID }));

    expect(respuesta.status).toBe(403);
    await expect(respuesta.json()).resolves.toMatchObject({ error: "no_sos_participante" });
    expect(mocks.emitirTokenRtc).not.toHaveBeenCalled();
  });

  it("firma con el uid de la sesión y el canal de la base, ignorando lo que venga en el body", async () => {
    guardOk({
      call_participants: { data: { profile_id: USER_ID, left_at: null } },
      calls: { data: { id: CALL_ID, canal: CANAL_REAL, status: "en_curso" } },
    });

    const respuesta = await POST(
      pedido({
        callId: CALL_ID,
        // Todo esto es ruido que el handler no lee. Si algún día lo leyera, este
        // test se cae y ese es exactamente su trabajo.
        canal: "canal-elegido-por-el-atacante",
        uid: "77777777-7777-4777-8777-777777777777",
        appId: "otro-app-id",
      }),
    );

    expect(respuesta.status).toBe(200);
    expect(mocks.emitirTokenRtc).toHaveBeenCalledWith({ canal: CANAL_REAL, uid: USER_ID });

    const cuerpo = await respuesta.json();
    expect(cuerpo.canal).toBe(CANAL_REAL);
    expect(cuerpo.uid).toBe(USER_ID);
    expect(respuesta.headers.get("cache-control")).toBe("no-store");
  });

  it("consulta la pertenencia ANTES de mirar la llamada", async () => {
    const consultadas = guardOk({
      call_participants: { data: { profile_id: USER_ID, left_at: null } },
      calls: { data: { id: CALL_ID, canal: CANAL_REAL, status: "sonando" } },
    });

    await POST(pedido({ callId: CALL_ID }));

    expect(consultadas[0]).toBe("call_participants");
    expect(consultadas).toContain("calls");
  });

  it("no emite token para una llamada que ya terminó", async () => {
    guardOk({
      call_participants: { data: { profile_id: USER_ID, left_at: null } },
      calls: { data: { id: CALL_ID, canal: CANAL_REAL, status: "terminada" } },
    });

    const respuesta = await POST(pedido({ callId: CALL_ID }));

    expect(respuesta.status).toBe(409);
    await expect(respuesta.json()).resolves.toMatchObject({ error: "llamada_terminada" });
    expect(mocks.emitirTokenRtc).not.toHaveBeenCalled();
  });

  it("el token que devuelve vence en minutos, no en horas", async () => {
    guardOk({
      call_participants: { data: { profile_id: USER_ID, left_at: null } },
      calls: { data: { id: CALL_ID, canal: CANAL_REAL, status: "en_curso" } },
    });

    const respuesta = await POST(pedido({ callId: CALL_ID }));
    const cuerpo = await respuesta.json();

    const faltan = cuerpo.expiraEn - Date.now();
    expect(faltan).toBeGreaterThan(0);
    expect(faltan).toBeLessThanOrEqual(10 * 60 * 1000);
    expect(cuerpo.ttlSegundos).toBeLessThanOrEqual(600);
  });

  it("sin sesión contesta 401 y no toca la base", async () => {
    mocks.requireTenantMatch.mockResolvedValue({
      ok: false,
      reason: "unauthenticated",
      message: "Entrá a tu cuenta.",
    });

    const respuesta = await POST(pedido({ callId: CALL_ID }));

    expect(respuesta.status).toBe(401);
    expect(mocks.emitirTokenRtc).not.toHaveBeenCalled();
  });

  it("sin Agora configurado contesta 503 sin consumir cupo ni tocar la sesión", async () => {
    mocks.agoraEstaConfigurado.mockReturnValue(false);

    const respuesta = await POST(pedido({ callId: CALL_ID }));

    expect(respuesta.status).toBe(503);
    expect(mocks.requireTenantMatch).not.toHaveBeenCalled();
    expect(mocks.limit).not.toHaveBeenCalled();
  });

  it("rechaza un callId que no es un uuid", async () => {
    guardOk({});

    const respuesta = await POST(pedido({ callId: "no-soy-un-uuid" }));

    expect(respuesta.status).toBe(400);
    expect(mocks.emitirTokenRtc).not.toHaveBeenCalled();
  });
});
