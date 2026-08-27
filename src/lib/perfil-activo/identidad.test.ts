import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * =============================================================================
 * PERFIL ACTIVO — nadie actúa como un negocio que no le corresponde
 * =============================================================================
 *
 * La policy de `active_identities` (0103) ya impide ESCRIBIR una identidad
 * ajena. Lo que se ejercita acá es el agujero que una policy no puede tapar: la
 * fila que quedó escrita cuando la persona SÍ era miembro y dejó de serlo.
 * Ninguna policy la borra sola, así que si la lectura confiara en la fila,
 * alguien a quien echaron del negocio seguiría publicando con su nombre.
 *
 * La regla que se prueba es simple: manda la lista de membresías vigentes, no
 * la fila guardada.
 */

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getCurrentUser: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
  getCurrentUser: mocks.getCurrentUser,
}));

import { getIdentidadActiva, listarIdentidadesDeNegocio, puedePublicar } from "./identidad";

const USUARIO = "019fa477-58e6-7ab9-ae4f-cc41716f6420";
const PANADERIA = "019fa477-58e6-7ab9-ae4f-cc41716f6421";

interface FilaRpc {
  business_id: string;
  nombre: string;
  categoria: string | null;
  listing_id: string | null;
  rol: string;
  es_propietario: boolean;
  verificada: boolean;
}

function fila(overrides: Partial<FilaRpc> = {}): FilaRpc {
  return {
    business_id: PANADERIA,
    nombre: "Panadería La Esperanza",
    categoria: "mercado",
    listing_id: null,
    rol: "propietario",
    es_propietario: true,
    verificada: false,
    ...overrides,
  };
}

/** Supabase de mentira: la RPC de membresías vigentes + la fila guardada. */
function supabaseFalso(options: {
  membresias?: FilaRpc[];
  identidadGuardada?: { business_id: string } | null;
}) {
  const rpc = vi.fn(async () => ({ data: options.membresias ?? [], error: null }));
  const builder = {
    select: () => builder,
    eq: () => builder,
    maybeSingle: async () => ({
      data: options.identidadGuardada ?? null,
      error: null,
    }),
  };
  return { rpc, from: vi.fn(() => builder) };
}

function montar(options: Parameters<typeof supabaseFalso>[0] & { sesion?: boolean }) {
  const supabase = supabaseFalso(options);
  mocks.createClient.mockResolvedValue(supabase);
  mocks.getCurrentUser.mockResolvedValue(
    options.sesion === false ? null : { id: USUARIO },
  );
  return supabase;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getIdentidadActiva", () => {
  it("sin sesión, la identidad es la personal", async () => {
    montar({ sesion: false });
    await expect(getIdentidadActiva()).resolves.toEqual({ tipo: "personal" });
  });

  it("sin fila guardada, la identidad es la personal (la ausencia ES el default)", async () => {
    montar({ membresias: [fila()], identidadGuardada: null });
    await expect(getIdentidadActiva()).resolves.toEqual({ tipo: "personal" });
  });

  it("con fila y membresía vigente, actúa como el negocio", async () => {
    montar({ membresias: [fila()], identidadGuardada: { business_id: PANADERIA } });

    const identidad = await getIdentidadActiva();

    expect(identidad.tipo).toBe("negocio");
    if (identidad.tipo !== "negocio") return;
    expect(identidad.negocio.businessId).toBe(PANADERIA);
    expect(identidad.negocio.nombre).toBe("Panadería La Esperanza");
    expect(identidad.negocio.rol).toBe("propietario");
  });

  it("LE REVOCARON LA MEMBRESÍA: la fila vieja no alcanza, vuelve al perfil personal", async () => {
    // La fila sigue escrita —ninguna policy la borra sola— pero ya no aparece
    // en las membresías vigentes. Si esto devolviera el negocio, alguien a quien
    // echaron seguiría publicando con el nombre del local.
    montar({ membresias: [], identidadGuardada: { business_id: PANADERIA } });

    await expect(getIdentidadActiva()).resolves.toEqual({ tipo: "personal" });
  });

  it("una fila que apunta a OTRO negocio del que sí es miembro no se confunde", async () => {
    const otro = "019fa477-58e6-7ab9-ae4f-cc41716f6499";
    montar({
      membresias: [fila()],
      identidadGuardada: { business_id: otro },
    });

    await expect(getIdentidadActiva()).resolves.toEqual({ tipo: "personal" });
  });

  it("si la base falla, cae al perfil personal en vez de tirar la pantalla", async () => {
    mocks.createClient.mockRejectedValue(new Error("sin red"));
    mocks.getCurrentUser.mockResolvedValue({ id: USUARIO });

    await expect(getIdentidadActiva()).resolves.toEqual({ tipo: "personal" });
  });
});

describe("listarIdentidadesDeNegocio", () => {
  it("descarta filas con un rol que la app no conoce", async () => {
    montar({ membresias: [fila(), fila({ business_id: "x", rol: "inventado" })] });

    const identidades = await listarIdentidadesDeNegocio();

    expect(identidades).toHaveLength(1);
    expect(identidades[0].businessId).toBe(PANADERIA);
  });

  it("trae la verificación de CADA negocio, sin una consulta por fila", async () => {
    // La columna la agrega la 0121 a `identidades_disponibles()`. Sale de ahí y
    // no de una lectura aparte porque el cambiador se pinta en cada navegación:
    // preguntarla por negocio sería un N+1 en el header.
    montar({
      membresias: [
        fila({ verificada: true }),
        fila({ business_id: "019fa477-58e6-7ab9-ae4f-cc41716f6499", verificada: false }),
      ],
    });

    const identidades = await listarIdentidadesDeNegocio();

    expect(identidades.map((identidad) => identidad.verificada)).toEqual([true, false]);
  });

  it("una base SIN la 0121 no devuelve la columna: eso NO es 'verificado'", async () => {
    // De los dos errores posibles, no pintar la insignia es invisible y
    // pintarla de más es una afirmación falsa sobre alguien.
    const supabase = montar({});
    supabase.rpc.mockResolvedValue({
      data: [{ ...fila(), verificada: undefined }],
      error: null,
    } as never);

    const identidades = await listarIdentidadesDeNegocio();

    expect(identidades[0].verificada).toBe(false);
  });

  it("un error de la RPC devuelve lista vacía, no una excepción", async () => {
    const supabase = montar({});
    supabase.rpc.mockResolvedValue({ data: null, error: { message: "boom" } } as never);

    await expect(listarIdentidadesDeNegocio()).resolves.toEqual([]);
  });
});

describe("puedePublicar", () => {
  it("dueño, administrador y editor firman publicaciones; atención y analista no", async () => {
    const rolPuede = (rol: string) =>
      puedePublicar({
        tipo: "negocio",
        negocio: {
          businessId: PANADERIA,
          nombre: "Panadería",
          categoria: null,
          listingId: null,
          avatarUrl: null,
          rol: rol as never,
          esPropietario: false,
          verificada: false,
        },
      });

    expect(rolPuede("propietario")).toBe(true);
    expect(rolPuede("administrador")).toBe(true);
    expect(rolPuede("editor")).toBe(true);
    expect(rolPuede("atencion")).toBe(false);
    expect(rolPuede("analista")).toBe(false);
    expect(puedePublicar({ tipo: "personal" })).toBe(true);
  });
});
