import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ userId: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({ getAuthUserId: mocks.userId }));

import { POST } from "./route";

const CALL = "01a10f43-624e-7a3e-8318-f13ca303ebc6";

function pedido(cuerpo: unknown) {
  return new Request("https://x.test/api/llamadas/diagnostico", {
    method: "POST",
    body: JSON.stringify(cuerpo),
  });
}

beforeEach(() => {
  mocks.userId.mockResolvedValue("369cf1aa-0000-4000-8000-000000000000");
});

afterEach(() => vi.restoreAllMocks());

describe("POST /api/llamadas/diagnostico", () => {
  it("deja la etapa y el código en el log, sin el id completo de la persona", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const respuesta = await POST(
      pedido({ callId: CALL, etapa: "join", codigo: "timeout", ms: 20000 }),
    );

    expect(respuesta.status).toBe(204);
    const registro = JSON.stringify(warn.mock.calls);
    expect(registro).toContain("join");
    expect(registro).toContain("timeout");
    expect(registro).not.toContain("369cf1aa-0000");
  });

  it("sin sesión no escribe nada", async () => {
    mocks.userId.mockResolvedValue(null);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const respuesta = await POST(pedido({ callId: CALL, etapa: "join" }));

    expect(respuesta.status).toBe(401);
    expect(warn).not.toHaveBeenCalled();
  });

  it("rechaza una etapa inventada", async () => {
    const respuesta = await POST(pedido({ callId: CALL, etapa: "lo-que-sea" }));

    expect(respuesta.status).toBe(400);
  });
});
