import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchUrgentBroadcast } from "./alert-queries";

/**
 * Lectura de la ALERTA COMUNITARIA del feed. Las tres situaciones que pidió el
 * cliente, más los bordes que hacen que la pieza sea confiable:
 *
 *  1. sin alerta urgente vigente → null (el feed no cambia en nada);
 *  2. con una urgente vigente → esa;
 *  3. después de descartarla → null, y NO vuelve nunca.
 *
 * Y además: `info` jamás sube al feed, la vencida/programada no cuenta, entre
 * varias gana la más reciente SIN acuse, y si la query se cae el feed sigue.
 */

type Row = {
  id: string;
  title: string;
  body: string;
  cta_url: string | null;
};

const VIEWER = "8c7d6e5f-4a3b-4c2d-9e1f-0a1b2c3d4e5f";

function row(overrides: Partial<Row> = {}): Row {
  return {
    id: "b-1",
    title: "Buscamos a Ramón Peña",
    body: "Se lo vio por última vez el jueves en Washington Heights.",
    cta_url: null,
    ...overrides,
  };
}

type Result = { data: unknown; error: { code: string } | null };

/**
 * Cliente falso: registra los filtros que se aplicaron y devuelve lo que le
 * digan por tabla. Es thenable en cualquier eslabón, así que da igual el orden
 * de la cadena — lo que se verifica son los filtros, no la sintaxis.
 */
function makeSupabase(results: { broadcasts?: Result; receipts?: Result }) {
  const calls: { table: string; filters: Record<string, unknown> }[] = [];

  const from = vi.fn((table: string) => {
    const filters: Record<string, unknown> = {};
    calls.push({ table, filters });
    const result =
      table === "broadcasts"
        ? (results.broadcasts ?? { data: [], error: null })
        : (results.receipts ?? { data: [], error: null });

    const chain: Record<string, unknown> = {
      then: (resolve: (value: Result) => unknown) => Promise.resolve(result).then(resolve),
    };
    for (const method of ["select", "order", "limit"]) {
      chain[method] = vi.fn(() => chain);
    }
    chain.eq = vi.fn((column: string, value: unknown) => {
      filters[`eq:${column}`] = value;
      return chain;
    });
    chain.lte = vi.fn((column: string, value: unknown) => {
      filters[`lte:${column}`] = value;
      return chain;
    });
    chain.or = vi.fn((expression: string) => {
      filters.or = expression;
      return chain;
    });
    chain.in = vi.fn((column: string, value: unknown) => {
      filters[`in:${column}`] = value;
      return chain;
    });
    return chain;
  });

  // El tipo real es SupabaseClient<Database>; el doble solo implementa lo que
  // la función usa.
  return { client: { from } as never, calls };
}

const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
beforeEach(() => warn.mockClear());
afterEach(() => vi.useRealTimers());

describe("fetchUrgentBroadcast — las tres situaciones", () => {
  it("1· sin alerta urgente vigente: devuelve null", async () => {
    const { client } = makeSupabase({ broadcasts: { data: [], error: null } });
    await expect(fetchUrgentBroadcast(client, VIEWER)).resolves.toBeNull();
  });

  it("2· con una urgente vigente: la devuelve entera, con su CTA", async () => {
    const { client } = makeSupabase({
      broadcasts: { data: [row({ cta_url: "https://ayuda.example.org/acopio" })], error: null },
    });

    await expect(fetchUrgentBroadcast(client, VIEWER)).resolves.toEqual({
      id: "b-1",
      title: "Buscamos a Ramón Peña",
      body: "Se lo vio por última vez el jueves en Washington Heights.",
      ctaUrl: "https://ayuda.example.org/acopio",
    });
  });

  it("3· descartada (ya tiene acuse propio): null — no vuelve", async () => {
    const { client } = makeSupabase({
      broadcasts: { data: [row()], error: null },
      receipts: { data: [{ broadcast_id: "b-1" }], error: null },
    });

    await expect(fetchUrgentBroadcast(client, VIEWER)).resolves.toBeNull();
  });
});

