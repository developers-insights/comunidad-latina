import { afterEach, describe, expect, it, vi } from "vitest";

import {
  requireIdentidadVerificada,
  verticalExigeIdentidad,
  VERTICALES_QUE_EXIGEN_IDENTIDAD,
} from "./gate";

/**
 * Los tests están escritos contra el CONTRATO de la migración 0106, no contra la
 * implementación: cada bloque de `verticalExigeIdentidad` corresponde a una rama
 * de `app.vertical_exige_identidad()`. Si alguien cambia una de las dos sin la
 * otra, esto se pone rojo — que es exactamente para lo que existe.
 */

type RpcArgs = { p_kind: string; p_price: number | null };

/** Cliente falso: sólo implementa `.rpc()`, que es lo único que el gate usa. */
function supabaseFalso(
  respuesta: { data: unknown; error: { code: string } | null },
  espia?: (fn: string, args: RpcArgs) => void,
) {
  return {
    rpc: async (fn: string, args: RpcArgs) => {
      espia?.(fn, args);
      return respuesta;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("verticalExigeIdentidad", () => {
  it.each(VERTICALES_QUE_EXIGEN_IDENTIDAD)(
    "exige identidad en '%s' sin importar el precio",
    (kind) => {
      expect(verticalExigeIdentidad(kind)).toBe(true);
      expect(verticalExigeIdentidad(kind, 0)).toBe(true);
      expect(verticalExigeIdentidad(kind, null)).toBe(true);
    },
  );

  it("no exige identidad en un evento GRATIS", () => {
    expect(verticalExigeIdentidad("event")).toBe(false);
    expect(verticalExigeIdentidad("event", null)).toBe(false);
    expect(verticalExigeIdentidad("event", 0)).toBe(false);
  });

  it("exige identidad en un evento que cobra entrada", () => {
    expect(verticalExigeIdentidad("event", 1)).toBe(true);
    expect(verticalExigeIdentidad("event", 0.5)).toBe(true);
  });

  it("acepta el precio como string, que es como llega de un formulario", () => {
    expect(verticalExigeIdentidad("event", "25")).toBe(true);
    expect(verticalExigeIdentidad("event", " 25.50 ")).toBe(true);
    // Coma decimal: sin la normalización esto sería NaN y el evento pago pasaría
    // como gratis.
    expect(verticalExigeIdentidad("event", "12,50")).toBe(true);
    expect(verticalExigeIdentidad("event", "0")).toBe(false);
    expect(verticalExigeIdentidad("event", "")).toBe(false);
    expect(verticalExigeIdentidad("event", "gratis")).toBe(false);
  });

  it("no exige identidad en las verticales que la 0106 dejó afuera", () => {
    for (const kind of ["business", "professional", "creator_gig", "lost_found"]) {
      expect(verticalExigeIdentidad(kind, 999)).toBe(false);
    }
  });

  it("un precio negativo o no finito no convierte un evento en pago", () => {
    expect(verticalExigeIdentidad("event", -10)).toBe(false);
    expect(verticalExigeIdentidad("event", Number.NaN)).toBe(false);
    expect(verticalExigeIdentidad("event", Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe("requireIdentidadVerificada", () => {
  it("no viaja a la base cuando la vertical no exige identidad", async () => {
    let llamadas = 0;
    const supabase = supabaseFalso({ data: null, error: null }, () => {
      llamadas += 1;
    });

    await expect(
      requireIdentidadVerificada(supabase, { kind: "business" }),
    ).resolves.toEqual({ permitido: true });
    await expect(
      requireIdentidadVerificada(supabase, { kind: "event", precio: 0 }),
    ).resolves.toEqual({ permitido: true });

    expect(llamadas).toBe(0);
  });

  it("deja pasar cuando la base contesta true", async () => {
    const supabase = supabaseFalso({ data: true, error: null });
    await expect(
      requireIdentidadVerificada(supabase, { kind: "property" }),
    ).resolves.toEqual({ permitido: true });
  });

  it("bloquea con motivo identidad_no_verificada cuando la base contesta false", async () => {
    const supabase = supabaseFalso({ data: false, error: null });
    await expect(
      requireIdentidadVerificada(supabase, { kind: "job" }),
    ).resolves.toEqual({ permitido: false, motivo: "identidad_no_verificada" });
  });

  it("le manda a la RPC el kind y el precio ya normalizado", async () => {
    const vistos: Array<{ fn: string; args: RpcArgs }> = [];
    const supabase = supabaseFalso({ data: true, error: null }, (fn, args) =>
      vistos.push({ fn, args }),
    );

    await requireIdentidadVerificada(supabase, { kind: "event", precio: "12,50" });

    expect(vistos).toEqual([
      { fn: "puedo_publicar_vertical", args: { p_kind: "event", p_price: 12.5 } },
    ]);
  });

  it("FALLA CERRADO ante un error de la base", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const supabase = supabaseFalso({ data: null, error: { code: "PGRST301" } });

    await expect(
      requireIdentidadVerificada(supabase, { kind: "property" }),
    ).resolves.toEqual({ permitido: false, motivo: "indeterminado" });
  });

  it("FALLA CERRADO ante un null — la RPC puede no existir todavía en esa base", async () => {
    const supabase = supabaseFalso({ data: null, error: null });
    await expect(
      requireIdentidadVerificada(supabase, { kind: "product" }),
    ).resolves.toEqual({ permitido: false, motivo: "indeterminado" });
  });

  it("no confunde un truthy con un permiso: sólo `true` abre la puerta", async () => {
    for (const data of [1, "true", {}, []]) {
      const supabase = supabaseFalso({ data, error: null });
      await expect(
        requireIdentidadVerificada(supabase, { kind: "property" }),
      ).resolves.toEqual({ permitido: false, motivo: "indeterminado" });
    }
  });
});
