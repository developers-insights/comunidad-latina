import { describe, expect, it } from "vitest";
import { estadoDeSolicitud, partirTituloPorActor } from "./solicitud";

describe("estadoDeSolicitud", () => {
  it("traduce el status de la conversación", () => {
    expect(estadoDeSolicitud("pending")).toBe("pendiente");
    expect(estadoDeSolicitud("accepted")).toBe("aceptada");
    expect(estadoDeSolicitud("blocked")).toBe("eliminada");
  });

  it("un status desconocido no ofrece botones", () => {
    expect(estadoDeSolicitud("otra-cosa")).toBe("no_disponible");
    expect(estadoDeSolicitud(null)).toBe("no_disponible");
  });
});

describe("partirTituloPorActor", () => {
  it("separa el nombre del resto cuando el título arranca con él", () => {
    expect(partirTituloPorActor("Nacho quiere hablar con vos", "Nacho")).toEqual({
      conNombre: true,
      resto: "quiere hablar con vos",
    });
  });

  it("deja el título entero si no arranca con el nombre", () => {
    expect(partirTituloPorActor('Te escribieron por "Depto"', "Nacho")).toEqual({
      conNombre: false,
      resto: 'Te escribieron por "Depto"',
    });
  });

  it("no corta un nombre que es prefijo de otra palabra", () => {
    expect(partirTituloPorActor("Anabela quiere hablar con vos", "Ana").conNombre).toBe(false);
  });
});
