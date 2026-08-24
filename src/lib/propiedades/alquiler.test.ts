import { describe, expect, it } from "vitest";
import {
  AVAILABLE_FROM_ATTR,
  DEPOSIT_ATTR,
  EXTRA_FEES_ATTR,
  FURNISHED_ATTR,
  FURNISHED_OPTIONS,
  FURNISHED_STATES,
  MAX_DEPOSIT,
  MAX_EXTRA_FEES_LENGTH,
  RENTAL_REQUIREMENTS,
  RENTAL_UTILITIES,
  REQUIREMENTS_ATTR,
  UTILITIES_ATTR,
  furnishedLabel,
  isEmptyRentalTerms,
  isRentalRequirement,
  isRentalUtility,
  normalizeAvailableFrom,
  normalizeFurnished,
  normalizeRequirements,
  normalizeUtilities,
  readRentalTerms,
  rentalRequirementLabel,
  rentalUtilityLabel,
} from "./alquiler";

/**
 * Estos tests cuidan, en orden de importancia:
 *
 *  1. Que un aviso VIEJO (sin ninguna de estas claves) siga siendo legible y no
 *     reciba valores inventados. Es lo más fácil de romper y lo que más duele.
 *  2. Que el DEPÓSITO EN CERO sobreviva. Es el único campo donde `0` y "no lo
 *     declaró" son cosas distintas, y es exactamente el caso que un `if (x)`
 *     descuidado convierte en null sin que nadie se entere.
 *  3. Que nada lance nunca, con nada.
 */

// ---------------------------------------------------------------------------
// Catálogo
// ---------------------------------------------------------------------------

describe("claves de attrs", () => {
  /**
   * CONGELADAS. Son las claves reales dentro del JSONB: renombrarlas no rompe
   * ningún tipo —`attrs` es libre— pero deja huérfano todo lo ya publicado, que
   * seguiría guardado bajo el nombre viejo y desaparecería sin un solo error.
   */
  it("no cambian de nombre", () => {
    expect(DEPOSIT_ATTR).toBe("deposit_amount");
    expect(EXTRA_FEES_ATTR).toBe("extra_fees");
    expect(UTILITIES_ATTR).toBe("utilities_included");
    expect(REQUIREMENTS_ATTR).toBe("rental_requirements");
    expect(FURNISHED_ATTR).toBe("furnished");
    expect(AVAILABLE_FROM_ATTR).toBe("available_from");
  });
});

