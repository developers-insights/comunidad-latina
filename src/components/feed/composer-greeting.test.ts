import { describe, expect, it } from "vitest";
import { COPY } from "./copy";
import { hourInZone } from "./composer-greeting";

/**
 * Saludo VISIBLE de bienvenida, restaurado (vivía en el viejo
 * `post-composer.tsx` hasta 9183bdc). Contrato: `greetingByHour(hour,
 * firstName?)` — CUATRO franjas (madrugada, mañana, tarde, noche) y nombre de
 * pila opcional.
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
    // para esta franja) pero es un texto distinto — verificado arriba.
    expect(madrugada).toMatch(/^Buenas noches/);
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

/**
 * `hourInZone`: la parte nueva de esta restauración. El bug que evita es real
 * — `new Date().getHours()` en el servidor de Vercel da la hora en UTC, no la
 * del usuario. Estos casos anclan que Nueva York y Los Ángeles leen HORAS
 * distintas del mismo instante, igual que ya lo hace `viewer-time-zone.test.ts`
 * con los DÍAS.
 */
describe("hourInZone", () => {
  const NUEVA_YORK = "America/New_York";
  const LOS_ANGELES = "America/Los_Angeles";
  /** 19:30 UTC → 15:30 en Nueva York (tarde) y 12:30 en Los Ángeles (tarde). */
  const MID_AFTERNOON_UTC = new Date("2026-09-15T19:30:00Z");
  /** 04:15 UTC del 2 de agosto → 00:15 en Nueva York (madrugada). */
  const MIDNIGHT_IN_NY_UTC = new Date("2026-08-02T04:15:00Z");

  it("Nueva York y Los Ángeles leen horas distintas del mismo instante", () => {
    expect(hourInZone(MID_AFTERNOON_UTC, NUEVA_YORK)).toBe(15);
    expect(hourInZone(MID_AFTERNOON_UTC, LOS_ANGELES)).toBe(12);
  });

  it("la medianoche normaliza a 0, no a 24", () => {
    expect(hourInZone(MIDNIGHT_IN_NY_UTC, NUEVA_YORK)).toBe(0);
  });

  it("zona desconocida no revienta: devuelve null", () => {
    expect(hourInZone(MID_AFTERNOON_UTC, "No/Existe")).toBeNull();
  });
});
