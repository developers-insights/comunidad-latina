import { describe, expect, it } from "vitest";
import { underlineSpring } from "./feed-tabs";

/**
 * El pedido del cliente (2026-07-20) fue explícito y medible: que el subrayado
 * "se pase un poquitín y vuelva", y que cuanto más lejos salte, un poquitín
 * más — sutil. Estos tests fijan las dos propiedades para que un retoque
 * futuro no las rompa sin darse cuenta.
 */
describe("underlineSpring", () => {
  it("siempre rebota algo (nunca frena en seco)", () => {
    for (const d of [1, 2, 3, 4]) {
      expect(underlineSpring(d).bounce).toBeGreaterThan(0);
    }
  });

  it("cuanto más lejos el salto, más rebote y más tiempo", () => {
    const saltos = [1, 2, 3, 4].map(underlineSpring);
    for (let i = 1; i < saltos.length; i++) {
      expect(saltos[i].bounce).toBeGreaterThan(saltos[i - 1].bounce);
      expect(saltos[i].visualDuration).toBeGreaterThan(saltos[i - 1].visualDuration);
    }
  });

  it("el rebote se mantiene SUTIL en todo el rango", () => {
    // >0.3 ya se lee como "rebotó"; la referencia de UI premium vive por debajo.
    for (const d of [1, 2, 3, 4]) {
      expect(underlineSpring(d).bounce).toBeLessThanOrEqual(0.25);
    }
  });

  it("la animación se mantiene dentro del presupuesto de micro-interacción", () => {
    // ≤400ms: arriba de eso deja de sentirse como respuesta al toque.
    for (const d of [1, 2, 3, 4]) {
      expect(underlineSpring(d).visualDuration).toBeLessThanOrEqual(0.4);
    }
  });

  it("clampea distancias fuera de rango en vez de extrapolar", () => {
    // 0 (o negativo) no puede dar una animación instantánea ni un resorte raro,
    // y una lista más larga no puede disparar el rebote al infinito.
    expect(underlineSpring(0)).toEqual(underlineSpring(1));
    expect(underlineSpring(-3)).toEqual(underlineSpring(1));
    expect(underlineSpring(99)).toEqual(underlineSpring(4));
  });
});
