import { describe, expect, it } from "vitest";
import {
  PROPERTY_OPERATIONS,
  PROPERTY_OPERATION_ATTR,
  PROPERTY_OPERATION_LABEL,
  PROPERTY_OPERATION_OPTIONS,
  PROPERTY_TYPES,
  PROPERTY_TYPE_ATTR,
  PROPERTY_TYPE_LABEL,
  PROPERTY_TYPE_OPTIONS,
  isRecurringPricePeriod,
  normalizePropertyOperation,
  normalizePropertyType,
  propertyOperationLabel,
  propertyTypeLabel,
  readPropertyFacts,
  resolvePricePeriod,
} from "./tipos";

/**
 * Estos tests cuidan tres cosas, en orden de importancia:
 *
 *  1. Que un aviso VIEJO (sin los campos nuevos) siga siendo legible y no
 *     reciba un valor inventado. Es lo más fácil de romper y lo que más duele.
 *  2. Que los normalizadores no lancen NUNCA, con nada.
 *  3. Que la relación operación ↔ período de precio sea la que está escrita.
 */

// ---------------------------------------------------------------------------
// Catálogo
// ---------------------------------------------------------------------------

describe("claves de attrs", () => {
  /**
   * Los nombres están CONGELADOS. Son las claves reales de `listings.attrs` en
   * producción: renombrarlas no rompe ningún tipo —`attrs` es JSONB libre— pero
   * deja huérfano todo lo ya publicado, que seguiría guardado bajo el nombre
   * viejo y desaparecería de los filtros sin un solo error.
   */
  it("no cambian de nombre", () => {
    expect(PROPERTY_TYPE_ATTR).toBe("property_type");
    expect(PROPERTY_OPERATION_ATTR).toBe("operation");
  });
});

describe("catálogo", () => {
  it("cubre lo que la comunidad publica de verdad", () => {
    expect(PROPERTY_TYPES).toContain("casa");
    expect(PROPERTY_TYPES).toContain("departamento");
    expect(PROPERTY_TYPES).toContain("cuarto");
    expect(PROPERTY_TYPES).toContain("estudio");
    expect(PROPERTY_TYPES).toContain("townhouse");
    expect(PROPERTY_TYPES).toContain("local_comercial");
    expect(PROPERTY_TYPES).toContain("terreno");
    expect(PROPERTY_TYPES).toContain("otro");
  });

  it("ofrece exactamente venta y alquiler", () => {
    expect([...PROPERTY_OPERATIONS].sort()).toEqual(["alquiler", "venta"]);
  });

  it("todo valor tiene etiqueta humana y no técnica", () => {
    for (const type of PROPERTY_TYPES) {
      const label = PROPERTY_TYPE_LABEL[type];
      expect(label.length).toBeGreaterThan(2);
      expect(label).not.toContain("_");
    }
    for (const operation of PROPERTY_OPERATIONS) {
      expect(PROPERTY_OPERATION_LABEL[operation].length).toBeGreaterThan(2);
    }
  });

  it("las opciones espejan el catálogo, en el mismo orden y con 'Otro' al final", () => {
    expect(PROPERTY_TYPE_OPTIONS.map((option) => option.value)).toEqual([...PROPERTY_TYPES]);
    expect(PROPERTY_TYPE_OPTIONS.at(-1)?.value).toBe("otro");
    expect(PROPERTY_OPERATION_OPTIONS.map((option) => option.value)).toEqual([
      ...PROPERTY_OPERATIONS,
    ]);
    // Cada operación explica qué cambia al elegirla (el precio se lee distinto).
    for (const option of PROPERTY_OPERATION_OPTIONS) {
      expect(option.hint.length).toBeGreaterThan(10);
    }
  });
});

// ---------------------------------------------------------------------------
// Normalizadores
// ---------------------------------------------------------------------------

describe("normalizePropertyType", () => {
  it("acepta los valores canónicos", () => {
    for (const type of PROPERTY_TYPES) {
      expect(normalizePropertyType(type)).toBe(type);
    }
  });

  it("tolera mayúsculas, acentos, espacios y guiones", () => {
    expect(normalizePropertyType("  CASA  ")).toBe("casa");
    expect(normalizePropertyType("Local Comercial")).toBe("local_comercial");
    expect(normalizePropertyType("local-comercial")).toBe("local_comercial");
    expect(normalizePropertyType("habitación")).toBe("cuarto");
    expect(normalizePropertyType("Recámara")).toBe("cuarto");
  });

  it("entiende cómo se dice de verdad en Estados Unidos", () => {
    expect(normalizePropertyType("apartamento")).toBe("departamento");
    expect(normalizePropertyType("depto")).toBe("departamento");
    expect(normalizePropertyType("apartment")).toBe("departamento");
    expect(normalizePropertyType("room")).toBe("cuarto");
    expect(normalizePropertyType("studio")).toBe("estudio");
    expect(normalizePropertyType("town house")).toBe("townhouse");
  });

  it("devuelve null ante basura, sin lanzar", () => {
    const garbage: unknown[] = [
      null,
      undefined,
      "",
      "   ",
      "castillo",
      "🏠",
      42,
      0,
      NaN,
      true,
      false,
      {},
      { value: "casa" },
      [],
      ["casa"],
      () => "casa",
      Symbol("casa"),
      BigInt(123),
      new Date(),
    ];
    for (const value of garbage) {
      expect(() => normalizePropertyType(value)).not.toThrow();
      expect(normalizePropertyType(value)).toBeNull();
    }
  });

  it("no confunde un objeto con toString() con un valor válido", () => {
    // Un JSONB puede traer cualquier forma; sólo un string cuenta como dato.
    expect(normalizePropertyType({ toString: () => "casa" })).toBeNull();
  });
});

