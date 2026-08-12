import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database.types";
import {
  DEFAULT_FEE_PCT,
  getCreatorCommission,
  normalizeFeePct,
  splitCents,
} from "./commission";

/**
 * Lo que estos tests protegen es un número que ve un usuario: el "vas a cobrar
 * $X" que la app muestra ANTES de crear el contrato tiene que coincidir centavo
 * a centavo con lo que después calculan las columnas generadas de la base. Si
 * difieren, del lado del creador no se ve como un redondeo: se ve como que la
 * plataforma le descontó más de lo que le dijo.
 *
 * La referencia es la 0087:
 *     platform_fee_cents = ((amount_cents::bigint * fee_pct) / 100)::int
 *     creator_net_cents  = (amount_cents - ((amount_cents::bigint * fee_pct) / 100))::int
 * y la división entera de Postgres TRUNCA hacia cero.
 */

/** Reproduce la columna generada con la aritmética exacta de Postgres. */
function postgresSplit(amountCents: bigint, feePct: bigint) {
  const fee = (amountCents * feePct) / BigInt(100); // BigInt divide truncando hacia cero
  return { platformFeeCents: Number(fee), creatorNetCents: Number(amountCents - fee) };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("splitCents — el ejemplo del cliente", () => {
  it("$1000 → $800 para el creador y $200 para la plataforma", () => {
    expect(splitCents(100_000, 20)).toEqual({
      platformFeeCents: 20_000,
      creatorNetCents: 80_000,
    });
  });

  it("comisión 0: el creador cobra todo", () => {
    expect(splitCents(100_000, 0)).toEqual({
      platformFeeCents: 0,
      creatorNetCents: 100_000,
    });
  });
});

describe("splitCents — redondeo idéntico al de la base", () => {
  it("trunca hacia abajo, no redondea al más cercano", () => {
    // 333 * 20 / 100 = 66.6 → Postgres da 66, no 67.
    expect(splitCents(333, 20).platformFeeCents).toBe(66);
    // 999 * 15 / 100 = 149.85 → 149.
    expect(splitCents(999, 15).platformFeeCents).toBe(149);
    // 1 centavo con 50%: 0.5 → 0. El creador cobra el centavo entero.
    expect(splitCents(1, 50)).toEqual({ platformFeeCents: 0, creatorNetCents: 1 });
  });

  it("fee + net suma SIEMPRE el monto exacto, incluso truncando", () => {
    for (const amount of [1, 7, 333, 999, 1_234, 99_999, 100_000, 12_345_678]) {
      for (const pct of [0, 1, 3, 7, 13, 20, 33, 50]) {
        const { platformFeeCents, creatorNetCents } = splitCents(amount, pct);
        expect(platformFeeCents + creatorNetCents).toBe(amount);
      }
    }
  });

  it("coincide con la aritmética de Postgres en casos de redondeo feos", () => {
    const casos: Array<[number, number]> = [
      [333, 20],
      [999, 15],
      [1, 50],
      [7, 3],
      [1_234_567, 13],
      [99_999_999, 33],
      // El caso que en 0024 desbordaba int4 antes del cast a bigint:
      // 100.000.000 × 50 = 5.000.000.000 > 2.147.483.647.
      [100_000_000, 50],
      [100_000_000, 20],
    ];
    for (const [amount, pct] of casos) {
      expect(splitCents(amount, pct)).toEqual(postgresSplit(BigInt(amount), BigInt(pct)));
    }
  });
});

describe("normalizeFeePct — un porcentaje inválido nunca cambia lo que se cobra", () => {
  it("acepta el rango del CHECK (0..50)", () => {
    expect(normalizeFeePct(0)).toBe(0);
    expect(normalizeFeePct(15)).toBe(15);
    expect(normalizeFeePct(50)).toBe(50);
  });

  it("fuera de rango cae al default, no al extremo", () => {
    expect(normalizeFeePct(-5)).toBe(DEFAULT_FEE_PCT);
    expect(normalizeFeePct(51)).toBe(DEFAULT_FEE_PCT);
    expect(normalizeFeePct(1_000)).toBe(DEFAULT_FEE_PCT);
  });

  it("basura de cualquier tipo cae al default", () => {
    expect(normalizeFeePct(null)).toBe(DEFAULT_FEE_PCT);
    expect(normalizeFeePct(undefined)).toBe(DEFAULT_FEE_PCT);
    expect(normalizeFeePct("veinte")).toBe(DEFAULT_FEE_PCT);
    expect(normalizeFeePct(Number.NaN)).toBe(DEFAULT_FEE_PCT);
    expect(normalizeFeePct(Number.POSITIVE_INFINITY)).toBe(DEFAULT_FEE_PCT);
    expect(normalizeFeePct({})).toBe(DEFAULT_FEE_PCT);
  });

  it("un decimal se vuelve entero (la columna de la base es int)", () => {
    expect(normalizeFeePct(19.6)).toBe(20);
    expect(normalizeFeePct("15")).toBe(15);
  });
});

/** Cliente mínimo: sólo `.rpc()`, que es lo único que toca este módulo. */
function stubClient(response: { data?: unknown; error?: { code: string } | null }) {
  const rpc = vi.fn().mockResolvedValue({ data: response.data ?? null, error: response.error ?? null });
  return { client: { rpc } as unknown as SupabaseClient<Database>, rpc };
}

describe("getCreatorCommission", () => {
  it("lee la comisión del tenant sin pasarle tenant_id (lo deriva el JWT)", async () => {
    const { client, rpc } = stubClient({ data: 15 });
    await expect(getCreatorCommission(client)).resolves.toBe(15);
    expect(rpc).toHaveBeenCalledWith("get_creator_commission");
    // Si algún día alguien le agrega un argumento, este test lo frena: pasar el
    // tenant desde el cliente es el agujero multi-tenant que evitamos.
    expect(rpc.mock.calls[0]).toHaveLength(1);
  });

  it("acepta la fila envuelta en array (PostgREST devuelve las dos formas)", async () => {
    const { client } = stubClient({ data: [0] });
    await expect(getCreatorCommission(client)).resolves.toBe(0);
  });

  it("si la base falla va el default 20 — nunca lanza", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { client } = stubClient({ error: { code: "42883" } });
    await expect(getCreatorCommission(client)).resolves.toBe(DEFAULT_FEE_PCT);
    expect(warn).toHaveBeenCalled();
  });

  it("si el cliente explota va el default 20 — tampoco lanza", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const roto = {
      rpc: vi.fn().mockRejectedValue(new Error("sin red")),
    } as unknown as SupabaseClient<Database>;
    await expect(getCreatorCommission(roto)).resolves.toBe(DEFAULT_FEE_PCT);
    expect(warn).toHaveBeenCalled();
  });

  it("un valor imposible en la config no afloja la comisión", async () => {
    const { client } = stubClient({ data: 900 });
    await expect(getCreatorCommission(client)).resolves.toBe(DEFAULT_FEE_PCT);
  });
});
