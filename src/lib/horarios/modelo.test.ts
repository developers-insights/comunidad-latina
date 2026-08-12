import { describe, expect, it } from "vitest";

import {
  MAX_TRAMOS_POR_DIA,
  esTramoValido,
  esVeinticuatroHoras,
  horaDeMinutos,
  horaLegible,
  minutosDeHora,
  primerSolapamiento,
  semanaOrdenada,
  tramoEnMinutos,
  tramosSeSolapan,
  validarHorario,
  type Tramo,
} from "./modelo";

const tramo = (weekday: number, opensAt: string, closesAt: string): Tramo =>
  ({ weekday, opensAt, closesAt }) as Tramo;

describe("minutosDeHora", () => {
  it("lee el formato de la base, con y sin segundos", () => {
    expect(minutosDeHora("09:00")).toBe(540);
    expect(minutosDeHora("09:00:00")).toBe(540);
    expect(minutosDeHora("00:00")).toBe(0);
  });

  it("acepta 24:00 porque es el fin del día que guarda Postgres", () => {
    expect(minutosDeHora("24:00")).toBe(1440);
  });

  it("rechaza lo que no existe", () => {
    expect(minutosDeHora("24:30")).toBeNull();
    expect(minutosDeHora("25:00")).toBeNull();
    expect(minutosDeHora("09:60")).toBeNull();
    expect(minutosDeHora("mediodía")).toBeNull();
    expect(minutosDeHora(null)).toBeNull();
    expect(minutosDeHora(undefined)).toBeNull();
  });
});

describe("horaDeMinutos / horaLegible", () => {
  it("vuelve al formato de la base", () => {
    expect(horaDeMinutos(540)).toBe("09:00");
    expect(horaDeMinutos(1440)).toBe("24:00");
    expect(horaDeMinutos(0)).toBe("00:00");
  });

  it("muestra la hora como la lee este público", () => {
    expect(horaLegible(0)).toBe("12:00 am");
    expect(horaLegible(540)).toBe("9:00 am");
    expect(horaLegible(720)).toBe("12:00 pm");
    expect(horaLegible(1080)).toBe("6:00 pm");
    expect(horaLegible(1439)).toBe("11:59 pm");
  });
});

describe("tramoEnMinutos", () => {
  it("resuelve un tramo común", () => {
    expect(tramoEnMinutos(tramo(1, "09:00", "18:00"))).toEqual({
      weekday: 1,
      desde: 540,
      duracion: 540,
    });
  });

  it("resuelve el cruce de medianoche como duración, sin ramas", () => {
    // Viernes 20:00 → 02:00 del sábado: 6 horas.
    expect(tramoEnMinutos(tramo(5, "20:00", "02:00"))).toEqual({
      weekday: 5,
      desde: 1200,
      duracion: 360,
    });
  });

  it("resuelve las 24 horas como un día entero", () => {
    expect(tramoEnMinutos(tramo(2, "00:00", "24:00"))).toEqual({
      weekday: 2,
      desde: 0,
      duracion: 1440,
    });
    expect(esVeinticuatroHoras(tramo(2, "00:00", "24:00"))).toBe(true);
    expect(esVeinticuatroHoras(tramo(2, "09:00", "18:00"))).toBe(false);
  });

  it("rechaza el caso ambiguo: apertura igual a cierre", () => {
    expect(tramoEnMinutos(tramo(1, "09:00", "09:00"))).toBeNull();
    expect(esTramoValido(tramo(1, "09:00", "09:00"))).toBe(false);
  });

  it("rechaza abrir a las 24:00 y días fuera de rango", () => {
    expect(tramoEnMinutos(tramo(1, "24:00", "02:00"))).toBeNull();
    expect(tramoEnMinutos(tramo(9, "09:00", "18:00"))).toBeNull();
  });
});

