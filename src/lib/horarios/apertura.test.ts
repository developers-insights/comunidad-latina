import { describe, expect, it } from "vitest";

import { estadoDeApertura, momentoEnZona } from "./apertura";
import type { Tramo } from "./modelo";

const tramo = (weekday: number, opensAt: string, closesAt: string): Tramo =>
  ({ weekday, opensAt, closesAt }) as Tramo;

const NY = "America/New_York";
const LA = "America/Los_Angeles";

/**
 * Los instantes se escriben en UTC a propósito: es la única forma de que el test
 * signifique lo mismo corriendo en la máquina de cualquiera. Las 14:00 UTC de un
 * martes de julio son las 10:00 de Nueva York (EDT) y las 7:00 de Los Ángeles.
 */
const MARTES_14_UTC = new Date("2026-07-14T14:00:00Z");

describe("momentoEnZona", () => {
  it("traduce el mismo instante a dos relojes distintos", () => {
    expect(momentoEnZona(MARTES_14_UTC, NY)).toEqual({ weekday: 2, minutos: 10 * 60 });
    expect(momentoEnZona(MARTES_14_UTC, LA)).toEqual({ weekday: 2, minutos: 7 * 60 });
  });

  it("cambia de día cuando corresponde", () => {
    // Miércoles 02:00 UTC = martes 22:00 en Nueva York.
    const cruce = new Date("2026-07-15T02:00:00Z");
    expect(momentoEnZona(cruce, NY)).toEqual({ weekday: 2, minutos: 22 * 60 });
  });

  it("devuelve null con una zona inexistente en vez de inventar una hora", () => {
    expect(momentoEnZona(MARTES_14_UTC, "America/Nunca_Jamas")).toBeNull();
  });
});

describe("estadoDeApertura", () => {
  it("sin tramos cargados no dice nada: no hay horario, no hay estado", () => {
    expect(estadoDeApertura([], NY, MARTES_14_UTC)).toEqual({ estado: "sin_horario" });
  });

  it("con una zona desconocida no arriesga un 'Abierto' falso", () => {
    const estado = estadoDeApertura([tramo(2, "09:00", "18:00")], "Marte/Olympus", MARTES_14_UTC);
    expect(estado).toEqual({ estado: "zona_desconocida" });
  });

  it("abierto en horario normal, con la hora de cierre", () => {
    // Martes 10:00 en NY, el local abre 09:00–18:00.
    const estado = estadoDeApertura([tramo(2, "09:00", "18:00")], NY, MARTES_14_UTC);
    expect(estado.estado).toBe("abierto");
    if (estado.estado === "abierto") expect(estado.cierraA).toBe("6:00 pm");
  });

  it("EL HORARIO ES DEL NEGOCIO, NO DE QUIEN MIRA", () => {
    // Mismo instante: en NY son las 10:00 (abierto) y en LA las 7:00 (cerrado).
    const tramos = [tramo(2, "09:00", "18:00")];
    expect(estadoDeApertura(tramos, NY, MARTES_14_UTC).estado).toBe("abierto");
    expect(estadoDeApertura(tramos, LA, MARTES_14_UTC).estado).toBe("cerrado");
  });

  it("el minuto exacto de apertura ya cuenta como abierto", () => {
    // Martes 09:00 en punto de NY = 13:00 UTC.
    const estado = estadoDeApertura(
      [tramo(2, "09:00", "18:00")],
      NY,
      new Date("2026-07-14T13:00:00Z"),
    );
    expect(estado.estado).toBe("abierto");
  });

  it("el minuto exacto de cierre YA es cerrado", () => {
    // Martes 18:00 en punto de NY = 22:00 UTC.
    const estado = estadoDeApertura(
      [tramo(2, "09:00", "18:00")],
      NY,
      new Date("2026-07-14T22:00:00Z"),
    );
    expect(estado.estado).toBe("cerrado");
  });

  it("un minuto antes del cierre sigue abierto", () => {
    const estado = estadoDeApertura(
      [tramo(2, "09:00", "18:00")],
      NY,
      new Date("2026-07-14T21:59:00Z"),
    );
    expect(estado.estado).toBe("abierto");
  });

  it("cerrado: dice cuándo vuelve a abrir, y elige el tramo MÁS PRÓXIMO", () => {
    // Martes 10:00 NY; hay corte de mediodía y el local está en el corte.
    const estado = estadoDeApertura(
      [tramo(2, "08:00", "09:30"), tramo(2, "16:00", "20:00"), tramo(3, "09:00", "18:00")],
      NY,
      MARTES_14_UTC,
    );
    expect(estado.estado).toBe("cerrado");
    if (estado.estado === "cerrado") {
      expect(estado.abreA).toBe("4:00 pm");
      expect(estado.abreDia).toBe(2);
    }
  });

  it("cerrado todo el día: apunta al próximo día que abre", () => {
    // Martes 10:00 NY, sólo abre los sábados.
    const estado = estadoDeApertura([tramo(6, "10:00", "14:00")], NY, MARTES_14_UTC);
    expect(estado.estado).toBe("cerrado");
    if (estado.estado === "cerrado") {
      expect(estado.abreDia).toBe(6);
      expect(estado.abreA).toBe("10:00 am");
    }
  });

  it("cruce de medianoche: sigue abierto pasada la medianoche del día siguiente", () => {
    // Lunes 20:00 → 02:00. Miramos el martes a las 01:00 de NY (05:00 UTC).
    const estado = estadoDeApertura(
      [tramo(1, "20:00", "02:00")],
      NY,
      new Date("2026-07-14T05:00:00Z"),
    );
    expect(estado.estado).toBe("abierto");
    if (estado.estado === "abierto") expect(estado.cierraA).toBe("2:00 am");
  });

  it("cruce de medianoche: a las 02:00 en punto ya cerró", () => {
    const estado = estadoDeApertura(
      [tramo(1, "20:00", "02:00")],
      NY,
      new Date("2026-07-14T06:00:00Z"),
    );
    expect(estado.estado).toBe("cerrado");
  });

  it("cruce de sábado a domingo: el fin de la semana no rompe la cuenta", () => {
    // Sábado 22:00 → 03:00. Domingo 01:00 de NY = domingo 05:00 UTC.
    const estado = estadoDeApertura(
      [tramo(6, "22:00", "03:00")],
      NY,
      new Date("2026-07-19T05:00:00Z"),
    );
    expect(estado.estado).toBe("abierto");
  });

  it("abierto 24 h: a cualquier hora, incluida la medianoche exacta", () => {
    const tramos = [tramo(2, "00:00", "24:00")];
    // Martes 00:00 de NY = martes 04:00 UTC.
    expect(estadoDeApertura(tramos, NY, new Date("2026-07-14T04:00:00Z")).estado).toBe("abierto");
    expect(estadoDeApertura(tramos, NY, MARTES_14_UTC).estado).toBe("abierto");
    // Martes 23:59 de NY = miércoles 03:59 UTC.
    expect(estadoDeApertura(tramos, NY, new Date("2026-07-15T03:59:00Z")).estado).toBe("abierto");
    // Miércoles 00:00 de NY ya es otro día, y ese día no tiene tramo.
    expect(estadoDeApertura(tramos, NY, new Date("2026-07-15T04:00:00Z")).estado).toBe("cerrado");
  });

  it("ignora los tramos corruptos en vez de tirar la pantalla", () => {
    const estado = estadoDeApertura(
      [tramo(2, "nada", "18:00"), tramo(2, "09:00", "18:00")],
      NY,
      MARTES_14_UTC,
    );
    expect(estado.estado).toBe("abierto");
  });
});
