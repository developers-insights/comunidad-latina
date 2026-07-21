import { describe, expect, it } from "vitest";
import { dampPull, isPullReady } from "./pull-to-refresh";

/**
 * Matemática pura del gesto de pull-to-refresh (módulo FLUIDEZ). Sin DOM: el
 * componente en sí necesita jsdom + eventos táctiles reales, pero la
 * traducción "dedo → indicador visual" es una función pura y es lo que vale
 * la pena fijar con tests (mismo criterio que underlineSpring en feed-tabs).
 */

describe("dampPull", () => {
  it("un dedo que no bajó (0 o hacia arriba) no mueve el indicador", () => {
    expect(dampPull(0)).toBe(0);
    expect(dampPull(-40)).toBe(0);
  });

  it("aplica resistencia: el indicador se mueve MENOS que el dedo", () => {
    expect(dampPull(40)).toBe(20);
    expect(dampPull(100)).toBe(50);
  });

  it("nunca se estira más allá del tope visual, por más que tiren", () => {
    expect(dampPull(500)).toBe(96);
    expect(dampPull(10_000)).toBe(96);
  });
});

describe("isPullReady", () => {
  it("por debajo del umbral: todavía no está listo para soltar", () => {
    expect(isPullReady(0)).toBe(false);
    expect(isPullReady(69)).toBe(false);
  });

  it("en el umbral o más: listo para disparar el refresh al soltar", () => {
    expect(isPullReady(70)).toBe(true);
    expect(isPullReady(96)).toBe(true);
  });

  it("el umbral real (rawDeltaY 140px de dedo) coincide con dampPull", () => {
    // 140 * 0.5 = 70 = el umbral exacto — el gesto completo, de punta a punta.
    expect(isPullReady(dampPull(140))).toBe(true);
    expect(isPullReady(dampPull(138))).toBe(false);
  });
});
