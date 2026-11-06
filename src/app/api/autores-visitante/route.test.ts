import { beforeEach, describe, expect, it, vi } from "vitest";

const perfilesDeVisitante = vi.hoisted(() => vi.fn());
const puntajesDeVisitante = vi.hoisted(() => vi.fn());
const limit = vi.hoisted(() => vi.fn());

vi.mock("@/lib/perfiles/visitante", () => ({ perfilesDeVisitante, puntajesDeVisitante }));
vi.mock("@/lib/rate-limit", () => ({ limit, clientIpFromHeaders: () => "1.2.3.4" }));

import { POST } from "./route";

const ID = "019f39cf-5115-70bf-8a9e-8db074bf07d6";

function pedido(cuerpo: unknown) {
  return new Request("https://dominicanos.com/api/autores-visitante", {
    method: "POST",
    body: typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo),
  });
}

beforeEach(() => {
  limit.mockReset().mockReturnValue({ ok: true });
  perfilesDeVisitante.mockReset().mockResolvedValue({ data: [{ id: ID }], error: null });
  puntajesDeVisitante.mockReset().mockResolvedValue({ data: [{ profile_id: ID }], error: null });
});

describe("POST /api/autores-visitante", () => {
  it("devuelve los perfiles", async () => {
    const respuesta = await POST(pedido({ tipo: "perfiles", ids: [ID] }));

    expect(respuesta.status).toBe(200);
    expect(await respuesta.json()).toEqual({ data: [{ id: ID }], error: null });
    expect(perfilesDeVisitante).toHaveBeenCalledWith([ID]);
  });

  it("devuelve los puntajes", async () => {
    await POST(pedido({ tipo: "puntajes", ids: [ID] }));
    expect(puntajesDeVisitante).toHaveBeenCalledWith([ID]);
  });

  it("no acepta que le digan la comunidad", async () => {
    await POST(pedido({ tipo: "perfiles", ids: [ID], p_tenant: "otra" }));
    expect(perfilesDeVisitante).toHaveBeenCalledWith([ID]);
  });

  it.each([
    ["JSON roto", "{"],
    ["sin ids", { tipo: "perfiles", ids: [] }],
    ["ids que no son uuid", { tipo: "perfiles", ids: ["1 or 1=1"] }],
    ["más de 200 ids", { tipo: "perfiles", ids: Array(201).fill(ID) }],
    ["tipo desconocido", { tipo: "correos", ids: [ID] }],
  ])("rechaza %s", async (_caso, cuerpo) => {
    const respuesta = await POST(pedido(cuerpo));

    expect(respuesta.status).toBe(400);
    expect(perfilesDeVisitante).not.toHaveBeenCalled();
  });

  it("corta por IP antes de leer", async () => {
    limit.mockReturnValue({ ok: false });
    const respuesta = await POST(pedido({ tipo: "perfiles", ids: [ID] }));

    expect(respuesta.status).toBe(429);
    expect(perfilesDeVisitante).not.toHaveBeenCalled();
  });
});
