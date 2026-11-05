import { describe, expect, it } from "vitest";
import { buildTrustSignals, mesesEnLaComunidad } from "./signals";

const AHORA = new Date("2026-11-05T12:00:00Z");

describe("mesesEnLaComunidad", () => {
  it("cuenta meses calendario completos", () => {
    expect(mesesEnLaComunidad("2026-07-20T01:21:32Z", AHORA)).toBe(3);
    expect(mesesEnLaComunidad("2026-08-05T12:00:00Z", AHORA)).toBe(3);
    expect(mesesEnLaComunidad("2026-08-05T12:00:01Z", AHORA)).toBe(2);
    expect(mesesEnLaComunidad("2024-11-01T00:00:00Z", AHORA)).toBe(24);
  });

  it("no da negativo ni inventa con una fecha rota", () => {
    expect(mesesEnLaComunidad("2026-11-06T00:00:00Z", AHORA)).toBe(0);
    expect(mesesEnLaComunidad("no es fecha", AHORA)).toBeNull();
  });
});

describe("buildTrustSignals — antigüedad", () => {
  const conSeed = { months_in_community: 8 };
  const antiguedad = (fecha?: string | null) => buildTrustSignals(conSeed, false, fecha)[1];

  it("la fecha de alta manda sobre el número guardado", () => {
    const alta = new Date(Date.now() - 100 * 86_400_000).toISOString();
    expect(antiguedad(alta)?.label).toBe("En la comunidad hace 3 meses");
  });

  it("sin fecha a mano lee el jsonb", () => {
    expect(antiguedad()?.label).toBe("En la comunidad hace 8 meses");
  });

  it("con menos de un mes no afirma antigüedad", () => {
    const alta = new Date(Date.now() - 86_400_000).toISOString();
    expect(antiguedad(alta)).toEqual({ label: "Tiempo en la comunidad", achieved: false });
  });
});
