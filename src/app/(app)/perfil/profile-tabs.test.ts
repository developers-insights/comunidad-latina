import { describe, expect, it } from "vitest";
import {
  PROFILE_TAB_IDS,
  PROFILE_TAB_LABELS,
  parseProfileTab,
  profileTabHref,
} from "./profile-tabs";

/**
 * Lógica pura de las pestañas del perfil — entorno node, sin Supabase ni jsdom
 * (ver el docblock de `profile-tabs.ts`). Se enfoca en la pestaña "avisos"
 * nueva: las otras siete no cambiaron de comportamiento con este agregado.
 */

describe("PROFILE_TAB_IDS — pestaña «avisos»", () => {
  it("existe, y va después de «videos» y antes de «informacion»", () => {
    const videos = PROFILE_TAB_IDS.indexOf("videos");
    const avisos = PROFILE_TAB_IDS.indexOf("avisos");
    const informacion = PROFILE_TAB_IDS.indexOf("informacion");
    expect(avisos).toBeGreaterThan(-1);
    expect(avisos).toBe(videos + 1);
    expect(informacion).toBe(avisos + 1);
  });

  it("tiene ocho pestañas en total (la contraparte de este test si algún día se borra una)", () => {
    expect(PROFILE_TAB_IDS.length).toBe(8);
  });
});

describe("PROFILE_TAB_LABELS.avisos", () => {
  it('es "Avisos"', () => {
    expect(PROFILE_TAB_LABELS.avisos).toBe("Avisos");
  });
});

describe("parseProfileTab — avisos", () => {
  it('"avisos" → tab "avisos"', () => {
    expect(parseProfileTab("avisos")).toBe("avisos");
  });

  it("mayúsculas y espacios sueltos también resuelven a «avisos» (mismo trim+lowercase que el resto)", () => {
    expect(parseProfileTab("  AVISOS  ")).toBe("avisos");
  });
});

describe("profileTabHref — avisos", () => {
  it('arma "<base>?t=avisos", igual que cualquier pestaña que no sea la canónica', () => {
    expect(profileTabHref("/perfil/abc-123", "avisos")).toBe("/perfil/abc-123?t=avisos");
  });
});
