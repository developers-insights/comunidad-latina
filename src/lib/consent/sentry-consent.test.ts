import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SENTRY_CONSENT_CATEGORY } from "./gate";

/**
 * GUARDIA DE LA DECISIÓN SOBRE SENTRY.
 *
 * Sentry quedó clasificado como "necesarias" —o sea, fuera del consentimiento—
 * por tres razones concretas y verificables, no por comodidad:
 *   1. no escribe NADA en el dispositivo (sin Session Replay no hay cookie ni
 *      localStorage), y el art. 5.3 de ePrivacy sólo se activa cuando se
 *      escribe o lee en el equipo del usuario;
 *   2. `sendDefaultPii: false` + el scrub quitan email, teléfono, IP, cookies
 *      y cuerpo del request antes de enviar;
 *   3. su fin es mantener el servicio en pie, no medir audiencia.
 *
 * Cada una de esas razones es una condición que alguien puede romper con una
 * línea. Este archivo existe para que romperla FALLE acá y no en una auditoría:
 * si Sentry pasa a grabar pantalla o a mandar PII, deja de estar exento y hay
 * que moverlo a `requiere-opt-in` y gatearlo.
 */

const scrubSource = readFileSync(
  fileURLToPath(new URL("../../../sentry.scrub.ts", import.meta.url)),
  "utf8",
);

describe("Sentry sigue mereciendo estar fuera del consentimiento", () => {
  it("está clasificado como necesario", () => {
    expect(SENTRY_CONSENT_CATEGORY).toBe("necesarias");
  });

  it("NO manda PII por defecto", () => {
    // `sendDefaultPii: true` haría viajar IP y datos de usuario sin scrub.
    expect(scrubSource).toContain("sendDefaultPii: false");
    expect(scrubSource).not.toContain("sendDefaultPii: true");
  });

  it("NO tiene Session Replay", () => {
    // Replay graba la pantalla, incluido lo que la persona escribe en un
    // formulario. Eso SÍ guarda datos en el dispositivo y SÍ exige
    // consentimiento previo: si aparece, esta clasificación se cae.
    expect(scrubSource).not.toMatch(/replayIntegration|replaysSessionSampleRate|Replay\(/);
  });

  it("borra cookies, autorización e IP del evento antes de enviarlo", () => {
    expect(scrubSource).toContain("delete event.request.cookies");
    expect(scrubSource).toContain('delete event.request.headers["x-forwarded-for"]');
    expect(scrubSource).toContain("delete event.request.headers.authorization");
  });

  it("del usuario sólo deja el id opaco", () => {
    expect(scrubSource).toMatch(/event\.user\s*=\s*event\.user\.id\s*\?\s*\{\s*id:/);
  });

  it("scrubbea también las transacciones, no sólo los errores", () => {
    // El 10% de traces lleva request.url y query_string, donde viajan emails
    // en los enlaces de confirmación de cuenta.
    expect(scrubSource).toContain("beforeSendTransaction: scrubEvent");
  });
});
