import { describe, expect, it } from "vitest";
import { ELIGIBILITY_REASONS, type EligibilityCheck, type EligibilityReason } from "./eligibility";
import { REASON_ADMIN_LABEL, describeEligibilityCheck } from "./eligibility-copy";

/**
 * LA REGLA QUE ESTE ARCHIVO DEFIENDE: ningún código de la base llega a la
 * pantalla.
 *
 * `seguidores` es un identificador de columna; lo que la persona necesita leer
 * es "Te faltan 40 seguidores". Si mañana una migración agrega un código nuevo
 * y nadie escribe su texto, este test lo detiene acá y no en producción.
 */

function checkOf(reason: EligibilityReason, over: Partial<EligibilityCheck> = {}): EligibilityCheck {
  return {
    reason,
    key: "minAge",
    status: "missing",
    current: 60,
    target: 100,
    remaining: 40,
    ...over,
  };
}

describe("describeEligibilityCheck", () => {
  it.each(ELIGIBILITY_REASONS)("'%s' tiene traducción humana en los tres estados", (reason) => {
    for (const status of ["missing", "met", "unknown"] as const) {
      const copy = describeEligibilityCheck(checkOf(reason, { status }));
      expect(copy.title.trim().length, `${reason}/${status} sin título`).toBeGreaterThan(0);
      expect(copy.detail.trim().length, `${reason}/${status} sin detalle`).toBeGreaterThan(0);
    }
  });

  it.each(ELIGIBILITY_REASONS)("'%s' nunca filtra el código crudo a la pantalla", (reason) => {
    const copy = describeEligibilityCheck(checkOf(reason));
    const shown = `${copy.title} ${copy.detail} ${copy.action?.label ?? ""}`;

    // Algunos códigos son además palabras del idioma ("seguidores", "videos"),
    // así que prohibir la subcadena sería absurdo: lo que no puede pasar es que
    // el TEXTO SEA el código, o que se cuele un identificador de esquema.
    expect(copy.title, `${reason} muestra el código como título`).not.toBe(reason);
    expect(copy.detail, `${reason} muestra el código como detalle`).not.toBe(reason);
    // `user_score`, `stripe_connect`, `terminos_creador`… — el guión bajo es la
    // huella inconfundible de un identificador que se escapó.
    expect(shown, `${reason} deja un identificador con guión bajo`).not.toMatch(/[a-z]_[a-z]/i);
    expect(shown.toLowerCase()).not.toContain("null");
    expect(shown.toLowerCase()).not.toContain("undefined");
    // Y tiene que ser una frase, no una etiqueta suelta.
    expect(copy.detail.trim().split(/\s+/).length, `${reason} no es una frase`).toBeGreaterThan(2);
  });

  it("dice el número exacto que falta, no 'no calificás'", () => {
    const copy = describeEligibilityCheck(
      checkOf("seguidores", { current: 60, target: 100, remaining: 40 }),
    );
    expect(copy.detail).toContain("40");
    expect(copy.detail).toContain("60");
    expect(copy.detail).toContain("100");
  });

  it("singulariza cuando falta uno solo — 'te faltan 1 seguidores' es un cartel roto", () => {
    const copy = describeEligibilityCheck(
      checkOf("seguidores", { current: 99, target: 100, remaining: 1 }),
    );
    expect(copy.detail).toContain("1 seguidor");
    expect(copy.detail).not.toContain("1 seguidores");
  });

  it("cuando hay dónde resolverlo, ofrece el próximo paso", () => {
    expect(describeEligibilityCheck(checkOf("identidad")).action?.href).toBe("/perfil/verificar");
    expect(describeEligibilityCheck(checkOf("terminos_creador")).action?.href).toBe(
      "/creadores/terminos",
    );
  });

  it("un requisito cumplido no ofrece acción — no hay nada que hacer", () => {
    expect(describeEligibilityCheck(checkOf("portafolio", { status: "met" })).action).toBeUndefined();
  });

  it("un dato ilegible se dice como tal, sin acusar a la persona", () => {
    const copy = describeEligibilityCheck(checkOf("user_score", { status: "unknown" }));
    expect(copy.detail.toLowerCase()).toContain("no pudimos");
  });
});

describe("REASON_ADMIN_LABEL", () => {
  it.each(ELIGIBILITY_REASONS)("'%s' tiene etiqueta para el panel", (reason) => {
    expect(REASON_ADMIN_LABEL[reason]?.trim().length).toBeGreaterThan(0);
    expect(REASON_ADMIN_LABEL[reason]).not.toContain("_");
  });
});