describe("tramosSeSolapan", () => {
  it("el corte del mediodía no se pisa", () => {
    expect(tramosSeSolapan(tramo(1, "09:00", "13:00"), tramo(1, "16:00", "20:00"))).toBe(false);
  });

  it("tocarse en el borde no es pisarse", () => {
    expect(tramosSeSolapan(tramo(1, "09:00", "13:00"), tramo(1, "13:00", "20:00"))).toBe(false);
  });

  it("un minuto de invasión ya es solapamiento", () => {
    expect(tramosSeSolapan(tramo(1, "09:00", "13:01"), tramo(1, "13:00", "20:00"))).toBe(true);
  });

  it("detecta el pisón que se produce DESPUÉS de cruzar la medianoche", () => {
    // Lunes 22:00 → 03:00 termina el martes a las 3; el martes abre a las 2.
    expect(tramosSeSolapan(tramo(1, "22:00", "03:00"), tramo(2, "02:00", "06:00"))).toBe(true);
    // Si el martes abre a las 3 en punto, ya no se pisan.
    expect(tramosSeSolapan(tramo(1, "22:00", "03:00"), tramo(2, "03:00", "06:00"))).toBe(false);
  });

  it("detecta el pisón que cruza de sábado a domingo (el fin del lienzo)", () => {
    expect(tramosSeSolapan(tramo(6, "23:00", "04:00"), tramo(0, "01:00", "05:00"))).toBe(true);
  });

  it("días distintos que no se tocan no se pisan", () => {
    expect(tramosSeSolapan(tramo(1, "09:00", "18:00"), tramo(3, "09:00", "18:00"))).toBe(false);
  });
});

describe("validarHorario", () => {
  it("un horario sano no devuelve errores", () => {
    expect(
      validarHorario([
        tramo(1, "09:00", "13:00"),
        tramo(1, "16:00", "20:00"),
        tramo(6, "10:00", "14:00"),
      ]),
    ).toEqual([]);
  });

  it("marca el tramo inválido y no sigue de largo", () => {
    const errores = validarHorario([tramo(1, "09:00", "09:00")]);
    expect(errores).toHaveLength(1);
    expect(errores[0]?.codigo).toBe("tramo_invalido");
  });

  it("marca el solapamiento", () => {
    const errores = validarHorario([tramo(1, "09:00", "14:00"), tramo(1, "13:00", "20:00")]);
    expect(errores.map((e) => e.codigo)).toContain("solapado");
  });

  it("respeta el mismo techo por día que la base", () => {
    const demasiados = Array.from({ length: MAX_TRAMOS_POR_DIA + 1 }, (_, i) =>
      tramo(1, `0${i + 1}:00`, `0${i + 1}:30`),
    );
    expect(validarHorario(demasiados).map((e) => e.codigo)).toContain("demasiados_tramos");
  });
});

describe("primerSolapamiento / semanaOrdenada", () => {
  it("devuelve el par culpable", () => {
    const a = tramo(1, "09:00", "14:00");
    const b = tramo(1, "13:00", "20:00");
    expect(primerSolapamiento([a, b])).toEqual([a, b]);
    expect(primerSolapamiento([a])).toBeNull();
  });

  it("arma la semana empezando en lunes y con los días vacíos incluidos", () => {
    const semana = semanaOrdenada([tramo(0, "10:00", "14:00"), tramo(1, "09:00", "18:00")]);
    expect(semana.map((d) => d.weekday)).toEqual([1, 2, 3, 4, 5, 6, 0]);
    expect(semana[0]?.tramos).toHaveLength(1);
    expect(semana[1]?.tramos).toHaveLength(0);
    expect(semana[6]?.nombre).toBe("Domingo");
  });

  it("ordena los tramos del día por hora de apertura", () => {
    const semana = semanaOrdenada([tramo(1, "16:00", "20:00"), tramo(1, "09:00", "13:00")]);
    expect(semana[0]?.tramos.map((t) => t.opensAt)).toEqual(["09:00", "16:00"]);
  });
});
