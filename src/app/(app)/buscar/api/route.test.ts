import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
const adminRpc = vi.hoisted(() => vi.fn());
const getAuthUserId = vi.hoisted(() => vi.fn());
const limit = vi.hoisted(() => vi.fn());
const adminRoto = vi.hoisted(() => ({ activo: false }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc }),
  getAuthUserId,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    if (adminRoto.activo) throw new Error("sin service role");
    return { rpc: adminRpc };
  },
}));
vi.mock("@/lib/tenant/resolve", () => ({
  getTenant: async () => ({ id: "comunidad-del-dominio" }),
}));
vi.mock("@/lib/rate-limit", () => ({
  limit,
  clientIpFromHeaders: () => "1.2.3.4",
}));

import { GET } from "./route";

const buscar = (q = "Bizcocho") =>
  GET(new Request(`http://localhost/buscar/api?q=${encodeURIComponent(q)}&p_tenant=otra`));

const GEOVANNY = {
  result_type: "personas",
  id: "8e25016b-0247-4318-bae8-157c3198cff4",
  title: "GEOVANNY",
  subtitle: null,
  image_url: null,
  href: "/perfil/8e25016b-0247-4318-bae8-157c3198cff4",
  rank: 1,
};

describe("GET /buscar/api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    adminRoto.activo = false;
    rpc.mockResolvedValue({ data: [], error: null });
    adminRpc.mockResolvedValue({ data: [], error: null });
    limit.mockReturnValue({ ok: true, retryAfterMs: 0 });
  });

  it("sin sesión busca en la comunidad del dominio, sin importar lo que venga en la URL", async () => {
    getAuthUserId.mockResolvedValue(null);
    await buscar();
    expect(rpc).toHaveBeenCalledWith("global_search", {
      q: "Bizcocho",
      limit_per_type: 5,
      p_tenant: "comunidad-del-dominio",
    });
    expect(adminRpc).toHaveBeenCalledWith("buscar_personas_visitante", {
      p_tenant: "comunidad-del-dominio",
      q: "Bizcocho",
    });
  });

  it("B01: un visitante encuentra a una persona por el admin client", async () => {
    getAuthUserId.mockResolvedValue(null);
    adminRpc.mockResolvedValue({ data: [GEOVANNY], error: null });

    const respuesta = await buscar("GEOVANNY");
    const cuerpo = await respuesta.json();

    expect(respuesta.status).toBe(200);
    expect(cuerpo.total).toBe(1);
    expect(JSON.stringify(cuerpo.groups)).toContain("GEOVANNY");
  });

  it("con sesión no manda comunidad ni usa el admin client: decide el JWT", async () => {
    getAuthUserId.mockResolvedValue("usuario");
    await buscar();
    expect(rpc).toHaveBeenCalledWith("global_search", { q: "Bizcocho", limit_per_type: 5 });
    expect(adminRpc).not.toHaveBeenCalled();
  });

  it("el visitante tiene un tope propio, más bajo que el general", async () => {
    getAuthUserId.mockResolvedValue(null);
    await buscar();

    const general = limit.mock.calls.find(([key]) => key === "buscar:1.2.3.4");
    const visitante = limit.mock.calls.find(([key]) => key === "buscar-visitante:1.2.3.4");
    expect(visitante?.[1]).toBeLessThan(general?.[1]);
  });

  it("con sesión no consume el tope de visitante", async () => {
    getAuthUserId.mockResolvedValue("usuario");
    await buscar();
    expect(limit).not.toHaveBeenCalledWith(
      "buscar-visitante:1.2.3.4",
      expect.anything(),
      expect.anything(),
    );
  });

  it("pasado el tope de visitante no hay personas, pero avisos y publicaciones siguen", async () => {
    getAuthUserId.mockResolvedValue(null);
    limit.mockImplementation((key: string) => ({
      ok: key !== "buscar-visitante:1.2.3.4",
      retryAfterMs: 0,
    }));

    const respuesta = await buscar();

    expect(respuesta.status).toBe(200);
    expect(rpc).toHaveBeenCalledOnce();
    expect(adminRpc).not.toHaveBeenCalled();
  });

  it("si la función de personas falla, los demás resultados igual salen", async () => {
    getAuthUserId.mockResolvedValue(null);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    adminRpc.mockResolvedValue({ data: null, error: { code: "XX000" } });
    rpc.mockResolvedValue({
      data: [{ ...GEOVANNY, result_type: "marketplace", title: "Bizcocho", href: "/marketplace/1" }],
      error: null,
    });

    const respuesta = await buscar();
    expect(respuesta.status).toBe(200);
    expect((await respuesta.json()).total).toBe(1);
  });

  it("sin admin client degrada a sin personas, no a un error", async () => {
    getAuthUserId.mockResolvedValue(null);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    adminRoto.activo = true;

    expect((await buscar()).status).toBe(200);
  });

  it("si la búsqueda falla responde error sin mostrar el detalle", async () => {
    getAuthUserId.mockResolvedValue(null);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
    const respuesta = await buscar();
    expect(respuesta.status).toBe(502);
    expect(await respuesta.json()).toEqual({ error: "search_failed" });
  });

  it("deploy antes de la 0182: sin sesión, la RPC sin p_tenant da vacío y no 502", async () => {
    getAuthUserId.mockResolvedValue(null);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    rpc.mockResolvedValue({ data: null, error: { code: "PGRST202" } });
    adminRpc.mockResolvedValue({ data: null, error: { code: "PGRST202" } });

    const respuesta = await buscar();

    expect(respuesta.status).toBe(200);
    expect(await respuesta.json()).toEqual({ query: "Bizcocho", groups: [], total: 0 });
  });

  it("PGRST202 con sesión sí es un error: esa firma tiene que existir siempre", async () => {
    getAuthUserId.mockResolvedValue("usuario");
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    rpc.mockResolvedValue({ data: null, error: { code: "PGRST202" } });

    expect((await buscar()).status).toBe(502);
  });
});
