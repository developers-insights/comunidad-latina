import { describe, expect, it } from "vitest";
import { COPY } from "./copy";

/**
 * Saludo VISIBLE del composer (rediseño 2026-07-26 — antes vivía solo como
 * placeholder). Contrato nuevo, deliberadamente distinto del original:
 * `greetingByHour(hour, firstName?)` — CUATRO franjas (madrugada, mañana,
 * tarde, noche) y nombre de pila opcional (firstNameOf sobre viewerName, que
 * puede venir vacío si el perfil no tiene display_name).
 */
describe("COPY.composer.greetingByHour", () => {
  const NAME = "Ana";

  const madrugada = COPY.composer.greetingByHour(2, NAME);
  const morning = COPY.composer.greetingByHour(8, NAME);
  const afternoon = COPY.composer.greetingByHour(15, NAME);
  const evening = COPY.composer.greetingByHour(21, NAME);

  it("madrugada (0–4), mañana (5–11), tarde (12–18) y noche (19–23) devuelven su franja", () => {
    expect(COPY.composer.greetingByHour(0, NAME)).toBe(madrugada);
    expect(COPY.composer.greetingByHour(4, NAME)).toBe(madrugada);
    expect(COPY.composer.greetingByHour(5, NAME)).toBe(morning);
    expect(COPY.composer.greetingByHour(11, NAME)).toBe(morning);
    expect(COPY.composer.greetingByHour(12, NAME)).toBe(afternoon);
    expect(COPY.composer.greetingByHour(18, NAME)).toBe(afternoon);
    expect(COPY.composer.greetingByHour(19, NAME)).toBe(evening);
    expect(COPY.composer.greetingByHour(23, NAME)).toBe(evening);
  });

  it("son cuatro variantes distintas, no un mismo texto repetido", () => {
    expect(new Set([madrugada, morning, afternoon, evening]).size).toBe(4);
  });

  it("saludan según el momento del día, en español con acentos", () => {
    expect(morning).toMatch(/^Buenos días/);
    expect(afternoon).toMatch(/^Buenas tardes/);
    expect(evening).toMatch(/^Buenas noches/);
    // Madrugada comparte el saludo de "noche" (en español no hay uno propio
    // para las 2am) pero es un texto distinto — verificado arriba.
    expect(madrugada).toMatch(/^Buenas noches/);
    // Acentos presentes (regla del proyecto: español bien escrito).
    expect(`${madrugada}${morning}${afternoon}${evening}`).toMatch(/[áéíóúñ¿¡]/);
  });

  it("con nombre de pila: saluda POR SU NOMBRE en las cuatro franjas", () => {
    expect(COPY.composer.greetingByHour(8, "Ana")).toContain("Ana");
    expect(COPY.composer.greetingByHour(15, "Luis")).toContain("Luis");
    expect(COPY.composer.greetingByHour(21, "Rosa")).toContain("Rosa");
    expect(COPY.composer.greetingByHour(2, "Iván")).toContain("Iván");
  });

  it("sin nombre (perfil sin display_name): saluda igual de cálido, sin coma huérfana", () => {
    const withoutName = [
      COPY.composer.greetingByHour(2, null),
      COPY.composer.greetingByHour(8, undefined),
      COPY.composer.greetingByHour(15, ""),
      COPY.composer.greetingByHour(21, "   "), // solo espacios: se trata como sin nombre
    ];
    for (const text of withoutName) {
      expect(text.startsWith(",")).toBe(false);
      expect(text).not.toContain(" , ");
      expect(text.trim().length).toBeGreaterThan(10);
    }
    // Sigue siendo tres saludos DISTINTOS entre franjas (aunque sin nombre).
    expect(new Set([withoutName[0], withoutName[1], withoutName[2]]).size).toBe(3);
  });

  it("ninguna variante queda vacía ni gigante (es una línea, no un párrafo)", () => {
    const variants = [
      madrugada,
      morning,
      afternoon,
      evening,
      COPY.composer.greetingByHour(8, null),
      COPY.composer.greetingByHour(21, "Guadalupe"),
    ];
    for (const text of variants) {
      expect(text.trim().length).toBeGreaterThan(10);
      expect(text.length).toBeLessThan(120);
    }
  });
});
