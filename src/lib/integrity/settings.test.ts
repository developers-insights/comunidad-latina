import { describe, expect, it } from "vitest";

import {
  DEFAULT_INTEGRITY_SETTINGS,
  normalizeIntegritySettings,
} from "./settings";

/**
 * Lo que este suite garantiza: una configuración rota NUNCA afloja un control.
 *
 * Es la única propiedad que importa acá. Un umbral que llega en null, negativo o
 * absurdo no puede convertirse en "no revises nada" — tiene que caer al default,
 * que es el comportamiento que el módulo tenía antes de que los umbrales fueran
 * configurables.
 */
describe("normalizeIntegritySettings", () => {
  it("sin fila devuelve los defaults", () => {
    expect(normalizeIntegritySettings(null)).toEqual(DEFAULT_INTEGRITY_SETTINGS);
    expect(normalizeIntegritySettings(undefined)).toEqual(DEFAULT_INTEGRITY_SETTINGS);
    expect(normalizeIntegritySettings("no soy una fila")).toEqual(DEFAULT_INTEGRITY_SETTINGS);
  });

  it("lee una fila válida tal cual", () => {
    expect(
      normalizeIntegritySettings({
        max_distance_similar_bits: 14,
        umbral_bloqueo_bits: 6,
        revision_humana_obligatoria_comercial: false,
        bloquear_duplicado_de_otro_usuario: false,
      }),
    ).toEqual({
      maxDistanceSimilarBits: 14,
      umbralBloqueoBits: 6,
      revisionHumanaObligatoriaComercial: false,
      bloquearDuplicadoDeOtroUsuario: false,
    });
  });

  it("un umbral fuera de rango cae al default, no al valor absurdo", () => {
    for (const roto of [-1, 65, 900, Number.NaN, Number.POSITIVE_INFINITY, null, "12"]) {
      const settings = normalizeIntegritySettings({ max_distance_similar_bits: roto });
      expect(settings.maxDistanceSimilarBits).toBe(
        DEFAULT_INTEGRITY_SETTINGS.maxDistanceSimilarBits,
      );
    }
  });

  it("el umbral de bloqueo nunca supera al de similitud", () => {
    const settings = normalizeIntegritySettings({
      max_distance_similar_bits: 5,
      umbral_bloqueo_bits: 30,
    });
    expect(settings.umbralBloqueoBits).toBe(5);
    expect(settings.umbralBloqueoBits).toBeLessThanOrEqual(settings.maxDistanceSimilarBits);
  });

  it("los flags no booleanos caen al default estricto, no a false", () => {
    const settings = normalizeIntegritySettings({
      revision_humana_obligatoria_comercial: "no",
      bloquear_duplicado_de_otro_usuario: 0,
    });
    expect(settings.revisionHumanaObligatoriaComercial).toBe(true);
    expect(settings.bloquearDuplicadoDeOtroUsuario).toBe(true);
  });

  it("redondea distancias fraccionarias en vez de descartarlas", () => {
    expect(normalizeIntegritySettings({ max_distance_similar_bits: 12.4 }).maxDistanceSimilarBits)
      .toBe(12);
  });
});
