import { beforeEach, describe, expect, it, vi } from "vitest";

const getTenant = vi.hoisted(() => vi.fn());
const rpc = vi.hoisted(() => vi.fn());
const createAdminClient = vi.hoisted(() => vi.fn());

vi.mock("@/lib/tenant/resolve", () => ({ getTenant }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));

import { perfilesDeVisitante, puntajesDeVisitante } from "./visitante";

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  getTenant.mockReset().mockResolvedValue({ id: "tenant-del-dominio", isFallback: false });
  rpc.mockReset().mockResolvedValue({ data: [{ id: "a" }], error: null });
  createAdminClient.mockReset().mockReturnValue({ rpc });
});

describe("lectura de autores sin sesión", () => {
  it("la comunidad sale del dominio, no de quien pregunta", async () => {
    const { data } = await perfilesDeVisitante(["a"]);

    expect(rpc).toHaveBeenCalledWith("perfiles_visitante", {
      p_tenant: "tenant-del-dominio",
      p_ids: ["a"],
    });
    expect(data).toEqual([{ id: "a" }]);
  });

  it("los puntajes también", async () => {
    await puntajesDeVisitante(["a"]);

    expect(rpc).toHaveBeenCalledWith("puntajes_visitante", {
      p_tenant: "tenant-del-dominio",
      p_ids: ["a"],
    });
  });

  it("con el tenant de respaldo no hay comunidad y no pregunta nada", async () => {
    getTenant.mockResolvedValue({ id: "placeholder", isFallback: true });

    expect(await perfilesDeVisitante(["a"])).toEqual({ data: [], error: null });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("devuelve un error serializable, porque también responde al navegador", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: Object.assign(new Error("falló"), { code: "42501" }),
    });

    expect(await puntajesDeVisitante(["a"])).toEqual({
      data: [],
      error: { code: "42501", message: "falló" },
    });
  });

  it("sin service role la página se ve sin autores, no se cae", async () => {
    createAdminClient.mockImplementation(() => {
      throw new Error("sin key");
    });

    expect(await perfilesDeVisitante(["a"])).toEqual({
      data: [],
      error: { code: "sin_admin", message: "sin key" },
    });
  });
});