describe("catálogos", () => {
  it("amueblado tiene tres estados, con etiqueta y ayuda", () => {
    expect([...FURNISHED_STATES]).toEqual(["amueblado", "parcial", "sin_amueblar"]);
    expect(FURNISHED_OPTIONS).toHaveLength(3);
    for (const option of FURNISHED_OPTIONS) {
      expect(option.label.length).toBeGreaterThan(2);
      expect(option.hint.length).toBeGreaterThan(5);
    }
  });

  it("servicios y requisitos no tienen valores repetidos", () => {
    const utilities = RENTAL_UTILITIES.map((option) => option.value);
    const requirements = RENTAL_REQUIREMENTS.map((option) => option.value);
    expect(new Set(utilities).size).toBe(utilities.length);
    expect(new Set(requirements).size).toBe(requirements.length);
  });

  /**
   * Es una decisión de producto escrita en el docblock del módulo, no una
   * casualidad del orden de la lista: agregar un requisito sobre el estatus
   * migratorio tiene que costar romper un test, no un commit distraído.
   */
  it("no hay ningún requisito sobre estatus migratorio", () => {
    const prohibidas = ["migra", "residen", "visa", "ssn", "seguro_social", "ciudadan"];
    for (const option of RENTAL_REQUIREMENTS) {
      const texto = `${option.value} ${option.label}`.toLowerCase();
      for (const palabra of prohibidas) {
        expect(texto).not.toContain(palabra);
      }
    }
  });

  it("las guardas reconocen lo del catálogo y rechazan lo demás", () => {
    expect(isRentalUtility("luz")).toBe(true);
    expect(isRentalUtility("wifi")).toBe(false);
    expect(isRentalUtility(42)).toBe(false);
    expect(isRentalRequirement("referencias")).toBe(true);
    expect(isRentalRequirement("visa")).toBe(false);
    expect(isRentalRequirement(null)).toBe(false);
  });

  it("las etiquetas salen del catálogo, o null", () => {
    expect(rentalUtilityLabel("calefaccion")).toBe("Calefacción");
    expect(rentalUtilityLabel("wifi")).toBeNull();
    expect(rentalRequirementLabel("aval")).toBe("Aval o cosigner");
    expect(rentalRequirementLabel(undefined)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Normalizadores
// ---------------------------------------------------------------------------

describe("normalizeFurnished", () => {
  it("acepta los valores canónicos", () => {
    for (const state of FURNISHED_STATES) {
      expect(normalizeFurnished(state)).toBe(state);
    }
  });

  it("tolera mayúsculas, espacios, acentos y separadores", () => {
    expect(normalizeFurnished("  AMUEBLADO ")).toBe("amueblado");
    expect(normalizeFurnished("Sin-Amueblar")).toBe("sin_amueblar");
    expect(normalizeFurnished("Parcialmente amueblado")).toBe("parcial");
  });

  it("reconoce lo que puede haber dejado un seed o una importación", () => {
    expect(normalizeFurnished("furnished")).toBe("amueblado");
    expect(normalizeFurnished("unfurnished")).toBe("sin_amueblar");
    expect(normalizeFurnished("semi amueblado")).toBe("parcial");
  });

  it("nunca lanza y devuelve null ante cualquier basura", () => {
    for (const value of [null, undefined, 42, {}, [], "", "   ", "🏠", true]) {
      expect(() => normalizeFurnished(value)).not.toThrow();
      expect(normalizeFurnished(value)).toBeNull();
    }
  });

  it("la etiqueta acompaña al normalizador", () => {
    expect(furnishedLabel("unfurnished")).toBe("Sin amueblar");
    expect(furnishedLabel("cualquier cosa")).toBeNull();
  });
});

describe("normalizeAvailableFrom", () => {
  it("acepta YYYY-MM-DD tal cual", () => {
    expect(normalizeAvailableFrom("2026-09-01")).toBe("2026-09-01");
    expect(normalizeAvailableFrom("  2026-09-01  ")).toBe("2026-09-01");
  });

  /**
   * "2026-02-31" pasa el regex y no existe en el calendario. Si se dejara pasar,
   * el aviso diría que está disponible un día que nunca va a llegar.
   */
  it("rechaza una fecha que el calendario no tiene", () => {
    expect(normalizeAvailableFrom("2026-02-31")).toBeNull();
    expect(normalizeAvailableFrom("2026-13-01")).toBeNull();
  });

  /**
   * Se guarda SIN hora y sin zona a propósito: un instante UTC haría que
   * "disponible desde el 1 de septiembre" se leyera "31 de agosto" en media
   * América.
   */
  it("rechaza cualquier cosa con hora o zona", () => {
    expect(normalizeAvailableFrom("2026-09-01T00:00:00Z")).toBeNull();
    expect(normalizeAvailableFrom("01/09/2026")).toBeNull();
  });

  it("nunca lanza", () => {
    for (const value of [null, undefined, 42, {}, [], "", "mañana"]) {
      expect(() => normalizeAvailableFrom(value)).not.toThrow();
      expect(normalizeAvailableFrom(value)).toBeNull();
    }
  });
});

describe("normalizeUtilities / normalizeRequirements", () => {
  it("devuelven el ORDEN DEL CATÁLOGO, no el de llegada", () => {
    // Dos avisos con los mismos servicios tienen que verse idénticos aunque
    // cada persona haya tocado los chips en otro orden.
    expect(normalizeUtilities(["agua", "luz"])).toEqual(["luz", "agua"]);
    expect(normalizeUtilities(["luz", "agua"])).toEqual(["luz", "agua"]);
  });

  it("descartan repetidos y valores fuera del catálogo", () => {
    expect(normalizeUtilities(["luz", "luz", "wifi", 7, null])).toEqual(["luz"]);
    expect(normalizeRequirements(["referencias", "visa", "referencias"])).toEqual([
      "referencias",
    ]);
  });

  it("nunca lanzan y devuelven [] ante cualquier cosa que no sea un arreglo", () => {
    for (const value of [null, undefined, "luz", 42, {}]) {
      expect(() => normalizeUtilities(value)).not.toThrow();
      expect(normalizeUtilities(value)).toEqual([]);
      expect(normalizeRequirements(value)).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// Lectura desde attrs
// ---------------------------------------------------------------------------

describe("readRentalTerms", () => {
  /**
   * EL TEST QUE MÁS IMPORTA. Un aviso publicado antes de esta feature no tiene
   * ninguna de las claves y tiene que salir vacío, nunca con un default: la UI
   * muestra ausencia, y nadie escribe "Sin amueblar" en un aviso cuyo dueño
   * jamás lo dijo.
   */
  it("un aviso viejo no recibe ningún valor inventado", () => {
    const terms = readRentalTerms({ bedrooms: 2, property_type: "cuarto" });
    expect(terms).toEqual({
      deposit: null,
      extraFees: null,
      utilities: [],
      requirements: [],
      furnished: null,
      availableFrom: null,
    });
    expect(isEmptyRentalTerms(terms)).toBe(true);
  });

  it("lee lo declarado", () => {
    const terms = readRentalTerms({
      [DEPOSIT_ATTR]: 1500,
      [EXTRA_FEES_ATTR]: "  agua $30 por mes  ",
      [UTILITIES_ATTR]: ["agua", "luz"],
      [REQUIREMENTS_ATTR]: ["referencias"],
      [FURNISHED_ATTR]: "parcial",
      [AVAILABLE_FROM_ATTR]: "2026-09-01",
    });
    expect(terms.deposit).toBe(1500);
    expect(terms.extraFees).toBe("agua $30 por mes");
    expect(terms.utilities).toEqual(["luz", "agua"]);
    expect(terms.requirements).toEqual(["referencias"]);
    expect(terms.furnished).toBe("parcial");
    expect(terms.availableFrom).toBe("2026-09-01");
    expect(isEmptyRentalTerms(terms)).toBe(false);
  });

  /**
   * "No pido depósito" es una afirmación fuerte y buena para quien alquila. Un
   * `if (deposit)` la borra en silencio porque 0 es falsy — y el aviso pasa de
   * decir algo valioso a no decir nada.
   */
  it("conserva el depósito en CERO y lo distingue de la ausencia", () => {
    expect(readRentalTerms({ [DEPOSIT_ATTR]: 0 }).deposit).toBe(0);
    expect(readRentalTerms({}).deposit).toBeNull();
    expect(isEmptyRentalTerms(readRentalTerms({ [DEPOSIT_ATTR]: 0 }))).toBe(false);
  });

  it("descarta un depósito imposible en vez de propagarlo", () => {
    expect(readRentalTerms({ [DEPOSIT_ATTR]: -5 }).deposit).toBeNull();
    expect(readRentalTerms({ [DEPOSIT_ATTR]: MAX_DEPOSIT + 1 }).deposit).toBeNull();
    expect(readRentalTerms({ [DEPOSIT_ATTR]: "1500" }).deposit).toBeNull();
    expect(readRentalTerms({ [DEPOSIT_ATTR]: Number.NaN }).deposit).toBeNull();
  });

  it("recorta los cargos adicionales al tope", () => {
    const largo = "x".repeat(MAX_EXTRA_FEES_LENGTH + 50);
    expect(readRentalTerms({ [EXTRA_FEES_ATTR]: largo }).extraFees).toHaveLength(
      MAX_EXTRA_FEES_LENGTH,
    );
    // Un string en blanco NO es una declaración.
    expect(readRentalTerms({ [EXTRA_FEES_ATTR]: "   " }).extraFees).toBeNull();
  });

  it("nunca lanza, con cualquier forma de attrs", () => {
    for (const attrs of [null, undefined, 42, "texto", [], [1, 2], { [UTILITIES_ATTR]: "luz" }]) {
      expect(() => readRentalTerms(attrs)).not.toThrow();
    }
    expect(readRentalTerms([1, 2]).utilities).toEqual([]);
  });
});
