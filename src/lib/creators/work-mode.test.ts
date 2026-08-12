import { describe, expect, it } from "vitest";
import {
  WORK_MODES,
  WORK_MODE_HELP,
  WORK_MODE_LABEL,
  normalizeWorkMode,
  requiresArea,
  workModeLabel,
} from "./work-mode";

/**
 * Lo que estos tests protegen: que un valor raro —de la URL, de un aviso viejo
 * sin modalidad, de un form manipulado— nunca se convierta en una modalidad
 * inventada ni tire una pantalla. "No sé" tiene que poder decirse.
 */

describe("el dominio coincide con el CHECK de la base (0087)", () => {
  it("son exactamente las tres modalidades, en el formato que acepta Postgres", () => {
    expect([...WORK_MODES]).toEqual(["remoto", "presencial", "hibrido"]);
  });

  it("las tres tienen etiqueta y ayuda — ninguna se muestra como su valor técnico", () => {
    for (const mode of WORK_MODES) {
      expect(WORK_MODE_LABEL[mode].length).toBeGreaterThan(0);
      expect(WORK_MODE_HELP[mode].length).toBeGreaterThan(0);
      expect(WORK_MODE_LABEL[mode]).not.toBe(mode);
    }
  });

  it("la etiqueta no es jerga: se lee sin trabajar en tecnología", () => {
    expect(WORK_MODE_LABEL.remoto).toBe("A distancia");
    expect(WORK_MODE_LABEL.hibrido).toBe("Mixto");
  });
});

describe("normalizeWorkMode", () => {
  it("acepta los tres valores canónicos", () => {
    expect(normalizeWorkMode("remoto")).toBe("remoto");
    expect(normalizeWorkMode("presencial")).toBe("presencial");
    expect(normalizeWorkMode("hibrido")).toBe("hibrido");
  });

  it("tolera lo que una persona realmente escribe", () => {
    expect(normalizeWorkMode("  Remoto ")).toBe("remoto");
    expect(normalizeWorkMode("PRESENCIAL")).toBe("presencial");
    // La tilde que cualquiera pone y que el CHECK de la base no acepta.
    expect(normalizeWorkMode("Híbrido")).toBe("hibrido");
    expect(normalizeWorkMode("HÍBRIDO")).toBe("hibrido");
  });

  it("cualquier otra cosa es 'no se declaró', no una excepción", () => {
    expect(normalizeWorkMode(null)).toBeNull();
    expect(normalizeWorkMode(undefined)).toBeNull();
    expect(normalizeWorkMode("")).toBeNull();
    expect(normalizeWorkMode("   ")).toBeNull();
    expect(normalizeWorkMode("digital")).toBeNull();
    expect(normalizeWorkMode("on-site")).toBeNull();
    expect(normalizeWorkMode(42)).toBeNull();
    expect(normalizeWorkMode({ mode: "remoto" })).toBeNull();
    expect(normalizeWorkMode(["remoto"])).toBeNull();
  });

  it("no adivina a partir de texto libre: la zona no define la modalidad", () => {
    // `area_label` puede decir "Remoto (Washington Heights)" y eso NO alcanza:
    // la modalidad la declara quien publica, no un heurístico sobre otro campo.
    expect(normalizeWorkMode("Remoto (Washington Heights)")).toBeNull();
    expect(normalizeWorkMode("trabajo remoto")).toBeNull();
  });
});

describe("requiresArea — la única pregunta que la app le hace a la modalidad", () => {
  it("a distancia no necesita zona", () => {
    expect(requiresArea("remoto")).toBe(false);
  });

  it("presencial y mixto sí: en los dos hay que estar en algún lado", () => {
    expect(requiresArea("presencial")).toBe(true);
    expect(requiresArea("hibrido")).toBe(true);
  });

  it("sin modalidad declarada la zona se sigue pidiendo (no aflojamos por defecto)", () => {
    expect(requiresArea(null)).toBe(true);
  });
});

describe("workModeLabel", () => {
  it("traduce los valores de la base a lo que lee una persona", () => {
    expect(workModeLabel("remoto")).toBe("A distancia");
    expect(workModeLabel("hibrido")).toBe("Mixto");
  });

  it("un aviso sin modalidad no muestra chip — no inventa 'Presencial'", () => {
    expect(workModeLabel(null)).toBeNull();
    expect(workModeLabel("cualquier cosa")).toBeNull();
  });
});
