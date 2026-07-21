import { describe, expect, it } from "vitest";
import { COPY } from "./copy";

/**
 * Saludo rotativo del composer por franja horaria (pedido cliente 2026-07-21).
 * Tres variantes — mañana / tarde / noche — cálidas y con acentos.
 */
describe("COPY.composer.greetingByHour", () => {
  const morning = COPY.composer.greetingByHour(8);
  const afternoon = COPY.composer.greetingByHour(15);
  const evening = COPY.composer.greetingByHour(21);

  it("mañana (5–11), tarde (12–18) y noche (19–4) devuelven su saludo", () => {
    expect(COPY.composer.greetingByHour(5)).toBe(morning);
    expect(COPY.composer.greetingByHour(11)).toBe(morning);
    expect(COPY.composer.greetingByHour(12)).toBe(afternoon);
    expect(COPY.composer.greetingByHour(18)).toBe(afternoon);
    expect(COPY.composer.greetingByHour(19)).toBe(evening);
    expect(COPY.composer.greetingByHour(23)).toBe(evening);
    expect(COPY.composer.greetingByHour(0)).toBe(evening);
    expect(COPY.composer.greetingByHour(4)).toBe(evening);
  });

  it("son tres variantes distintas, no un mismo texto", () => {
    expect(new Set([morning, afternoon, evening]).size).toBe(3);
  });

  it("saludan según el momento del día, en español con acentos", () => {
    expect(morning).toMatch(/^Buenos días/);
    expect(afternoon).toMatch(/^Buenas tardes/);
    expect(evening).toMatch(/^Buenas noches/);
    // Acentos presentes (regla del proyecto: español bien escrito).
    expect(`${morning}${afternoon}${evening}`).toMatch(/[áéíóúñ¿¡]/);
  });

  it("ninguna variante queda vacía ni gigante (es un placeholder)", () => {
    for (const text of [morning, afternoon, evening]) {
      expect(text.trim().length).toBeGreaterThan(10);
      expect(text.length).toBeLessThan(90);
    }
  });
});
