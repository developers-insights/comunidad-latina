/**
 * El "no" del trigger `app.enforce_phone_verified()` (0181), traducido.
 *
 * Módulo PURO y sin `server-only` a propósito: lo importan las server actions
 * (para devolver el código) y los componentes de cliente (para mostrar el copy),
 * y no puede arrastrar Sentry ni la config de servicios. `gate.ts` lo re-exporta.
 *
 * Mismo formato que `ACCOUNT_SUSPENDED`: se busca el TOKEN de prefijo, nunca el
 * texto en español del `raise`, que está escrito para un log.
 */

/** Primera palabra del error del trigger (0181). */
export const PHONE_REQUIRED_TOKEN = "PHONE_VERIFICATION_REQUIRED";

/** Código que devuelven las acciones cuando la base cortó por teléfono sin verificar. */
export const PHONE_REQUIRED_CODE = "phone-required" as const;

/** Título corto para toasts y tarjetas. */
export const PHONE_REQUIRED_TITLE = "Confirmá tu teléfono";

/** Lo que ve la persona. Una sola frase para todas las pantallas. */
export const PHONE_REQUIRED_COPY =
  "Para publicar y escribir, primero confirmá tu teléfono. Es un momento.";

export function isPhoneRequiredError(error: { message?: string | null } | null | undefined): boolean {
  return Boolean(error?.message?.includes(PHONE_REQUIRED_TOKEN));
}

/** El copy si el error es el del trigger, y `null` si es otro: `?? copyGenerico`. */
export function phoneRequiredCopy(error: { message?: string | null } | null | undefined): string | null {
  return isPhoneRequiredError(error) ? PHONE_REQUIRED_COPY : null;
}
