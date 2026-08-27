import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * =============================================================================
 * VERIFICACIÓN POR PERFIL — quién está verificado y quién puede resolverlo
 * =============================================================================
 *
 * Pedido del cliente: «según cada perfil, debería de hacerse la verificación de
 * stripe si quieren abrir negocios/empleos/creador» (2026-08-26).
 *
 * Quien AUTORIZA es `public.verificar_identidad_de_negocio()` (0121), que
 * vuelve a exigir rol y documento validado del lado del servidor. Lo que se
 * prueba acá es la capa de arriba: que la pantalla no dibuje un botón que sólo
 * puede rebotar, que la verificación de la PERSONA y la del NEGOCIO no se
 * confundan nunca, y que un error de lectura se lea como "sin verificar".
 */

const mocks = vi.hoisted(() => ({
  listarIdentidadesDeNegocio: vi.fn(),
}));

vi.mock("@/lib/perfil-activo/identidad", () => ({
  listarIdentidadesDeNegocio: mocks.listarIdentidadesDeNegocio,
}));

import { esReclamoCodigo, leerEstadoDeIdentidades } from "./identidades";
import type { SupabaseClient } from "@supabase/supabase-js";

const USUARIO = "019fa477-58e6-7ab9-ae4f-cc41716f6420";
const PANADERIA = "019fa477-58e6-7ab9-ae4f-cc41716f6421";

interface FilaPerfil {
  display_name: string | null;
  avatar_url: string | null;
  identity_verified: boolean | null;
}

function supabaseFalso(
  perfil: FilaPerfil | null,
  error: { code: string } | null = null,
) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    maybeSingle: async () => ({ data: perfil, error }),
  };
  return { from: vi.fn(() => builder) } as unknown as SupabaseClient;
}

function negocio(overrides: Record<string, unknown> = {}) {
  return {
    businessId: PANADERIA,
    nombre: "Panadería La Esperanza",
    categoria: null,
    listingId: null,
    avatarUrl: null,
    rol: "propietario",
    esPropietario: true,
    verificada: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  mocks.listarIdentidadesDeNegocio.mockResolvedValue([]);
});

describe("leerEstadoDeIdentidades", () => {
  it("la persona va SIEMPRE primero: es la que habilita a las demás", async () => {
    mocks.listarIdentidadesDeNegocio.mockResolvedValue([negocio()]);
    const supabase = supabaseFalso({
      display_name: "Giovanni",
      avatar_url: null,
      identity_verified: true,
    });

    const identidades = await leerEstadoDeIdentidades(supabase, USUARIO);

    expect(identidades[0]).toMatchObject({
      tipo: "persona",
      id: USUARIO,
      nombre: "Giovanni",
      verificada: true,
    });
    expect(identidades[1].tipo).toBe("negocio");
  });

  it("la verificación de la PERSONA no verifica a sus negocios", async () => {
    // Es el corazón del pedido: «según cada perfil». Si esto se rompiera,
    // verificarse una vez habilitaría diez perfiles de golpe.
    mocks.listarIdentidadesDeNegocio.mockResolvedValue([negocio({ verificada: false })]);
    const supabase = supabaseFalso({
      display_name: "Giovanni",
      avatar_url: null,
      identity_verified: true,
    });

    const identidades = await leerEstadoDeIdentidades(supabase, USUARIO);

    expect(identidades[0].verificada).toBe(true);
    expect(identidades[1].verificada).toBe(false);
  });

  it("y al revés: un negocio verificado no verifica a la persona", async () => {
    mocks.listarIdentidadesDeNegocio.mockResolvedValue([negocio({ verificada: true })]);
    const supabase = supabaseFalso({
      display_name: "Giovanni",
      avatar_url: null,
      identity_verified: false,
    });

    const identidades = await leerEstadoDeIdentidades(supabase, USUARIO);

    expect(identidades[0].verificada).toBe(false);
    expect(identidades[1].verificada).toBe(true);
  });

  it("dueño y administrador pueden reclamar; editor, atención y analista no", async () => {
    mocks.listarIdentidadesDeNegocio.mockResolvedValue([
      negocio({ businessId: "b-1", rol: "propietario" }),
      negocio({ businessId: "b-2", rol: "administrador" }),
      negocio({ businessId: "b-3", rol: "editor" }),
      negocio({ businessId: "b-4", rol: "atencion" }),
      negocio({ businessId: "b-5", rol: "analista" }),
    ]);
    const supabase = supabaseFalso({
      display_name: "Giovanni",
      avatar_url: null,
      identity_verified: true,
    });

    const identidades = await leerEstadoDeIdentidades(supabase, USUARIO);

    expect(identidades.slice(1).map((item) => item.puedeReclamar)).toEqual([
      true,
      true,
      false,
      false,
      false,
    ]);
  });

  it("la persona NUNCA se 'reclama': eso se hace con Stripe y tiene su botón", async () => {
    const supabase = supabaseFalso({
      display_name: "Giovanni",
      avatar_url: null,
      identity_verified: false,
    });

    const [persona] = await leerEstadoDeIdentidades(supabase, USUARIO);

    expect(persona.puedeReclamar).toBe(false);
  });

  it("si no se puede leer el perfil, SIN verificar — nunca al revés", async () => {
    const supabase = supabaseFalso(null, { code: "PGRST301" });

    const [persona] = await leerEstadoDeIdentidades(supabase, USUARIO);

    expect(persona.verificada).toBe(false);
    expect(persona.nombre).toBe("Tu perfil personal");
  });

  it("un identity_verified null no es 'verificado'", async () => {
    const supabase = supabaseFalso({
      display_name: "Giovanni",
      avatar_url: null,
      identity_verified: null,
    });

    const [persona] = await leerEstadoDeIdentidades(supabase, USUARIO);

    expect(persona.verificada).toBe(false);
  });
});

describe("esReclamoCodigo", () => {
  it("acepta los cuatro códigos de la RPC", () => {
    expect(esReclamoCodigo("ok")).toBe(true);
    expect(esReclamoCodigo("sin_permiso")).toBe(true);
    expect(esReclamoCodigo("identidad_personal_pendiente")).toBe(true);
    expect(esReclamoCodigo("sin_sesion")).toBe(true);
  });

  it("un null NO es un código: es lo que devuelve una base sin la 0121", () => {
    // Tratarlo como éxito diría "listo, verificado" sin haber escrito nada.
    expect(esReclamoCodigo(null)).toBe(false);
    expect(esReclamoCodigo(undefined)).toBe(false);
    expect(esReclamoCodigo(true)).toBe(false);
    expect(esReclamoCodigo("cualquier_cosa")).toBe(false);
  });
});