describe("fetchUrgentBroadcast — qué sube al feed y qué no", () => {
  it("pide SOLO severity='urgent': los `info` se quedan en notificaciones", async () => {
    const { client, calls } = makeSupabase({ broadcasts: { data: [row()], error: null } });
    await fetchUrgentBroadcast(client, VIEWER);

    const broadcasts = calls.find((call) => call.table === "broadcasts");
    expect(broadcasts?.filters["eq:severity"]).toBe("urgent");
  });

  it("filtra la ventana en la QUERY, no solo en la policy (el admin ve todo)", async () => {
    // `broadcasts_select` es `is_global_admin() OR (ventana AND targeteado)`:
    // sin este filtro, al súper admin le aparecerían en el feed las vencidas y
    // las programadas para el mes que viene.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-27T15:00:00.000Z"));

    const { client, calls } = makeSupabase({ broadcasts: { data: [row()], error: null } });
    await fetchUrgentBroadcast(client, VIEWER);

    const broadcasts = calls.find((call) => call.table === "broadcasts");
    expect(broadcasts?.filters["lte:starts_at"]).toBe("2026-07-27T15:00:00.000Z");
    expect(broadcasts?.filters.or).toBe(
      "ends_at.is.null,ends_at.gt.2026-07-27T15:00:00.000Z",
    );
  });

  it("los acuses se piden SOLO los propios (el admin ve los de todos)", async () => {
    const { client, calls } = makeSupabase({ broadcasts: { data: [row()], error: null } });
    await fetchUrgentBroadcast(client, VIEWER);

    const receipts = calls.find((call) => call.table === "broadcast_receipts");
    expect(receipts?.filters["eq:profile_id"]).toBe(VIEWER);
  });

  it("entre varias vigentes gana la más reciente SIN acuse, nunca se apilan", async () => {
    // La primera (más reciente) ya fue descartada: tiene que salir la siguiente,
    // no null — si no, una emergencia sin ver quedaría tapada para siempre.
    const { client } = makeSupabase({
      broadcasts: {
        data: [row({ id: "nueva" }), row({ id: "vieja", title: "Centro de acopio" })],
        error: null,
      },
      receipts: { data: [{ broadcast_id: "nueva" }], error: null },
    });

    const result = await fetchUrgentBroadcast(client, VIEWER);
    expect(result?.id).toBe("vieja");
    expect(result?.title).toBe("Centro de acopio");
  });

  it("sin sesión no consulta nada: las policies son `to authenticated`", async () => {
    const { client, calls } = makeSupabase({ broadcasts: { data: [row()], error: null } });
    await expect(fetchUrgentBroadcast(client, null)).resolves.toBeNull();
    expect(calls).toHaveLength(0);
  });
});

describe("fetchUrgentBroadcast — el feed NUNCA se rompe por la alerta", () => {
  it("si la columna severity no existe (0041 sin aplicar): null y sigue", async () => {
    const { client } = makeSupabase({
      broadcasts: { data: null, error: { code: "42703" } },
    });

    await expect(fetchUrgentBroadcast(client, VIEWER)).resolves.toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it("si la query explota, se traga la excepción: devuelve null", async () => {
    const client = {
      from: () => {
        throw new Error("conexión caída");
      },
    } as never;

    await expect(fetchUrgentBroadcast(client, VIEWER)).resolves.toBeNull();
  });

  it("si fallan los acuses, la alerta se muestra igual (mejor de más que de menos)", async () => {
    const { client } = makeSupabase({
      broadcasts: { data: [row()], error: null },
      receipts: { data: null, error: { code: "PGRST301" } },
    });

    const result = await fetchUrgentBroadcast(client, VIEWER);
    expect(result?.id).toBe("b-1");
  });
});
