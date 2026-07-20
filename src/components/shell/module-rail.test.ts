import { describe, expect, it } from "vitest";
import { isModuleActive } from "./module-rail";

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
