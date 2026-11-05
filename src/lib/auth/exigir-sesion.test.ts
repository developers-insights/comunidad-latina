import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthUserId = vi.hoisted(() => vi.fn());
const perfil = vi.hoisted(() => ({ result: { data: { id: "usuario" } as unknown, error: null as unknown } }));
const redirect = vi.hoisted(() =>
  vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
);

vi.mock("@/lib/supabase/server", () => ({
  getAuthUserId,
  createClient: async () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => perfil.result }),
      }),
    }),
  }),
}));
vi.mock("next/navigation", () => ({ redirect }));

import { exigirPerfil, exigirSesion } from "./exigir-sesion";

describe("exigirSesion", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sin sesión manda a entrar y conserva a dónde quería ir", async () => {
    getAuthUserId.mockResolvedValue(null);
    await expect(exigirSesion("/mensajes")).rejects.toThrow(
      "REDIRECT:/entrar?next=%2Fmensajes",
    );
  });

  it("un destino con query no se parte en parámetros sueltos", async () => {
    getAuthUserId.mockResolvedValue(null);
    await expect(exigirSesion("/perfil/guardados?tab=a&x=1")).rejects.toThrow(
      "REDIRECT:/entrar?next=%2Fperfil%2Fguardados%3Ftab%3Da%26x%3D1",
    );
  });

  it("con sesión deja pasar sin redirigir", async () => {
    getAuthUserId.mockResolvedValue("usuario");
    await expect(exigirSesion("/mensajes")).resolves.toBeUndefined();
    expect(redirect).not.toHaveBeenCalled();
  });
});

describe("exigirPerfil", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthUserId.mockResolvedValue("usuario");
    perfil.result = { data: { id: "usuario" }, error: null };
  });

  it("sin sesión primero pide entrar", async () => {
    getAuthUserId.mockResolvedValue(null);
    await expect(exigirPerfil("/perfil")).rejects.toThrow("REDIRECT:/entrar?next=%2Fperfil");
  });

  it("con sesión y sin perfil manda a completar el alta", async () => {
    perfil.result = { data: null, error: null };
    await expect(exigirPerfil("/perfil")).rejects.toThrow("REDIRECT:/bienvenida");
  });

  it("con perfil deja pasar", async () => {
    await expect(exigirPerfil("/perfil")).resolves.toBeUndefined();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("si la lectura falla no echa a nadie: decide la página", async () => {
    perfil.result = { data: null, error: { code: "XX000" } };
    await expect(exigirPerfil("/perfil")).resolves.toBeUndefined();
    expect(redirect).not.toHaveBeenCalled();
  });
});
