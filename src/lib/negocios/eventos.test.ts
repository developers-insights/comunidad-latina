import { describe, expect, it } from "vitest";
import { eventoSigueVigente } from "./eventos";

/**
 * `eventoSigueVigente` es la única lógica no trivial de `eventos.ts` — el resto
 * es una consulta directa (mismo patrón sin test que `fetchPuestosDelNegocio`
 * en `empleos.ts`). Esto es lo que decide si un evento sigue en la ficha del
 * negocio o desaparece, y depende de la zona horaria — exactamente la clase de
 * bug silencioso que un test de fecha fija sí puede atrapar.
 */
describe("eventoSigueVigente", () => {
  // "Ahora": 26 de agosto de 2026, 15:00 UTC.
  const NOW = new Date("2026-08-26T15:00:00Z");
  const NY = "America/New_York"; // UTC-4 en agosto (EDT)

  it("evento de mañana → vigente", () => {
    expect(eventoSigueVigente("2026-08-27T18:00:00Z", NOW, NY)).toBe(true);
  });

  it("evento de hoy, más tarde → vigente", () => {
    expect(eventoSigueVigente("2026-08-26T23:00:00Z", NOW, NY)).toBe(true);
  });

  it("evento de hoy que ya empezó (en curso, sin ends_at) → sigue vigente", () => {
    // 12:00 UTC = 08:00 en Nueva York: ya pasó la hora de inicio, pero es el
    // MISMO día calendario que "ahora" (26 ago) → no desaparece a media tarde.
    expect(eventoSigueVigente("2026-08-26T12:00:00Z", NOW, NY)).toBe(true);
  });

  it("evento de ayer → ya no vigente", () => {
    expect(eventoSigueVigente("2026-08-25T23:00:00Z", NOW, NY)).toBe(false);
  });

  it("fecha inválida en attrs → no vigente, no revienta", () => {
    expect(eventoSigueVigente("no-es-una-fecha", NOW, NY)).toBe(false);
  });

  /**
   * LA ZONA CAMBIA LA RESPUESTA — mismo instante exacto, dos veredictos
   * distintos según quién mira.
   *
   * `startsAt` = 2026-08-26T08:00:00Z.
   *   · Nueva York (UTC-4 en agosto): 08:00 UTC = 04:00 del 26 ago → "hoy" ahí
   *     también es 26 ago (NOW cae a las 11:00 hora local) → 26 ago >= 26 ago
   *     → VIGENTE.
   *   · Auckland (UTC+12 en agosto, invierno NZ, sin horario de verano): 08:00
   *     UTC = 20:00 del 26 ago → pero NOW (26 ago 15:00 UTC) cae a las 03:00
   *     del 27 ago allá → "hoy" en Auckland es 27 ago → 26 ago < 27 ago →
   *     YA NO VIGENTE.
   *
   * Si esta función comparara instantes UTC en vez del día calendario de la
   * zona de quien mira, las dos preguntas darían la misma respuesta — y una de
   * las dos estaría mostrando o escondiendo el evento en el día equivocado.
   */
  it("respeta la zona de quien mira, no la del servidor", () => {
    const startsAt = "2026-08-26T08:00:00Z";
    expect(eventoSigueVigente(startsAt, NOW, "America/New_York")).toBe(true);
    expect(eventoSigueVigente(startsAt, NOW, "Pacific/Auckland")).toBe(false);
  });
});
