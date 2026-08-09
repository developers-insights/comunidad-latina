import { describe, expect, it } from "vitest";
import {
  AMOUNT_ERROR_COPY,
  MAX_AMOUNT_CENTS,
  centsToInput,
  formatCents,
  normalizeCurrency,
  parseAmountToCents,
} from "./money";

/**
 * Tests del único lugar donde un texto tipeado se convierte en plata.
 *
 * El caso que da nombre a este archivo es el de ida y vuelta: un precio que se
 * guarda tiene que leerse de vuelta EXACTO, sin perder ni ganar un centavo.
 */

describe("parseAmountToCents", () => {
  it("convierte enteros y decimales sin perder centavos", () => {
    expect(parseAmountToCents("19")).toEqual({ ok: true, cents: 1900 });
    expect(parseAmountToCents("19,99")).toEqual({ ok: true, cents: 1999 });
    expect(parseAmountToCents("19.99")).toEqual({ ok: true, cents: 1999 });
    expect(parseAmountToCents("19,9")).toEqual({ ok: true, cents: 1990 });
    expect(parseAmountToCents("0")).toEqual({ ok: true, cents: 0 });
    expect(parseAmountToCents("0,01")).toEqual({ ok: true, cents: 1 });
  });

  it("no arrastra el error del flotante", () => {
    // `Math.round(1.005 * 100)` da 100 en JavaScript porque 1.005 en binario es
    // 1.00499999999999989. Acá tiene que dar 101 — es un centavo de alguien.
    expect(parseAmountToCents("1,005")).toEqual({ ok: false, reason: "demasiados_decimales" });
    expect(parseAmountToCents("1,01")).toEqual({ ok: true, cents: 101 });
    expect(parseAmountToCents("8,29")).toEqual({ ok: true, cents: 829 });
    expect(parseAmountToCents("1234,56")).toEqual({ ok: true, cents: 123456 });
  });

  it("limpia el símbolo de moneda y los espacios, que es lo que se pega", () => {
    expect(parseAmountToCents(" $19,99 ")).toEqual({ ok: true, cents: 1999 });
    expect(parseAmountToCents("USD 19")).toEqual({ ok: true, cents: 1900 });
  });

  it("rechaza lo que no es un monto, con el motivo correcto", () => {
    expect(parseAmountToCents("")).toEqual({ ok: false, reason: "vacio" });
    expect(parseAmountToCents("   ")).toEqual({ ok: false, reason: "vacio" });
    expect(parseAmountToCents("-5")).toEqual({ ok: false, reason: "negativo" });
    expect(parseAmountToCents("gratis")).toEqual({ ok: false, reason: "formato" });
    expect(parseAmountToCents("19,999")).toEqual({ ok: false, reason: "demasiados_decimales" });
    // Separador de miles: se rechaza en vez de adivinar si son 1234 o 1,234.
    expect(parseAmountToCents("1.234,56")).toEqual({ ok: false, reason: "formato" });
    expect(parseAmountToCents("1e5")).toEqual({ ok: false, reason: "formato" });
  });

  it("respeta el tope de la base", () => {
    expect(parseAmountToCents("1000000")).toEqual({ ok: true, cents: MAX_AMOUNT_CENTS });
    expect(parseAmountToCents("1000000,01")).toEqual({ ok: false, reason: "demasiado_grande" });
  });

  it("tiene un mensaje humano para cada motivo de rechazo", () => {
    for (const reason of [
      "vacio",
      "formato",
      "negativo",
      "demasiados_decimales",
      "demasiado_grande",
    ] as const) {
      expect(AMOUNT_ERROR_COPY[reason].length).toBeGreaterThan(10);
    }
  });
});

describe("ida y vuelta: lo que se guarda es lo que se lee", () => {
  it("no pierde ni gana un centavo en ningún monto plausible", () => {
    // Todos los centavos de 0,00 a 99,99 más los precios reales del catálogo.
    const casos = [
      ...Array.from({ length: 10_000 }, (_, cents) => cents),
      900, 1000, 1900, 2500, 2900, 4500, 4900, 19_000, 29_000, 49_000, MAX_AMOUNT_CENTS,
    ];

    for (const cents of casos) {
      const texto = centsToInput(cents);
      const vuelta = parseAmountToCents(texto);
      expect(vuelta, `centavos=${cents} texto=${texto}`).toEqual({ ok: true, cents });
    }
  });

  it("centsToInput siempre escribe dos decimales", () => {
    expect(centsToInput(1900)).toBe("19.00");
    expect(centsToInput(1999)).toBe("19.99");
    expect(centsToInput(1990)).toBe("19.90");
    expect(centsToInput(1)).toBe("0.01");
    expect(centsToInput(0)).toBe("0.00");
  });

  it("centsToInput devuelve vacío ante basura, en vez de un monto inventado", () => {
    expect(centsToInput(-1)).toBe("");
    expect(centsToInput(19.5)).toBe("");
    expect(centsToInput(Number.NaN)).toBe("");
  });
});

describe("formatCents", () => {
  it("omite los centavos cuando son cero y los muestra cuando no", () => {
    expect(formatCents(1900, "USD")).toContain("19");
    expect(formatCents(1900, "USD")).not.toContain("19.00");
    expect(formatCents(1999, "USD")).toContain("19.99");
  });

  it("no rompe con una moneda que Intl no conoce", () => {
    // Intl separa el código de moneda con un espacio DURO (U+00A0). Se
    // normaliza para comparar: lo que importa es que salga el código y el
    // número, no qué byte usó el motor para separarlos.
    expect(formatCents(1900, "XXY").replace(/\s/g, " ")).toBe("XXY 19");
  });

  it("los negativos se muestran negativos — una devolución resta", () => {
    expect(formatCents(-1000, "USD")).toContain("-");
  });
});

describe("normalizeCurrency", () => {
  it("acepta tres letras y las sube a mayúsculas", () => {
    expect(normalizeCurrency("usd")).toBe("USD");
    expect(normalizeCurrency(" eur ")).toBe("EUR");
  });

  it("rechaza cualquier otra cosa — la base exige lo mismo", () => {
    expect(normalizeCurrency("US")).toBeNull();
    expect(normalizeCurrency("DOLAR")).toBeNull();
    expect(normalizeCurrency("US$")).toBeNull();
    expect(normalizeCurrency("")).toBeNull();
  });
});
