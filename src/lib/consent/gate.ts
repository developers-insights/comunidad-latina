import { CATEGORY_META, type ConsentCategory } from "./categories";
import { readConsent, resolveGrants, subscribe } from "./store";

/**
 * EL GATE — la puerta que TODO script no esencial tiene que cruzar.
 *
 * CÓMO SE USA (y es la única forma admitida):
 *
 *   import { whenConsented } from "@/lib/consent";
 *
 *   whenConsented("analitica", () => {
 *     // recién acá se carga el script de medición
 *   });
 *
 * Nunca poner un `<Script>` de terceros directo en un layout. Si el script se
 * monta y DESPUÉS se le pide permiso, el dato ya salió: el consentimiento
 * previo es lo único que cuenta, y un banner sobre un script ya cargado es
 * decorativo.
 */

/**
 * ¿Hay permiso para esta categoría, ahora mismo?
 *
 * En el servidor devuelve `false` para todo lo que no sea `necesarias`: sin
 * navegador no hay decisión que leer, y ante la duda la respuesta segura es no.
 */
export function hasConsent(category: ConsentCategory): boolean {
  if (category === "necesarias") return true;
  if (typeof window === "undefined") return false;
  return resolveGrants(readConsent())[category] === true;
}

/**
 * Ejecuta `run` cuando haya permiso — ya sea ahora o cuando la persona lo dé
 * más tarde sin recargar la página. Devuelve la función para desuscribirse.
 *
 * `run` se ejecuta UNA sola vez: cargar dos veces el mismo script de medición
 * duplicaría cada evento.
 */
export function whenConsented(
  category: ConsentCategory,
  run: () => void,
): () => void {
  if (typeof window === "undefined") return () => {};

  if (hasConsent(category)) {
    run();
    return () => {};
  }

  let done = false;
  const unsubscribe = subscribe(() => {
    if (done || !hasConsent(category)) return;
    done = true;
    unsubscribe();
    run();
  });
  return unsubscribe;
}

/**
 * SENTRY — POR QUÉ QUEDA BAJO "NECESARIAS" Y NO BAJO CONSENTIMIENTO
 * ================================================================
 * La decisión se tomó mirando qué manda de verdad `sentry.scrub.ts`, no la
 * categoría genérica "telemetría":
 *
 *  1. NO GUARDA NADA EN EL DISPOSITIVO. El SDK de navegador no pone cookies ni
 *     escribe en localStorage con esta configuración — no hay Session Replay
 *     (no se inicializa `replayIntegration`). El artículo 5.3 de ePrivacy, que
 *     es el que obliga a pedir consentimiento, se activa cuando se ESCRIBE o
 *     LEE algo en el equipo del usuario. Acá eso no ocurre, así que no hay
 *     cookie que consentir.
 *  2. LO QUE SALE VA SIN PII. `sendDefaultPii: false`, y `scrubEvent` borra
 *     cookies, cabeceras `authorization` y `x-forwarded-for` (la IP), el cuerpo
 *     del request, y reemplaza emails y teléfonos por `[email]` / `[tel]` en
 *     mensajes, excepciones, breadcrumbs y URLs. Del usuario queda sólo un id
 *     opaco.
 *  3. EL FIN ES MANTENER EL SERVICIO EN PIE, no medir audiencia ni perfilar.
 *     Es interés legítimo (art. 6.1.f), no publicidad.
 *
 * Sigue siendo un tercero en EE.UU. que recibe datos, así que se DECLARA en la
 * política de privacidad. Lo que no corresponde es esconderlo detrás de un
 * banner de cookies: no es una cookie.
 *
 * ⚠️ ESTO SE CAE si alguien enciende Session Replay (graba la pantalla, incluido
 * lo que la persona escribe) o pone `sendDefaultPii: true`. Cualquiera de las
 * dos convierte a Sentry en `requiere-opt-in` y obliga a moverlo de categoría.
 * `sentry-consent.test.ts` falla a propósito si eso pasa.
 */
export const SENTRY_CONSENT_CATEGORY: ConsentCategory = "necesarias";

/** Etiqueta legible de una categoría, para la UI y los tests. */
export function categoryLabel(category: ConsentCategory): string {
  return CATEGORY_META[category].label;
}
