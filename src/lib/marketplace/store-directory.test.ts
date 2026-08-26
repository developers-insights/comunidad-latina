import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchActiveListingCounts, fetchStoreRatings } from "./store-directory";

/**
 * Estas dos funciones son la respuesta al pedido explícito del cliente: "no se
 * calcula trayendo todos los artículos de cada tienda y contándolos en
 * memoria — eso es un N+1 servido en bandeja. Resolvelo con un conteo
 * agregado en una sola query." Lo que se fija acá no es sólo el resultado: es
 * que `from()` se llama UNA sola vez sin importar cuántas tiendas haya en la
 * página, y que un error de red degrada a un Map vacío en vez de romper el
 * directorio entero.
 */

type StubResult = { data?: unknown; error?: unknown };

function createStub(result: StubResult) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    in: vi.fn((...args: unknown[]) => {
      builder.__inArgs = args;
      return builder;
    }),
    then: (resolve: (v: StubResult) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  const from = vi.fn(() => builder);
  return { from: from as unknown, fromSpy: from, builder };
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchStoreRatings", () => {
  it("sin ids no consulta nada y devuelve un Map vacío", async () => {
    const stub = createStub({ data: [], error: null });
    const result = await fetchStoreRatings({ from: stub.from } as never, []);
    expect(result.size).toBe(0);
    expect(stub.fromSpy).not.toHaveBeenCalled();
  });

  it("UNA sola consulta para todas las tiendas, sin importar cuántas sean", async () => {
    const stub = createStub({
      data: [
        { listing_id: "s1", rating_avg: "4.80", rating_count: 23 },
        { listing_id: "s2", rating_avg: null, rating_count: 0 },
      ],
      error: null,
    });

    const result = await fetchStoreRatings({ from: stub.from } as never, ["s1", "s2", "s3"]);

    expect(stub.fromSpy).toHaveBeenCalledTimes(1);
    expect(result.get("s1")).toEqual({ promedio: 4.8, cantidad: 23 });
    // Sin reseñas: promedio null, NUNCA 0 (mismo criterio que ResumenPuntajeCard).
    expect(result.get("s2")).toEqual({ promedio: null, cantidad: 0 });
    // s3 no vino en la respuesta (nadie la calificó todavía): no está en el Map.
    expect(result.has("s3")).toBe(false);
  });

  it("ante un error de la consulta, degrada a Map vacío en vez de romper el directorio", async () => {
    const stub = createStub({ data: null, error: { code: "500" } });
    const result = await fetchStoreRatings({ from: stub.from } as never, ["s1"]);
    expect(result.size).toBe(0);
  });
});

describe("fetchActiveListingCounts", () => {
  const TENANT_ID = "11111111-1111-4111-8111-111111111111";

  it("sin ids no consulta nada y devuelve un Map vacío", async () => {
    const stub = createStub({ data: [], error: null });
    const result = await fetchActiveListingCounts({ from: stub.from } as never, {
      tenantId: TENANT_ID,
      storeIds: [],
    });
    expect(result.size).toBe(0);
    expect(stub.fromSpy).not.toHaveBeenCalled();
  });

  it("UNA sola consulta agrega el conteo por tienda a partir de los productos activos", async () => {
    const stub = createStub({
      data: [
        { attrs: { store_listing_id: "s1", category: "hogar" } },
        { attrs: { store_listing_id: "s1", category: "hogar" } },
        { attrs: { store_listing_id: "s2", category: "ropa_accesorios" } },
        // Producto de particular (sin tienda) mezclado en el mismo lote: se ignora.
        { attrs: { category: "otro" } },
      ],
      error: null,
    });

    const result = await fetchActiveListingCounts({ from: stub.from } as never, {
      tenantId: TENANT_ID,
      storeIds: ["s1", "s2", "s3"],
    });

    expect(stub.fromSpy).toHaveBeenCalledTimes(1);
    expect(result.get("s1")).toBe(2);
    expect(result.get("s2")).toBe(1);
    // s3 no tuvo productos activos en la respuesta: 0 implícito (undefined en
    // el Map), no un error — quien llama decide si muestra "0" o lo omite.
    expect(result.has("s3")).toBe(false);
  });

  it("ante un error de la consulta, degrada a Map vacío en vez de romper el directorio", async () => {
    const stub = createStub({ data: null, error: { code: "500" } });
    const result = await fetchActiveListingCounts({ from: stub.from } as never, {
      tenantId: TENANT_ID,
      storeIds: ["s1"],
    });
    expect(result.size).toBe(0);
  });
});
