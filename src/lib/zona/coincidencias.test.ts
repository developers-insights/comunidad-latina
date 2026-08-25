import { describe, expect, it } from "vitest";
import { sameZoneLabel } from "@/lib/boosts/scope";
import { zonasCoincidentes, ZONAS_MATCH_MAX } from "./coincidencias";

const CATALOGO = [
  "Corona, Queens",
  "Corona",
  "Jackson Heights",
  "Washington Heights",
  "Bogotá",
];

describe("zonasCoincidentes — el match lo decide sameZoneLabel, no una igualdad", () => {
  it("sin zona elegida no hay filtro (vacío significa «no filtres»)", () => {
    expect(zonasCoincidentes(null, CATALOGO)).toEqual([]);
    expect(zonasCoincidentes("", CATALOGO)).toEqual([]);
    expect(zonasCoincidentes("   ", CATALOGO)).toEqual([]);
  });

  it("empareja laxo por token, igual que el alcance de los impulsos", () => {
    // "Corona" alcanza "Corona, Queens" — el mismo criterio que decide si un
    // impulso local te aplica. Si esto dejara de valer, la zona del header y la
    // del impulso pagarían por reglas distintas.
    expect(zonasCoincidentes("Corona", CATALOGO).sort()).toEqual(
      ["Corona", "Corona, Queens"].sort(),
    );
  });

  it("empareja en el otro sentido y sin acentos", () => {
    expect(zonasCoincidentes("Corona, Queens", CATALOGO)).toContain("Corona");
    expect(zonasCoincidentes("bogota", CATALOGO)).toContain("Bogotá");
  });

  it("NO empareja barrios distintos", () => {
    const salida = zonasCoincidentes("Jackson Heights", CATALOGO);
    expect(salida).not.toContain("Washington Heights");
    expect(salida).not.toContain("Corona");
  });

  it("cada etiqueta devuelta pasa sameZoneLabel — la fuente del criterio es una", () => {
    for (const zona of ["Corona", "bogota", "Washington", "Jackson Heights"]) {
      for (const label of zonasCoincidentes(zona, CATALOGO)) {
        expect(sameZoneLabel(zona, label)).toBe(true);
      }
    }
    // Y al revés: nada que empareje se queda afuera.
    const esperadas = CATALOGO.filter((label) => sameZoneLabel("Corona", label));
    for (const esperada of esperadas) {
      expect(zonasCoincidentes("Corona", CATALOGO)).toContain(esperada);
    }
  });

  it("siembra SIEMPRE con la zona elegida, aunque no esté en el catálogo", () => {
    // El catálogo sale de una muestra de 200 filas: una etiqueta que existe
    // pero no cayó en la muestra no puede convertirse en un vacío falso.
    expect(zonasCoincidentes("Elmhurst", CATALOGO)).toEqual(["Elmhurst"]);
    // Y con el catálogo caído (lista vacía) el filtro degrada a exacto, nunca
    // a "no hay nada".
    expect(zonasCoincidentes("Corona", [])).toEqual(["Corona"]);
  });

  it("no repite la zona elegida cuando también está en el catálogo", () => {
    const salida = zonasCoincidentes("Corona", CATALOGO);
    expect(salida.filter((label) => label === "Corona")).toHaveLength(1);
  });

  it("respeta el techo: el `.in()` viaja en el querystring y hay 8 KB de URL", () => {
    const muchas = Array.from({ length: 200 }, (_, i) => `Corona ${i}`);
    const salida = zonasCoincidentes("Corona", muchas);
    expect(salida).toHaveLength(ZONAS_MATCH_MAX);
    expect(salida[0]).toBe("Corona");
  });
});
