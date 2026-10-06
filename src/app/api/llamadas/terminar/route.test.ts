import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ terminar: vi.fn() }));

vi.mock("@/app/(app)/llamadas/actions", () => ({ terminarLlamadaAction: mocks.terminar }));

import { POST } from "./route";

const CALL = "01a10f43-624e-7a3e-8318-f13ca303ebc6";

function beacon(cuerpo: string) {
  return new Request("https://x.test/api/llamadas/terminar", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: cuerpo,
  });
}

beforeEach(() => {
  mocks.terminar.mockReset();
  mocks.terminar.mockResolvedValue({ ok: true, callId: CALL });
});

describe("POST /api/llamadas/terminar", () => {
  it("cuelga con la misma acción que el botón Finalizar", async () => {
    const respuesta = await POST(beacon(JSON.stringify({ callId: CALL })));

    expect(respuesta.status).toBe(204);
    expect(mocks.terminar).toHaveBeenCalledWith({ callId: CALL });
  });

  it("rechaza un cuerpo que no es una llamada sin tocar la base", async () => {
    const respuesta = await POST(beacon("no es json"));

    expect(respuesta.status).toBe(400);
    expect(mocks.terminar).not.toHaveBeenCalled();
  });

  it("rechaza un id que no es uuid", async () => {
    const respuesta = await POST(beacon(JSON.stringify({ callId: "x" })));

    expect(respuesta.status).toBe(400);
    expect(mocks.terminar).not.toHaveBeenCalled();
  });
});
