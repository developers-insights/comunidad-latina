import { describe, expect, it } from "vitest";
import { MODULES, isModuleActive } from "./modules";

describe("isModuleActive", () => {
  it("matchea la ruta exacta", () => {
    expect(isModuleActive("/eventos", "/eventos")).toBe(true);
  });

  it("matchea sub-rutas del módulo", () => {
    expect(isModuleActive("/eventos/123", "/eventos")).toBe(true);
    expect(isModuleActive("/propiedades/abc/editar", "/propiedades")).toBe(true);
  });

  it("no matchea otra ruta que solo comparte el prefijo de texto", () => {
    // "/eventos2" NO es un hijo de "/eventos" — el guard exige el "/" completo.
    expect(isModuleActive("/eventos2", "/eventos")).toBe(false);
    expect(isModuleActive("/eventosarchivados", "/eventos")).toBe(false);
  });

  it("no matchea un módulo distinto", () => {
    expect(isModuleActive("/negocios", "/eventos")).toBe(false);
    expect(isModuleActive("/", "/eventos")).toBe(false);
  });
});

describe("MODULES", () => {
  it("son los 8 módulos de la plataforma, sin href repetido", () => {
    expect(MODULES).toHaveLength(8);
    expect(new Set(MODULES.map((m) => m.href)).size).toBe(8);
  });

  it("cada módulo trae etiqueta e ícono — nunca un ítem solo-ícono", () => {
    for (const item of MODULES) {
      expect(item.label.trim().length, `${item.href} sin etiqueta`).toBeGreaterThan(0);
      expect(item.icon, `${item.href} sin ícono`).toBeTruthy();
    }
  });

  it("cada módulo usa un acento propio de globals.css", () => {
    for (const item of MODULES) {
      expect(item.palette.icon).toMatch(/^var\(--accent-[a-z]+\)$/);
    }
  });

  it("una ruta activa exactamente un módulo (sin solapamiento de prefijos)", () => {
    for (const item of MODULES) {
      const activos = MODULES.filter((other) => isModuleActive(item.href, other.href));
      expect(activos.map((a) => a.href)).toEqual([item.href]);
    }
  });
});
