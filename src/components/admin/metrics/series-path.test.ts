import { describe, expect, it } from "vitest";
import { areaPath, axisMax, linePath, type PathGeometry } from "./series-path";

const GEO: PathGeometry = { width: 100, height: 50, padY: 5 };

/** Extrae los pares x,y de un path para poder afirmar sobre la geometría. */
function coords(d: string): [number, number][] {
  return [...d.matchAll(/[ML]\s(-?[\d.]+)\s(-?[\d.]+)/g)].map((m) => [
    Number(m[1]),
    Number(m[2]),
  ]);
}

describe("axisMax", () => {
  it("toma el máximo de todas las series juntas", () => {
    expect(axisMax([1, 5, 2], [3, 9], [0])).toBe(9);
  });

  it("nunca baja de 1", () => {
    // Con todo en cero, un máximo de 0 daría división por cero y el trazo
    // desaparecería. Con 1, la línea se apoya en el piso: "no pasó nada" se ve.
    expect(axisMax([0, 0, 0])).toBe(1);
    expect(axisMax([])).toBe(1);
  });
});

describe("linePath", () => {
  it("sin datos no dibuja nada", () => {
    expect(linePath([], 1, GEO)).toBe("");
  });

  it("apoya los ceros en el piso del gráfico", () => {
    const puntos = coords(linePath([0, 0, 0], 4, GEO));
    const piso = GEO.height - GEO.padY;
    expect(puntos.every(([, y]) => y === piso)).toBe(true);
  });

  it("el máximo toca el techo y ocupa todo el ancho", () => {
    const puntos = coords(linePath([0, 4], 4, GEO));
    expect(puntos[0]).toEqual([0, GEO.height - GEO.padY]);
    expect(puntos[1]).toEqual([GEO.width, GEO.padY]);
  });

  it("con un solo día dibuja un segmento centrado, no un punto en el borde", () => {
    const puntos = coords(linePath([3], 3, GEO));
    expect(puntos).toHaveLength(2);
    expect(puntos[0]![0]).toBeGreaterThan(0);
    expect(puntos[1]![0]).toBeLessThan(GEO.width);
    // Horizontal: un solo dato no tiene pendiente.
    expect(puntos[0]![1]).toBe(puntos[1]![1]);
  });
});

describe("areaPath", () => {
  it("cierra contra el piso para poder rellenarse", () => {
    const d = areaPath([1, 2], 2, GEO);
    expect(d.endsWith("Z")).toBe(true);
    const piso = GEO.height - GEO.padY;
    expect(d).toContain(`L ${GEO.width} ${piso}`);
  });

  it("sin datos no dibuja nada", () => {
    expect(areaPath([], 1, GEO)).toBe("");
  });
});
