import { describe, expect, it } from "vitest";
import {
  duracionEnSegundos,
  duracionHablada,
  formatearDuracion,
  resumenDeDuracion,
} from "./duracion";

const T0 = Date.parse("2026-09-07T20:00:00.000Z");

describe("duracionEnSegundos", () => {
  it("cuenta desde que atendieron, no desde que empezó a sonar", () => {
    // `created_at` (cuándo empezó a sonar) no entra en esta cuenta a propósito:
    // los 20 segundos que el teléfono estuvo sonando no son conversación.
    expect(duracionEnSegundos("2026-09-07T20:00:00.000Z", null, T0 + 42_000)).toBe(42);
  });

  it("se congela en ended_at cuando la llamada ya terminó", () => {
    const segundos = duracionEnSegundos(
      "2026-09-07T20:00:00.000Z",
      "2026-09-07T20:04:12.000Z",
      // "Ahora" muy posterior: no tiene que mover el número.
      T0 + 999_000,
    );
    expect(segundos).toBe(252);
  });

  it("es cero mientras nadie atendió", () => {
    expect(duracionEnSegundos(null, null, T0 + 30_000)).toBe(0);
  });

  it("nunca da negativo aunque el reloj del cliente esté adelantado", () => {
    // Pasa de verdad: el `started_at` lo pone el servidor y el "ahora" lo pone
    // el navegador. Un teléfono tres segundos atrasado mostraría "-3".
    expect(duracionEnSegundos("2026-09-07T20:00:00.000Z", null, T0 - 3_000)).toBe(0);
  });

  it("no explota con fechas que no se pueden parsear", () => {
    expect(duracionEnSegundos("mañana a la tarde", null, T0)).toBe(0);
  });
});

describe("formatearDuracion", () => {
  it("se lee como un cronómetro y no como una planilla", () => {
    expect(formatearDuracion(0)).toBe("0:00");
    expect(formatearDuracion(7)).toBe("0:07");
    expect(formatearDuracion(65)).toBe("1:05");
    expect(formatearDuracion(725)).toBe("12:05");
  });

  it("agrega horas sólo cuando hay horas, y ahí sí rellena los minutos", () => {
    expect(formatearDuracion(3600)).toBe("1:00:00");
    expect(formatearDuracion(3787)).toBe("1:03:07");
  });

  it("trata lo negativo como cero en vez de imprimirlo", () => {
    expect(formatearDuracion(-40)).toBe("0:00");
  });
});

describe("duracionHablada", () => {
  it("dice la duración como se dice, para el lector de pantalla", () => {
    expect(duracionHablada(1)).toBe("1 segundo");
    expect(duracionHablada(42)).toBe("42 segundos");
    expect(duracionHablada(61)).toBe("1 minuto y 1 segundo");
    expect(duracionHablada(725)).toBe("12 minutos y 5 segundos");
  });
});

describe("resumenDeDuracion", () => {
  it("resume una llamada terminada", () => {
    expect(resumenDeDuracion("2026-09-07T20:00:00.000Z", "2026-09-07T20:04:12.000Z")).toBe("4:12");
  });

  it("devuelve null cuando no hubo conversación: eso lo cuenta otro copy", () => {
    expect(resumenDeDuracion(null, "2026-09-07T20:04:12.000Z")).toBeNull();
    expect(resumenDeDuracion("2026-09-07T20:00:00.000Z", null)).toBeNull();
    expect(resumenDeDuracion("2026-09-07T20:00:00.000Z", "2026-09-07T20:00:00.000Z")).toBeNull();
  });
});