describe("normalizePropertyOperation", () => {
  it("acepta los valores canónicos y sus sinónimos reales", () => {
    expect(normalizePropertyOperation("alquiler")).toBe("alquiler");
    expect(normalizePropertyOperation("venta")).toBe("venta");
    expect(normalizePropertyOperation("Renta")).toBe("alquiler");
    expect(normalizePropertyOperation("for rent")).toBe("alquiler");
    expect(normalizePropertyOperation("arriendo")).toBe("alquiler");
    expect(normalizePropertyOperation("FOR-SALE")).toBe("venta");
    expect(normalizePropertyOperation("vendo")).toBe("venta");
  });

  it("devuelve null ante basura, sin lanzar", () => {
    for (const value of [null, undefined, "", "permuta", 1, {}, [], NaN, true]) {
      expect(() => normalizePropertyOperation(value)).not.toThrow();
      expect(normalizePropertyOperation(value)).toBeNull();
    }
  });
});

describe("etiquetas", () => {
  it("traducen un valor reconocido", () => {
    expect(propertyTypeLabel("cuarto")).toBe("Cuarto o habitación");
    expect(propertyTypeLabel("apartamento")).toBe("Departamento");
    expect(propertyOperationLabel("renta")).toBe("Alquiler");
  });

  it("devuelven null cuando no hay nada que traducir", () => {
    expect(propertyTypeLabel(null)).toBeNull();
    expect(propertyTypeLabel("no-existe")).toBeNull();
    expect(propertyOperationLabel(undefined)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Lectura desde attrs — RETROCOMPATIBILIDAD
// ---------------------------------------------------------------------------

describe("readPropertyFacts", () => {
  it("lee un aviso nuevo completo", () => {
    expect(
      readPropertyFacts({
        bedrooms: 2,
        [PROPERTY_TYPE_ATTR]: "departamento",
        [PROPERTY_OPERATION_ATTR]: "alquiler",
      }),
    ).toEqual({ type: "departamento", operation: "alquiler" });
  });

  it("un aviso VIEJO queda 'no declarado' — nunca con un valor inventado", () => {
    // Exactamente los attrs que escribía el código anterior a esta feature.
    const attrsViejos = { bedrooms: 3, bathrooms: 1, sqft: 900 };
    expect(readPropertyFacts(attrsViejos)).toEqual({ type: null, operation: null });
  });

  it("NO deduce 'venta' de nada — la inferencia vieja no vuelve por la ventana", () => {
    // Un aviso con precio único y sin operación declarada sigue sin declararla.
    expect(readPropertyFacts({ price_period: "one_time" }).operation).toBeNull();
  });

  it("sobrevive a attrs de cualquier forma, sin lanzar", () => {
    for (const attrs of [null, undefined, "texto", 7, [], [1, 2], true, NaN]) {
      expect(() => readPropertyFacts(attrs)).not.toThrow();
      expect(readPropertyFacts(attrs)).toEqual({ type: null, operation: null });
    }
  });

  it("un campo roto no arrastra al otro", () => {
    expect(
      readPropertyFacts({ [PROPERTY_TYPE_ATTR]: { a: 1 }, [PROPERTY_OPERATION_ATTR]: "venta" }),
    ).toEqual({ type: null, operation: "venta" });
  });
});

// ---------------------------------------------------------------------------
// Operación ↔ período de precio
// ---------------------------------------------------------------------------

describe("isRecurringPricePeriod", () => {
  it("distingue frecuencia de precio único", () => {
    expect(isRecurringPricePeriod("month")).toBe(true);
    expect(isRecurringPricePeriod("week")).toBe(true);
    expect(isRecurringPricePeriod("day")).toBe(true);
    expect(isRecurringPricePeriod("one_time")).toBe(false);
    expect(isRecurringPricePeriod(null)).toBe(false);
    expect(isRecurringPricePeriod(3)).toBe(false);
  });
});

describe("resolvePricePeriod", () => {
  it("venta sin frecuencia → precio único", () => {
    expect(resolvePricePeriod("venta", null)).toEqual({ ok: true, period: "one_time" });
    expect(resolvePricePeriod("venta", undefined)).toEqual({ ok: true, period: "one_time" });
    expect(resolvePricePeriod("venta", "one_time")).toEqual({ ok: true, period: "one_time" });
  });

  it("venta CON frecuencia se rechaza — no elegimos cuál de los dos gana", () => {
    for (const period of ["month", "week", "day"] as const) {
      expect(resolvePricePeriod("venta", period)).toEqual({
        ok: false,
        reason: "venta_con_frecuencia",
      });
    }
  });

  it("alquiler conserva la frecuencia que la persona eligió", () => {
    expect(resolvePricePeriod("alquiler", "month")).toEqual({ ok: true, period: "month" });
    expect(resolvePricePeriod("alquiler", "week")).toEqual({ ok: true, period: "week" });
    // Alquiler de temporada con precio cerrado: legítimo, no se toca.
    expect(resolvePricePeriod("alquiler", "one_time")).toEqual({ ok: true, period: "one_time" });
  });

  it("sin operación declarada el período pasa tal cual (cliente viejo no se rompe)", () => {
    expect(resolvePricePeriod(null, "month")).toEqual({ ok: true, period: "month" });
    expect(resolvePricePeriod(null, "one_time")).toEqual({ ok: true, period: "one_time" });
    expect(resolvePricePeriod(null, null)).toEqual({ ok: true, period: null });
  });
});
