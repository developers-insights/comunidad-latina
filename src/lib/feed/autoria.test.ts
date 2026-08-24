import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * =============================================================================
 * AUTORÍA DE UNA PUBLICACIÓN — nadie firma con una ficha que no es suya
 * =============================================================================
 *
 * `posts.entity_listing_id` (0023) decide a nombre de quién sale una
 * publicación, y su policy acepta exactamente esto:
 *
 *     l.tenant_id = posts.tenant_id
 *     and l.created_by = auth.uid()
 *     and l.status = 'published'
 *
 * Este archivo ancla que las DOS funciones del módulo usen ese predicado
 * completo y no una aproximación:
 *
 *  · `listarAutoriasDelComposer()` —lo que se OFRECE— no puede ofrecer una
 *    ficha que la base después rechace: sería mandar a alguien a escribir,
 *    elegir y publicar para terminar en un error de Postgres.
 *  · `puedeFirmarComo()` —lo que se EXIGE— es la frontera del servidor. Cada
 *    filtro que falte acá es una forma de publicar a nombre de otro.
 *
 * Por eso las pruebas de `puedeFirmarComo` no miran sólo el resultado: miran
 * QUÉ filtros se aplicaron. Un test que sólo mira el booleano pasa igual con la
 * consulta a la que le sacaron el `created_by`.
 */

const mocks = vi.hoisted(() => ({
  requireTenantMatch: vi.fn(),
  getIdentidadActiva: vi.fn(),
  getShellContext: vi.fn(),
}));

vi.mock("@/lib/tenant/guard", () => ({ requireTenantMatch: mocks.requireTenantMatch }));
vi.mock("@/lib/perfil-activo/identidad", () => ({
  getIdentidadActiva: mocks.getIdentidadActiva,
}));
vi.mock("@/components/shell/shell-context", () => ({
  getShellContext: mocks.getShellContext,
}));

import {
  listarAutoriasDelComposer,
  puedeFirmarComo,
  SIN_AUTORIAS,
} from "./autoria";

const TENANT = "11111111-1111-4111-8111-111111111111";
const USUARIO = "99999999-9999-4999-8999-999999999999";
const NEGOCIO_ID = "019fa477-58e6-7ab9-ae4f-cc41716f6421";
const FICHA_NEGOCIO = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FICHA_PROFESIONAL = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

interface FilaFicha {
  id: string;
  title: string;
  kind: string;
}

/** Cada `.eq(col, valor)` / `.in(col, valores)` que la consulta pidió. */
type Filtro = { metodo: "eq" | "in"; columna: string; valor: unknown };

/**
 * Supabase de mentira, encadenable, que RECUERDA los filtros. Sirve para las
 * dos consultas del módulo porque las dos son la misma forma: select →
 * filtros → (order/limit | maybeSingle).
 */
function supabaseFalso(resultado: { data: unknown; error?: unknown }) {
  const filtros: Filtro[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {
    select: vi.fn(() => builder),
    eq: vi.fn((columna: string, valor: unknown) => {
      filtros.push({ metodo: "eq", columna, valor });
      return builder;
    }),
    in: vi.fn((columna: string, valor: unknown) => {
      filtros.push({ metodo: "in", columna, valor });
      return builder;
    }),
    order: vi.fn(() => builder),
    limit: vi.fn(async () => ({ data: resultado.data, error: resultado.error ?? null })),
    maybeSingle: vi.fn(async () => ({ data: resultado.data, error: resultado.error ?? null })),
  };
  const from = vi.fn(() => builder);
  return { client: { from }, from, filtros };
}

function valorDeFiltro(filtros: Filtro[], columna: string): unknown {
  return filtros.find((filtro) => filtro.columna === columna)?.valor;
}

function conGuard(fichas: FilaFicha[], error: unknown = null) {
  const stub = supabaseFalso({ data: fichas, error });
  mocks.requireTenantMatch.mockResolvedValue({
    ok: true,
    tenant: { id: TENANT, slug: "dominicanos" },
    supabase: stub.client,
    user: { id: USUARIO },
  });
  return stub;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getIdentidadActiva.mockResolvedValue({ tipo: "personal" });
  mocks.getShellContext.mockResolvedValue({
    user: { displayName: "Ana Gómez", avatarUrl: null },
    unread: 0,
    isStaff: false,
  });
});

