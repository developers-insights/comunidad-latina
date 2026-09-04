import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests del CONTACTO DIRECTO persona → persona (0134).
 *
 * Lo que estos tests protegen no es "que funcione": es que los tres "no"
 * posibles —bloqueaste a esa persona, esa persona te ignoró, ese perfil no
 * existe en tu comunidad— salgan de acá con LA MISMA respuesta. Si alguna vez
 * se separan, el buscador de la bandeja pasa a ser una forma de averiguar
 * quién te bloqueó probando nombres, que es exactamente lo que la RPC de la
 * 0134 se propuso evitar.
 */

const mocks = vi.hoisted(() => ({
  requireTenantMatch: vi.fn(),
  revalidatePath: vi.fn(),
  limit: vi.fn(() => ({ ok: true, remaining: 10, retryAfterMs: 0 })),
}));

vi.mock("@/lib/tenant/guard", () => ({ requireTenantMatch: mocks.requireTenantMatch }));
vi.mock("@/lib/rate-limit", () => ({
  limit: mocks.limit,
  HOUR_MS: 3_600_000,
  DAY_MS: 86_400_000,
}));
vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
  unstable_cache: (fn: unknown) => fn,
}));

import { abrirChatDirectoAction } from "./direct-actions";

const USER_ID = "99999999-9999-4999-8999-999999999999";
const OTRO_ID = "88888888-8888-4888-8888-888888888888";
const CONVERSATION_ID = "55555555-5555-4555-8555-555555555555";

function stubConRpc(respuesta: { data?: unknown; error?: { message: string; code?: string } }) {
  const rpc = vi.fn(async () => respuesta);
  mocks.requireTenantMatch.mockResolvedValue({
    ok: true,
    tenant: { id: "11111111-1111-4111-8111-111111111111" },
    supabase: { rpc, from: vi.fn() },
    user: { id: USER_ID },
  });
  return rpc;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.limit.mockReturnValue({ ok: true, remaining: 10, retryAfterMs: 0 });
});

describe("abrirChatDirectoAction", () => {
  it("devuelve la conversación y la manda a revalidar la bandeja", async () => {
    const rpc = stubConRpc({ data: CONVERSATION_ID });

    const resultado = await abrirChatDirectoAction({ profileId: OTRO_ID });

    expect(resultado).toEqual({ ok: true, conversationId: CONVERSATION_ID });
    expect(rpc).toHaveBeenCalledWith("solicitar_contacto_directo", {
      p_profile_id: OTRO_ID,
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/mensajes");
  });

  it("un id que no es uuid no llega ni al guard", async () => {
    await expect(
      abrirChatDirectoAction({ profileId: "manuel-navarro" }),
    ).resolves.toEqual({ ok: false, code: "invalid" });
    expect(mocks.requireTenantMatch).not.toHaveBeenCalled();
  });

  it("bloqueo de perfil y perfil inexistente contestan LO MISMO", async () => {
    const bloqueado = await (async () => {
      stubConRpc({ error: { message: "USER_BLOCKED: el contacto no está disponible." } });
      return abrirChatDirectoAction({ profileId: OTRO_ID });
    })();

    const inexistente = await (async () => {
      stubConRpc({ error: { message: "PROFILE_NOT_FOUND: no está en tu comunidad." } });
      return abrirChatDirectoAction({ profileId: OTRO_ID });
    })();

    expect(bloqueado).toEqual({ ok: false, code: "blocked" });
    expect(inexistente).toEqual(bloqueado);
  });

  it("escribirse a uno mismo tiene su propio código, no un error genérico", async () => {
    stubConRpc({ error: { message: "CANNOT_CONTACT_SELF: es tu propio perfil." } });

    await expect(abrirChatDirectoAction({ profileId: OTRO_ID })).resolves.toEqual({
      ok: false,
      code: "self",
    });
  });

  it("un código desconocido del RPC no se filtra a la pantalla: cae en 'error'", async () => {
    stubConRpc({ error: { message: "ALGO_RARO: detalle interno del motor" } });

    await expect(abrirChatDirectoAction({ profileId: OTRO_ID })).resolves.toEqual({
      ok: false,
      code: "error",
    });
  });

  it("tiene techo propio: abrir conversaciones no gasta el cupo de mensajes", async () => {
    stubConRpc({ data: CONVERSATION_ID });

    await abrirChatDirectoAction({ profileId: OTRO_ID });

    expect(mocks.limit).toHaveBeenCalledWith(`contacto-directo:${USER_ID}`, 40, 3_600_000);
  });

  it("con el techo agotado no se llama al RPC", async () => {
    const rpc = stubConRpc({ data: CONVERSATION_ID });
    mocks.limit.mockReturnValue({ ok: false, remaining: 0, retryAfterMs: 5000 });

    await expect(abrirChatDirectoAction({ profileId: OTRO_ID })).resolves.toEqual({
      ok: false,
      code: "rate-limited",
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("sin sesión no se crea nada", async () => {
    mocks.requireTenantMatch.mockResolvedValue({
      ok: false,
      reason: "unauthenticated",
      message: "Entrá para continuar",
    });

    await expect(abrirChatDirectoAction({ profileId: OTRO_ID })).resolves.toEqual({
      ok: false,
      code: "unauthenticated",
    });
  });
});
