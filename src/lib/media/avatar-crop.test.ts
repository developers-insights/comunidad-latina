import { describe, expect, it } from "vitest";
import { clampOffset, clampOffsetAxis, coverScale, outputDrawRect } from "./avatar-crop";

describe("coverScale", () => {
  it("escala por el lado MÁS CORTO, para que no quede hueco en el stage", () => {
    // Retrato angosto: el lado corto (1000) es el que tiene que llenar el
    // stage de 200px, así que escala = 200/1000 = 0.2 — y el lado largo
    // (2000 × 0.2 = 400) sobra por los costados, listo para recortarse.
    expect(coverScale({ width: 1000, height: 2000 }, 200)).toBeCloseTo(0.2);
  });

  it("una imagen cuadrada escala 1:1 contra un stage del mismo tamaño", () => {
    expect(coverScale({ width: 256, height: 256 }, 256)).toBe(1);
  });

  it("no explota con dimensiones en cero — degrada a escala 1", () => {
    expect(coverScale({ width: 0, height: 0 }, 256)).toBe(1);
    expect(coverScale({ width: 100, height: 100 }, 0)).toBe(1);
  });
});

describe("clampOffsetAxis", () => {
  it("con la imagen exactamente del tamaño del stage, el único offset válido es 0", () => {
    // 200 de natural × escala 1 = 200 mostrados = 200 de stage: cero margen.
    expect(clampOffsetAxis(50, 200, 1, 200)).toBe(0);
    expect(clampOffsetAxis(-50, 200, 1, 200)).toBe(0);
  });

  it("con zoom, el margen es la mitad de lo que sobra de imagen", () => {
    // 200 de natural × escala 2 = 400 mostrados, stage 200 → sobran 200,
    // repartidos mitad y mitad: margen válido = ±100.
    expect(clampOffsetAxis(150, 200, 2, 200)).toBe(100);
    expect(clampOffsetAxis(-150, 200, 2, 200)).toBe(-100);
    expect(clampOffsetAxis(50, 200, 2, 200)).toBe(50); // dentro del margen, no se toca
  });
});

describe("clampOffset", () => {
  it("recorta cada eje con el ancho/alto natural que le corresponde", () => {
    // natural 100×300, escala 2 → mostrado 200×600, stage 200.
    // eje X: sobra 0 → margen 0. eje Y: sobra 400 → margen ±200.
    const result = clampOffset({ x: 999, y: 999 }, { width: 100, height: 300 }, 2, 200);
    expect(result).toEqual({ x: 0, y: 200 });
  });
});

describe("outputDrawRect — el mismo encuadre del stage, reescalado al canvas final", () => {
  it("stage y output del mismo tamaño (ratio 1): el rect es literalmente el del stage", () => {
    const rect = outputDrawRect({
      natural: { width: 100, height: 100 },
      scale: 1,
      offset: { x: 0, y: 0 },
      stageSize: 100,
      outputSize: 100,
    });
    expect(rect).toEqual({ dx: 0, dy: 0, dw: 100, dh: 100 });
  });

  it("output el doble del stage (ratio 2): todo se duplica, offset incluido", () => {
    const rect = outputDrawRect({
      natural: { width: 100, height: 100 },
      scale: 1,
      offset: { x: 0, y: 0 },
      stageSize: 100,
      outputSize: 200,
    });
    expect(rect).toEqual({ dx: 0, dy: 0, dw: 200, dh: 200 });
  });

  it("con zoom y offset, centra y desplaza en la misma proporción", () => {
    // natural 100×100, escala 2 (mostrado 200×200) dentro de un stage de 100
    // sin cambio de tamaño con el output (ratio 1): centrado puro sería
    // dx=dy=(100-200)/2=-50; con offset (10,-5) se suma tal cual (ratio 1).
    const rect = outputDrawRect({
      natural: { width: 100, height: 100 },
      scale: 2,
      offset: { x: 10, y: -5 },
      stageSize: 100,
      outputSize: 100,
    });
    expect(rect).toEqual({ dx: -40, dy: -55, dw: 200, dh: 200 });
  });
});
