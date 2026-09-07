import { describe, expect, it } from "vitest";
import { codigoDeLlamada, tokenDeError } from "./errores";

/**
 * Tests de la traducción de errores de la base.
 *
 * Lo que protegen no es "que traduzca": es que traduzca POR TOKEN DE PREFIJO y
 * nunca por el texto en español. El mensaje del `raise` está escrito para un
 * log y se puede reescribir cualquier día; el día que alguien lo haga, un
 * string-match del castellano dejaría a la pantalla mostrando "algo salió mal"
 * en lugar de "la llamada está completa", sin que ningún test se ponga rojo.
 */

describe("tokenDeError", () => {
  it("saca el token del prefijo y descarta el resto", () => {
    expect(tokenDeError("CALL_FULL: una llamada admite hasta 10 personas.")).toBe("CALL_FULL");
    expect(tokenDeError("  ACCOUNT_SUSPENDED : tu cuenta está suspendida")).toBe(
      "ACCOUNT_SUSPENDED",
    );
  });

  it("no inventa un token donde no hay prefijo", () => {
    expect(tokenDeError("una llamada admite hasta 10 personas")).toBe("");
    expect(tokenDeError("new row violates row-level security policy")).toBe("");
    expect(tokenDeError(undefined)).toBe("");
    expect(tokenDeError(null)).toBe("");
  });
});

describe("codigoDeLlamada", () => {
  it("traduce CALL_FULL, que es el que la pantalla tiene que saber contar", () => {
    expect(codigoDeLlamada({ message: "CALL_FULL: una llamada admite hasta 10 personas." })).toBe(
      "call-full",
    );
  });

  it("traduce la cuenta suspendida del trigger de la 0021", () => {
    expect(
      codigoDeLlamada({ message: "ACCOUNT_SUSPENDED: tu cuenta está suspendida y no puede…" }),
    ).toBe("account-suspended");
  });

  it("un rechazo de la RLS es 'forbidden' aunque no traiga token", () => {
    expect(
      codigoDeLlamada({
        code: "42501",
        message: 'new row violates row-level security policy for table "call_participants"',
      }),
    ).toBe("forbidden");
  });

  it("NO traduce por el texto en español: sin token no hay código propio", () => {
    // Si esto alguna vez devolviera "call-full", significa que alguien puso un
    // string-match del castellano y la traducción quedó atada a una frase.
    expect(codigoDeLlamada({ message: "una llamada admite hasta 10 personas." })).toBe("error");
  });

  it("sin error no hay nada que traducir", () => {
    expect(codigoDeLlamada(null)).toBe("error");
    expect(codigoDeLlamada(undefined)).toBe("error");
  });
});
