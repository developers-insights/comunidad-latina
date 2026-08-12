import { describe, expect, it } from "vitest";
import {
  LOST_FOUND_MAX_AGE_DAYS,
  buildLostFoundAttrs,
  isAcceptableHappenedOn,
  isPlainDate,
  isResolvedCase,
  parseLostFoundAttrs,
  sanitizeAreaFilter,
  sortCasesOpenFirst,
  toLostFoundCategory,
  toLostFoundType,
} from "./perdidos";

const HOY = new Date("2026-08-12T00:00:00Z");

describe("parseLostFoundAttrs", () => {
  it("lee un attrs completo", () => {
    expect(
      parseLostFoundAttrs({
        lf_type: "found",
        lf_category: "mochila",
        lf_happened_on: "2026-08-01",
        lf_resolved_at: "2026-08-10T12:00:00+00:00",
      }),
    ).toEqual({
      type: "found",
      category: "mochila",
      happenedOn: "2026-08-01",
      resolvedAt: "2026-08-10T12:00:00+00:00",
    });
  });

  it("no rompe con basura: jsonb no garantiza ninguna forma", () => {
    const vacio = { type: null, category: null, happenedOn: null, resolvedAt: null };
    expect(parseLostFoundAttrs(null)).toEqual(vacio);
    expect(parseLostFoundAttrs("un string")).toEqual(vacio);
    expect(parseLostFoundAttrs([1, 2, 3])).toEqual(vacio);
    expect(parseLostFoundAttrs({ lf_type: 42 })).toEqual(vacio);
  });

  it("descarta valores fuera del contrato en vez de propagarlos", () => {
    const parsed = parseLostFoundAttrs({
      lf_type: "robado",
      lf_category: "auto",
      lf_happened_on: "01/08/2026",
    });
    expect(parsed.type).toBeNull();
    expect(parsed.category).toBeNull();
    expect(parsed.happenedOn).toBeNull();
  });

  it("una fecha con forma correcta pero inexistente NO pasa", () => {
    // new Date("2026-02-31") se corre sola al 3 de marzo en vez de fallar.
    expect(isPlainDate("2026-02-31")).toBe(false);
    expect(parseLostFoundAttrs({ lf_happened_on: "2026-02-31" }).happenedOn).toBeNull();
    expect(isPlainDate("2026-02-28")).toBe(true);
  });
});

describe("buildLostFoundAttrs", () => {
  it("arma el attrs del insert", () => {
    expect(
      buildLostFoundAttrs({ type: "lost", category: "llaves", happenedOn: "2026-08-01" }),
    ).toEqual({ lf_type: "lost", lf_category: "llaves", lf_happened_on: "2026-08-01" });
  });

  it("omite la fecha en vez de escribirla en null", () => {
    expect(buildLostFoundAttrs({ type: "lost", category: "otro" })).toEqual({
      lf_type: "lost",
      lf_category: "otro",
    });
    expect(
      buildLostFoundAttrs({ type: "lost", category: "otro", happenedOn: "no es fecha" }),
    ).not.toHaveProperty("lf_happened_on");
  });

  it("lo que arma se puede volver a leer", () => {
    const attrs = buildLostFoundAttrs({
      type: "found",
      category: "telefono",
      happenedOn: "2026-07-04",
    });
    expect(parseLostFoundAttrs(attrs)).toEqual({
      type: "found",
      category: "telefono",
      happenedOn: "2026-07-04",
      resolvedAt: null,
    });
  });
});

describe("isResolvedCase", () => {
  it("resuelto es tener fecha de resolución, nada más", () => {
    expect(isResolvedCase(parseLostFoundAttrs({ lf_resolved_at: "2026-08-10T00:00:00Z" }))).toBe(
      true,
    );
    expect(isResolvedCase(parseLostFoundAttrs({ lf_type: "lost" }))).toBe(false);
  });
});

describe("sanitizeAreaFilter", () => {
  it("deja pasar una zona normal", () => {
    expect(sanitizeAreaFilter("  Jackson Heights  ")).toBe("Jackson Heights");
  });

  it("escapa los comodines de LIKE: con '%' se devolvía la sección entera", () => {
    expect(sanitizeAreaFilter("100%")).toBe("100\\%");
    expect(sanitizeAreaFilter("a_b")).toBe("a\\_b");
  });

  it("escapa la barra invertida ANTES que el resto", () => {
    expect(sanitizeAreaFilter("a\\%b")).toBe("a\\\\\\%b");
  });

  it("devuelve vacío cuando no hay nada útil que filtrar", () => {
    expect(sanitizeAreaFilter("")).toBe("");
    expect(sanitizeAreaFilter("   ")).toBe("");
    expect(sanitizeAreaFilter("a")).toBe("");
    expect(sanitizeAreaFilter(null)).toBe("");
    expect(sanitizeAreaFilter(undefined)).toBe("");
  });

  it("corta a 80 caracteres, el largo real de area_label", () => {
    expect(sanitizeAreaFilter("z".repeat(500))).toHaveLength(80);
  });
});

describe("toLostFoundType / toLostFoundCategory", () => {
  it("acepta sólo lo del contrato", () => {
    expect(toLostFoundType("lost")).toBe("lost");
    expect(toLostFoundType("found")).toBe("found");
    expect(toLostFoundType("cualquiera")).toBeNull();
    expect(toLostFoundType(undefined)).toBeNull();
    expect(toLostFoundCategory("mascota")).toBe("mascota");
    expect(toLostFoundCategory("bicicleta")).toBeNull();
  });
});

describe("isAcceptableHappenedOn", () => {
  it("acepta hoy y el pasado reciente", () => {
    expect(isAcceptableHappenedOn("2026-08-12", HOY)).toBe(true);
    expect(isAcceptableHappenedOn("2026-08-01", HOY)).toBe(true);
  });

  it("rechaza el futuro", () => {
    expect(isAcceptableHappenedOn("2026-08-13", HOY)).toBe(false);
  });

  it("rechaza lo más viejo que el tope", () => {
    const limite = new Date(HOY.getTime() - LOST_FOUND_MAX_AGE_DAYS * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const anterior = new Date(HOY.getTime() - (LOST_FOUND_MAX_AGE_DAYS + 1) * 86_400_000)
      .toISOString()
      .slice(0, 10);
    expect(isAcceptableHappenedOn(limite, HOY)).toBe(true);
    expect(isAcceptableHappenedOn(anterior, HOY)).toBe(false);
  });

  it("rechaza lo que ni siquiera es una fecha", () => {
    expect(isAcceptableHappenedOn("ayer", HOY)).toBe(false);
  });
});

describe("sortCasesOpenFirst", () => {
  it("los abiertos van primero y el orden relativo no se toca", () => {
    const casos = [
      { id: "a", resolvedAt: "2026-08-10T00:00:00Z" },
      { id: "b", resolvedAt: null },
      { id: "c", resolvedAt: "2026-08-09T00:00:00Z" },
      { id: "d", resolvedAt: null },
    ];
    expect(sortCasesOpenFirst(casos).map((caso) => caso.id)).toEqual(["b", "d", "a", "c"]);
  });

  it("no muta el arreglo original", () => {
    const casos = [{ id: "a", resolvedAt: "x" }, { id: "b", resolvedAt: null }];
    sortCasesOpenFirst(casos);
    expect(casos.map((caso) => caso.id)).toEqual(["a", "b"]);
  });
});
