import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  esIlegible,
  fetchListingStats,
  sinNumerosTodavia,
  type ListingStats,
  type StatKey,
} from "./stats";

/**
 * UN CERO REAL Y UN HUECO NO SON LO MISMO.
 *
 * Todo lo que se prueba acá defiende una sola frase: el panel no afirma nada
 * sobre el aviso de alguien que pagó usando un número que no pudo leer. El caso
 * que motiva el archivo es el del docblock de `ListingStats.unreadable`: la
 * consulta de "me gusta" se cae, el objeto trae 0 por no romper el tipo, y la
 * pantalla mostraba "Todavía no hay números" sobre un aviso que podía tener
 * cincuenta.
 */

function stats(overrides: {
  basic?: Partial<ListingStats["basic"]>;
  unreadable?: StatKey[];
}): ListingStats {
  return {
    tier: "free",
    basic: {
      views: 0,
      likes: 0,
      comments: 0,
      shares: 0,
      saves: 0,
      chats: 0,
      ...overrides.basic,
    },
    ctaClicks: [],
    promotions: [],
    totalCtaClicks: 0,
    reach: null,
    unreadable: overrides.unreadable ?? [],
  };
}

describe("esIlegible", () => {
  it("marca sólo la métrica que se declaró ilegible", () => {
    const s = stats({ unreadable: ["likes"] });
    expect(esIlegible(s, "likes")).toBe(true);
    expect(esIlegible(s, "saves")).toBe(false);
    expect(esIlegible(s, "chats")).toBe(false);
  });

  it("sin huecos, ninguna métrica es ilegible", () => {
    const s = stats({ basic: { likes: 7 } });
    for (const key of ["likes", "saves", "chats", "shares", "ctaClicks", "promotions"] as const) {
      expect(esIlegible(s, key)).toBe(false);
    }
  });
});

describe("sinNumerosTodavia", () => {
  it("todo en cero y todo leído: sí se puede decir que no hay números", () => {
    expect(sinNumerosTodavia(stats({}))).toBe(true);
  });

  it("con cualquier número real ya no está vacío", () => {
    expect(sinNumerosTodavia(stats({ basic: { views: 1 } }))).toBe(false);
    expect(sinNumerosTodavia(stats({ basic: { chats: 3 } }))).toBe(false);
  });

  it("EL CASO: todo en cero pero una lectura se cayó — no se afirma el vacío", () => {
    // Éste es el bug que el módulo dejó escrito y la pantalla todavía pintaba:
    // 0 me gusta porque la query falló, no porque nadie haya dado me gusta.
    expect(sinNumerosTodavia(stats({ unreadable: ["likes"] }))).toBe(false);
    expect(sinNumerosTodavia(stats({ unreadable: ["saves"] }))).toBe(false);
    expect(sinNumerosTodavia(stats({ unreadable: ["chats"] }))).toBe(false);
    expect(sinNumerosTodavia(stats({ unreadable: ["shares"] }))).toBe(false);
  });

  it("un hueco en clics o promociones NO tapa el vacío de la grilla básica", () => {
    // Son otras dos secciones, cada una con su propio cartel: si las seis
    // métricas de arriba se leyeron y dieron cero, el vacío de la grilla es
    // cierto aunque la lista de promociones no haya cargado.
    expect(sinNumerosTodavia(stats({ unreadable: ["ctaClicks"] }))).toBe(true);
    expect(sinNumerosTodavia(stats({ unreadable: ["promotions"] }))).toBe(true);
  });

  it("con números reales, un hueco tampoco lo vuelve vacío", () => {
    expect(sinNumerosTodavia(stats({ basic: { views: 40 }, unreadable: ["likes"] }))).toBe(
      false,
    );
  });
});

