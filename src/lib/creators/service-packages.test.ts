import { describe, expect, it } from "vitest";
import {
  DESCRIPTION_MAX,
  MAX_INCLUDES,
  MAX_INCLUDE_LENGTH,
  MAX_PRICE_CENTS,
  buildPackageScope,
  normalizeIncludes,
  parsePackagePrice,
  reindexOrder,
} from "./service-packages";

/**
 * Reglas puras de los paquetes de servicio (0102).
 *
 * Lo que se prueba acá es exactamente lo que la base también exige por CHECK:
 * si algún día divergen, uno de los dos lados está mintiendo.
 */

describe("parsePackagePrice — el precio de un paquete", () => {
  it("acepta enteros y dos decimales, con coma o punto", () => {
    expect(parsePackagePrice("800")).toEqual({ ok: true, cents: 80_000 });
    expect(parsePackagePrice("150,50")).toEqual({ ok: true, cents: 15_050 });
    expect(parsePackagePrice("150.5")).toEqual({ ok: true, cents: 15_050 });
    expect(parsePackagePrice("$19")).toEqual({ ok: true, cents: 1_900 });
  });

  it("NO acepta cero — un paquete gratis no tiene qué poner en garantía", () => {
    // `parseAmountToCents` sí acepta 0 (para el resto de la app gratis es un
    // precio). Acá la base lo prohíbe con `price_cents > 0`, así que el módulo
    // tiene que rechazarlo ANTES y con un mensaje propio.
    expect(parsePackagePrice("0")).toEqual({ ok: false, reason: "cero" });
    expect(parsePackagePrice("0,00")).toEqual({ ok: false, reason: "cero" });
  });

  it("rechaza negativos, tres decimales y separadores de miles ambiguos", () => {
    expect(parsePackagePrice("-5").ok).toBe(false);
    expect(parsePackagePrice("19.999").ok).toBe(false);
    // "1.234" es mil doscientos treinta y cuatro en español y 1,234 en inglés:
    // adivinar cuál quiso decir quien lo tipeó es justo lo que no corresponde.
    expect(parsePackagePrice("1.234,56").ok).toBe(false);
  });

  it("rechaza lo que supera el techo del contrato", () => {
    // Un centavo por encima del máximo de gig_contracts.amount_cents: un
    // paquete que no se pueda convertir en contrato sería una trampa.
    const overflow = String(MAX_PRICE_CENTS / 100 + 1);
    expect(parsePackagePrice(overflow)).toEqual({ ok: false, reason: "demasiado_grande" });
    expect(parsePackagePrice(String(MAX_PRICE_CENTS / 100)).ok).toBe(true);
  });

  it("rechaza el vacío con su propio motivo", () => {
    expect(parsePackagePrice("")).toEqual({ ok: false, reason: "vacio" });
    expect(parsePackagePrice("   ")).toEqual({ ok: false, reason: "vacio" });
  });

  it("no pierde un centavo en el caso clásico del flotante", () => {
    // Math.round(1.005 * 100) da 100 y no 101 porque 1.005 en binario es
    // 1.00499…. El parser del repo trabaja con enteros, así que da 101.
    expect(parsePackagePrice("1,005").ok).toBe(false); // tres decimales
    expect(parsePackagePrice("1,01")).toEqual({ ok: true, cents: 101 });
  });
});

describe("normalizeIncludes — los renglones del «incluye»", () => {
  it("limpia espacios, descarta vacíos y respeta el orden", () => {
    expect(normalizeIncludes(["  3 reels  ", "", "   ", "1 ronda de cambios"])).toEqual([
      "3 reels",
      "1 ronda de cambios",
    ]);
  });

  it("saca repetidos sin distinguir mayúsculas", () => {
    expect(normalizeIncludes(["3 Reels", "3 reels", "3 REELS"])).toEqual(["3 Reels"]);
  });

  it("recorta al tope de renglones y de largo", () => {
    const many = Array.from({ length: MAX_INCLUDES + 4 }, (_, i) => `renglón ${i}`);
    expect(normalizeIncludes(many)).toHaveLength(MAX_INCLUDES);

    const long = "x".repeat(MAX_INCLUDE_LENGTH + 30);
    expect(normalizeIncludes([long])[0]).toHaveLength(MAX_INCLUDE_LENGTH);
  });
});

describe("buildPackageScope — del paquete al contrato", () => {
  it("arma descripción + viñetas del incluye", () => {
    const scope = buildPackageScope({
      description: "Tres videos verticales editados.",
      includes: ["3 reels de 30s", "1 ronda de cambios"],
    });
    expect(scope).toBe("Tres videos verticales editados.\n\n• 3 reels de 30s\n• 1 ronda de cambios");
  });

  it("sin incluye, es la descripción sola", () => {
    expect(buildPackageScope({ description: "Sesión de fotos.", includes: [] })).toBe(
      "Sesión de fotos.",
    );
  });

  it("nunca supera el techo que acepta proposeContract", () => {
    // Un scope de 2001 caracteres haría fallar la propuesta con un error
    // genérico y nadie entendería por qué.
    const scope = buildPackageScope({
      description: "a".repeat(DESCRIPTION_MAX),
      includes: ["algo más"],
    });
    expect(scope.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
  });
});

describe("reindexOrder — reordenar", () => {
  it("renumera desde cero, sin huecos", () => {
    expect(reindexOrder(["c", "a", "b"])).toEqual([
      { id: "c", sortOrder: 0 },
      { id: "a", sortOrder: 1 },
      { id: "b", sortOrder: 2 },
    ]);
  });

  it("con una lista vacía no inventa filas", () => {
    expect(reindexOrder([])).toEqual([]);
  });
});
