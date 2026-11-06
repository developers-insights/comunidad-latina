import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const perfilesDeVisitante = vi.hoisted(() => vi.fn());
const puntajesDeVisitante = vi.hoisted(() => vi.fn());

vi.mock("./visitante", () => ({ perfilesDeVisitante, puntajesDeVisitante }));

import { perfilPublico, perfilesPublicos, puntajesPublicos } from "./publicos";

function cliente(session: object | null) {
  const fake = {
    rpc: vi.fn().mockResolvedValue({ data: [{ id: "con-sesion" }], error: null }),
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session } }) },
  };
  return fake as typeof fake & Parameters<typeof perfilesPublicos>[0];
}

beforeEach(() => {
  perfilesDeVisitante.mockReset().mockResolvedValue({ data: [{ id: "visitante" }], error: null });
  puntajesDeVisitante
    .mockReset()
    .mockResolvedValue({ data: [{ profile_id: "visitante" }], error: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("perfiles y puntajes públicos", () => {
  it("con sesión lee por la RPC, y la base aplica la regla del JWT", async () => {
    const supabase = cliente({ access_token: "x" });
    const { data } = await perfilesPublicos(supabase, ["a", "a", "b"]);

    expect(supabase.rpc).toHaveBeenCalledWith("perfiles_publicos", { p_ids: ["a", "b"] });
    expect(perfilesDeVisitante).not.toHaveBeenCalled();
    expect(data).toEqual([{ id: "con-sesion" }]);
  });

  it("sin sesión nunca toca la RPC abierta: va por el servidor", async () => {
    const supabase = cliente(null);
    const { data } = await perfilesPublicos(supabase, ["a", "a", "b"]);

    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(perfilesDeVisitante).toHaveBeenCalledWith(["a", "b"]);
    expect(data).toEqual([{ id: "visitante" }]);
  });

  it("los puntajes siguen el mismo camino", async () => {
    const supabase = cliente(null);
    const { data } = await puntajesPublicos(supabase, ["a"]);

    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(puntajesDeVisitante).toHaveBeenCalledWith(["a"]);
    expect(data).toEqual([{ profile_id: "visitante" }]);
  });

  it("sin ids no consulta nada", async () => {
    const supabase = cliente(null);
    await perfilesPublicos(supabase, []);

    expect(supabase.auth.getSession).not.toHaveBeenCalled();
    expect(perfilesDeVisitante).not.toHaveBeenCalled();
  });

  it("perfilPublico devuelve la primera fila o null", async () => {
    perfilesDeVisitante.mockResolvedValue({ data: [], error: null });
    const { data } = await perfilPublico(cliente(null), "a");
    expect(data).toBeNull();
  });

  describe("en el navegador y sin sesión", () => {
    function enNavegador(respuesta: Response | Error) {
      const fetchFalso = vi.fn(async () => {
        if (respuesta instanceof Error) throw respuesta;
        return respuesta;
      });
      vi.stubGlobal("window", {});
      vi.stubGlobal("fetch", fetchFalso);
      return fetchFalso;
    }

    it("pide al Route Handler", async () => {
      const fetchFalso = enNavegador(Response.json({ data: [{ id: "a" }], error: null }));
      const supabase = cliente(null);
      const { data } = await perfilesPublicos(supabase, ["a"]);

      expect(fetchFalso).toHaveBeenCalledWith(
        "/api/autores-visitante",
        expect.objectContaining({ body: JSON.stringify({ tipo: "perfiles", ids: ["a"] }) }),
      );
      expect(perfilesDeVisitante).not.toHaveBeenCalled();
      expect(supabase.rpc).not.toHaveBeenCalled();
      expect(data).toEqual([{ id: "a" }]);
    });

    it("si el servidor no contesta, el hilo carga igual sin autores", async () => {
      enNavegador(new Response(null, { status: 429 }));
      const { data, error } = await puntajesPublicos(cliente(null), ["a"]);

      expect(data).toEqual([]);
      expect(error).toEqual({ code: "sin_respuesta", message: "429" });
    });

    it("con la red caída tampoco tira", async () => {
      enNavegador(new Error("offline"));
      const { data } = await perfilesPublicos(cliente(null), ["a"]);
      expect(data).toEqual([]);
    });

    it("con sesión sigue por la RPC", async () => {
      const fetchFalso = enNavegador(Response.json({}));
      const supabase = cliente({ access_token: "x" });
      await perfilesPublicos(supabase, ["a"]);

      expect(fetchFalso).not.toHaveBeenCalled();
      expect(supabase.rpc).toHaveBeenCalled();
    });
  });
});