/**
 * EL MONTO DEL IMPULSO NO SE LEE DE LA TABLA.
 *
 * `public.boosts` tiene grant POR COLUMNA (0018, re-afirmado en 0085) y
 * `amount_cents` quedó afuera a propósito: su policy de SELECT tiene una rama
 * pública (`status = 'active'`, alcanza a `anon`) por transparencia
 * publicitaria, así que la columna abierta sería la lista de precios de todos
 * los anunciantes de la comunidad. Pedirla por PostgREST no devuelve la fila
 * sin el monto: tumba la consulta ENTERA con 42501, y el panel terminaba
 * diciendo "Todavía no promocionaste este aviso" sobre un aviso pago.
 *
 * Lo que fijan estos tests es que el monto viaje por la RPC de la 0152 —la que
 * verifica la propiedad del aviso adentro— y que NUNCA se vuelva a tocar la
 * tabla `boosts` desde acá.
 */

type StubResult = { data?: unknown; count?: number | null; error?: unknown };

function createClient(overrides: {
  boosts?: StubResult;
  campaigns?: StubResult;
  reach?: StubResult;
}) {
  const vacio: StubResult = { data: [], count: 0, error: null };
  const tablasTocadas: string[] = [];
  const rpcLlamadas: { name: string; args: unknown }[] = [];

  const builder = (result: StubResult) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {
      select: vi.fn(() => b),
      eq: vi.fn(() => b),
      neq: vi.fn(() => b),
      gte: vi.fn(() => b),
      order: vi.fn(() => b),
      limit: vi.fn(() => b),
      then: (ok: (v: StubResult) => unknown, fail: (e: unknown) => unknown) =>
        Promise.resolve(result).then(ok, fail),
    };
    return b;
  };

  const from = vi.fn((table: string) => {
    tablasTocadas.push(table);
    return builder(table === "campaigns" ? (overrides.campaigns ?? vacio) : vacio);
  });

  const rpc = vi.fn((name: string, args: unknown) => {
    rpcLlamadas.push({ name, args });
    if (name === "listing_boosts_for_owner") return Promise.resolve(overrides.boosts ?? vacio);
    return Promise.resolve(overrides.reach ?? { data: 0, error: null });
  });

  return { client: { from, rpc } as never, tablasTocadas, rpcLlamadas };
}

const AVISO = {
  listingId: "019fa5dd-947f-71b3-8349-3b8483ec00a6",
  tenantId: "019f39cf-5115-70bf-8a9e-8db074bf07d6",
  kind: "property",
  tier: "premium",
};

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchListingStats · promociones", () => {
  it("el monto llega por la RPC de dueño, con el listing_id como único parámetro", async () => {
    const stub = createClient({
      boosts: {
        data: [{ duration_days: 14, status: "active", ends_at: "2026-09-22T04:00:33.801Z", amount_cents: 2500 }],
        error: null,
      },
    });

    const result = await fetchListingStats(stub.client, AVISO);

    expect(stub.rpcLlamadas).toContainEqual({
      name: "listing_boosts_for_owner",
      args: { p_listing_id: AVISO.listingId },
    });
    expect(result.promotions).toEqual([
      {
        type: "boost",
        label: "Impulso de 14 días",
        status: "active",
        days: 14,
        endsAt: "2026-09-22T04:00:33.801Z",
        amountCents: 2500,
      },
    ]);
    expect(esIlegible(result, "promotions")).toBe(false);
  });

  it("NUNCA consulta la tabla boosts — pedir amount_cents por PostgREST es el 42501", async () => {
    const stub = createClient({});
    await fetchListingStats(stub.client, AVISO);
    expect(stub.tablasTocadas).not.toContain("boosts");
  });

  it("si la RPC se cae, la lista queda declarada como hueco y no como 'no promocionaste'", async () => {
    // La diferencia que este archivo entero defiende: un 42501 no significa que
    // el aviso no esté promocionado, significa que no se pudo leer.
    const stub = createClient({ boosts: { data: null, error: { code: "42501" } } });

    const result = await fetchListingStats(stub.client, AVISO);

    expect(esIlegible(result, "promotions")).toBe(true);
    expect(result.promotions).toEqual([]);
  });

  it("en gratis no se pide el monto: la RPC ni se llama", async () => {
    const stub = createClient({});
    await fetchListingStats(stub.client, { ...AVISO, tier: "free" });
    expect(stub.rpcLlamadas.map((l) => l.name)).not.toContain("listing_boosts_for_owner");
  });
});