describe("listarAutoriasDelComposer — lo que se le OFRECE a la persona", () => {
  it("pide exactamente el predicado de la policy: tenant, dueño, publicada y vertical", async () => {
    const stub = conGuard([]);

    await listarAutoriasDelComposer();

    expect(valorDeFiltro(stub.filtros, "tenant_id")).toBe(TENANT);
    expect(valorDeFiltro(stub.filtros, "created_by")).toBe(USUARIO);
    expect(valorDeFiltro(stub.filtros, "status")).toBe("published");
    expect(valorDeFiltro(stub.filtros, "kind")).toEqual(["business", "professional"]);
  });

  it("devuelve el negocio Y el profesional: son la misma puerta", async () => {
    conGuard([
      { id: FICHA_NEGOCIO, title: "Panadería La Esperanza", kind: "business" },
      { id: FICHA_PROFESIONAL, title: "Ana Gómez — Contadora", kind: "professional" },
    ]);

    const { entidades } = await listarAutoriasDelComposer();

    expect(entidades).toEqual([
      { listingId: FICHA_NEGOCIO, nombre: "Panadería La Esperanza", kind: "business" },
      { listingId: FICHA_PROFESIONAL, nombre: "Ana Gómez — Contadora", kind: "professional" },
    ]);
  });

  it("una fila con un vertical que no firma publicaciones se descarta", async () => {
    // No debería llegar (la consulta ya filtra), pero si llegara sería una
    // opción que la policy rechaza: se cae acá, no en la cara de la persona.
    conGuard([{ id: "x", title: "Depto en Jackson Heights", kind: "property" }]);

    const { entidades } = await listarAutoriasDelComposer();

    expect(entidades).toEqual([]);
  });

  it("actuando como negocio, su ficha viene ELEGIDA por defecto", async () => {
    conGuard([{ id: FICHA_NEGOCIO, title: "Panadería La Esperanza", kind: "business" }]);
    mocks.getIdentidadActiva.mockResolvedValue({
      tipo: "negocio",
      negocio: { businessId: NEGOCIO_ID, listingId: FICHA_NEGOCIO, rol: "propietario" },
    });

    const { porDefecto } = await listarAutoriasDelComposer();

    expect(porDefecto).toBe(FICHA_NEGOCIO);
  });

  it("un negocio activo SIN ficha publicada no puede ser el default", async () => {
    // La cuenta de negocio existe y el header dice que estás actuando como
    // ella, pero no hay ficha con la que la base deje firmar. Se publica como
    // uno mismo — es lo único que se puede guardar de verdad.
    conGuard([]);
    mocks.getIdentidadActiva.mockResolvedValue({
      tipo: "negocio",
      negocio: { businessId: NEGOCIO_ID, listingId: null, rol: "propietario" },
    });

    const { porDefecto, entidades } = await listarAutoriasDelComposer();

    expect(porDefecto).toBeNull();
    expect(entidades).toEqual([]);
  });

  it("la identidad activa apunta a una ficha que ya no está en la lista: cae a personal", async () => {
    // La despublicaron después de elegirla. Ofrecerla igual sería un rechazo
    // garantizado al tocar Publicar.
    conGuard([{ id: FICHA_PROFESIONAL, title: "Ana Gómez — Contadora", kind: "professional" }]);
    mocks.getIdentidadActiva.mockResolvedValue({
      tipo: "negocio",
      negocio: { businessId: NEGOCIO_ID, listingId: FICHA_NEGOCIO, rol: "propietario" },
    });

    const { porDefecto } = await listarAutoriasDelComposer();

    expect(porDefecto).toBeNull();
  });

  it("sin sesión o con el tenant cruzado no hay ninguna firma disponible", async () => {
    mocks.requireTenantMatch.mockResolvedValue({ ok: false, reason: "unauthenticated" });

    expect(await listarAutoriasDelComposer()).toEqual(SIN_AUTORIAS);
  });

  it("un error de la base no rompe el composer: se publica como uno mismo", async () => {
    conGuard([], { code: "PGRST000" });

    expect(await listarAutoriasDelComposer()).toEqual(SIN_AUTORIAS);
  });
});

describe("puedeFirmarComo — la frontera del servidor", () => {
  it("comprueba la ficha con los CUATRO filtros de la policy", async () => {
    const stub = supabaseFalso({ data: { id: FICHA_NEGOCIO } });

    const ok = await puedeFirmarComo(stub.client as never, {
      tenantId: TENANT,
      userId: USUARIO,
      listingId: FICHA_NEGOCIO,
    });

    expect(ok).toBe(true);
    expect(valorDeFiltro(stub.filtros, "id")).toBe(FICHA_NEGOCIO);
    expect(valorDeFiltro(stub.filtros, "tenant_id")).toBe(TENANT);
    expect(valorDeFiltro(stub.filtros, "created_by")).toBe(USUARIO);
    expect(valorDeFiltro(stub.filtros, "status")).toBe("published");
    expect(valorDeFiltro(stub.filtros, "kind")).toEqual(["business", "professional"]);
  });

  it("una ficha que la consulta no devuelve es un NO", async () => {
    // Es el caso de la ficha ajena: la RLS de `listings` (o los filtros) la
    // dejan afuera y acá no hay nada que interpretar.
    const stub = supabaseFalso({ data: null });

    expect(
      await puedeFirmarComo(stub.client as never, {
        tenantId: TENANT,
        userId: USUARIO,
        listingId: FICHA_NEGOCIO,
      }),
    ).toBe(false);
  });

  it("si la consulta falla, la respuesta es NO — nunca 'no se pudo, dale igual'", async () => {
    const stub = supabaseFalso({ data: null, error: { code: "PGRST000" } });

    expect(
      await puedeFirmarComo(stub.client as never, {
        tenantId: TENANT,
        userId: USUARIO,
        listingId: FICHA_NEGOCIO,
      }),
    ).toBe(false);
  });

  it("si el cliente tira, la respuesta también es NO", async () => {
    const client = {
      from: () => {
        throw new Error("sin red");
      },
    };

    expect(
      await puedeFirmarComo(client as never, {
        tenantId: TENANT,
        userId: USUARIO,
        listingId: FICHA_NEGOCIO,
      }),
    ).toBe(false);
  });
});
