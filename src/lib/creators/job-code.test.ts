import { describe, expect, it } from "vitest";
import { formatJobCode, jobCodeVariants, matchesJobCode, normalizeJobCode } from "./job-code";

/**
 * Lo que estos tests protegen es un caso muy concreto: alguien con un recibo
 * impreso de julio, donde dice `CL-2026-0007`, pegándolo en el buscador después
 * de que 0065 renombró ese contrato a `CL-CM-2026-000007`.
 *
 * Si la búsqueda fallara ahí, del lado de esa persona no se vería como un
 * cambio de formato: se vería como que su contrato desapareció.
 */

/** Los 11 contratos migrados por 0065 tienen las dos columnas. */
const MIGRATED = { code: "CL-CM-2026-000007", code_legacy: "CL-2026-0007" };
/** Los nacidos después de 0065 solo tienen la nueva. */
const NEW_BORN = { code: "CL-CM-2026-000012", code_legacy: null };

describe("normalizeJobCode", () => {
  it("acepta lo que una persona realmente escribe", () => {
    expect(normalizeJobCode("  cl-cm-2026-000007 ")).toBe("CL-CM-2026-000007");
    expect(normalizeJobCode("CL CM 2026 000007")).toBe("CL-CM-2026-000007");
    // El guión largo que meten Word y los correos con formato.
    expect(normalizeJobCode("CL—CM—2026—000007")).toBe("CL-CM-2026-000007");
    expect(normalizeJobCode("CL–CM–2026–000007")).toBe("CL-CM-2026-000007");
    expect(normalizeJobCode("CL--CM--2026--000007")).toBe("CL-CM-2026-000007");
  });

  it("vacío es vacío, no una excepción", () => {
    expect(normalizeJobCode(null)).toBe("");
    expect(normalizeJobCode(undefined)).toBe("");
    expect(normalizeJobCode("   ")).toBe("");
  });
});

describe("jobCodeVariants", () => {
  it("del código nuevo deduce el viejo (el backfill de 0065 fue 1-a-1)", () => {
    expect(jobCodeVariants("CL-CM-2026-000007")).toEqual(
      expect.arrayContaining(["CL-CM-2026-000007", "CL-2026-0007"]),
    );
  });

  it("del código viejo deduce el nuevo", () => {
    expect(jobCodeVariants("CL-2026-0007")).toEqual(
      expect.arrayContaining(["CL-2026-0007", "CL-CM-2026-000007"]),
    );
  });

  it("no propone candidatos con lo que no puede ser un código", () => {
    // Sin candidatos, quien llama no consulta: mejor "no encontramos" que un
    // filtro vacío que devuelve todo como si fuera resultado.
    expect(jobCodeVariants("")).toEqual([]);
    expect(jobCodeVariants("  ")).toEqual([]);
    expect(jobCodeVariants("a")).toEqual([]);
  });

  it("nunca deja pasar caracteres que romperían un filtro de PostgREST", () => {
    for (const attempt of ["CL-2026-0007,*", "CL-2026-0007)", "'; drop table", "CL-2026-0007%"]) {
      for (const variant of jobCodeVariants(attempt)) {
        expect(variant).toMatch(/^[A-Z0-9-]+$/);
      }
    }
  });
});

describe("matchesJobCode", () => {
  it("el código NUEVO encuentra el contrato migrado", () => {
    expect(matchesJobCode(MIGRATED, "CL-CM-2026-000007")).toBe(true);
  });

  it("el código VIEJO encuentra el contrato migrado — el del recibo impreso", () => {
    expect(matchesJobCode(MIGRATED, "CL-2026-0007")).toBe(true);
  });

  it("da igual cómo esté escrito: minúsculas, espacios, guión largo", () => {
    expect(matchesJobCode(MIGRATED, "cl-2026-0007")).toBe(true);
    expect(matchesJobCode(MIGRATED, " CL 2026 0007 ")).toBe(true);
    expect(matchesJobCode(MIGRATED, "CL–CM–2026–000007")).toBe(true);
  });

  it("un contrato nacido después de 0065 se encuentra por su único código", () => {
    expect(matchesJobCode(NEW_BORN, "CL-CM-2026-000012")).toBe(true);
    // Y también por el formato viejo equivalente, que alguien puede tipear por
    // costumbre aunque este contrato nunca lo haya tenido.
    expect(matchesJobCode(NEW_BORN, "CL-2026-0012")).toBe(true);
  });

  it("no confunde un contrato con otro", () => {
    expect(matchesJobCode(MIGRATED, "CL-CM-2026-000008")).toBe(false);
    expect(matchesJobCode(MIGRATED, "CL-2026-0008")).toBe(false);
    expect(matchesJobCode(MIGRATED, "CL-CM-2025-000007")).toBe(false);
  });

  it("una búsqueda vacía no matchea todo", () => {
    expect(matchesJobCode(MIGRATED, "")).toBe(false);
    expect(matchesJobCode(MIGRATED, null)).toBe(false);
  });
});

describe("formatJobCode", () => {
  it("muestra el código anterior al lado del vigente", () => {
    expect(formatJobCode(MIGRATED)).toBe("CL-CM-2026-000007 (antes CL-2026-0007)");
  });

  it("sin código anterior no inventa un paréntesis vacío", () => {
    expect(formatJobCode(NEW_BORN)).toBe("CL-CM-2026-000012");
  });
});
