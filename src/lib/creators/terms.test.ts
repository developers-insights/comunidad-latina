import { describe, expect, it } from "vitest";
import {
  CREATOR_TERMS,
  CREATOR_TERMS_VERSION,
  creatorTermsState,
  needsCreatorTermsAcceptance,
  satisfiesCreatorTermsGate,
} from "./terms";

/**
 * El punto del versionado no es tener un número: es poder cambiar los términos
 * mañana SIN romper a quien firmó los de hoy. Estos tests fijan las dos mitades
 * de esa promesa, que son distintas a propósito:
 *
 *  · la app vuelve a PEDIR la aceptación cuando la versión cambia;
 *  · la base sigue considerando ACEPTADOS los términos, así que nadie se vuelve
 *    inelegible por una edición de texto.
 */

const CURRENT = CREATOR_TERMS.version;
const NEXT_VERSION = "2027-01-01";

describe("CREATOR_TERMS", () => {
  it("tiene versión, etiqueta legible y contenido", () => {
    expect(CREATOR_TERMS.version).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(CREATOR_TERMS.label.length).toBeGreaterThan(0);
    expect(CREATOR_TERMS.sections.length).toBeGreaterThan(0);
    for (const section of CREATOR_TERMS.sections) {
      expect(section.title.length).toBeGreaterThan(0);
      expect(section.body.length).toBeGreaterThan(0);
    }
  });

  it("el alias de compatibilidad apunta a la misma versión", () => {
    expect(CREATOR_TERMS_VERSION).toBe(CREATOR_TERMS.version);
  });
});

describe("creatorTermsState", () => {
  it("nunca aceptó", () => {
    expect(creatorTermsState(null)).toBe("never");
    expect(creatorTermsState({ acceptedAt: null, version: null })).toBe("never");
  });

  it("aceptó la versión vigente", () => {
    expect(creatorTermsState({ acceptedAt: "2026-08-08T10:00:00Z", version: CURRENT })).toBe(
      "current",
    );
  });

  it("aceptó una versión anterior", () => {
    expect(creatorTermsState({ acceptedAt: "2026-01-01T10:00:00Z", version: "2025-01-01" })).toBe(
      "outdated",
    );
  });

  it("una aceptación SIN versión no se toma por vigente", () => {
    // Hay filas anteriores a 0064 donde la columna no existía. Darlas por
    // buenas sería asumir que firmaron algo que nunca vieron.
    expect(creatorTermsState({ acceptedAt: "2026-01-01T10:00:00Z", version: null })).toBe(
      "outdated",
    );
  });
});

describe("cuando los términos cambian", () => {
  const veteran = { acceptedAt: "2026-08-08T10:00:00Z", version: CURRENT };

  it("hoy no se le pide nada", () => {
    expect(needsCreatorTermsAcceptance(veteran)).toBe(false);
  });

  it("al subir la versión se le vuelve a pedir la aceptación", () => {
    expect(needsCreatorTermsAcceptance(veteran, NEXT_VERSION)).toBe(true);
  });

  it("pero NO deja de ser elegible: el gate de la base solo mira que haya aceptado", () => {
    // Esta es la mitad que importa. `app.creator_activation_eligible()` evalúa
    // `creator_terms_accepted_at is not null` y nada más, así que un cambio de
    // texto no puede dejar sin trabajo a quien ya había firmado.
    expect(satisfiesCreatorTermsGate(veteran)).toBe(true);
  });

  it("quien nunca aceptó sí queda fuera del gate", () => {
    expect(satisfiesCreatorTermsGate(null)).toBe(false);
    expect(satisfiesCreatorTermsGate({ acceptedAt: null, version: CURRENT })).toBe(false);
  });
});
