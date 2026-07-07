/**
 * Cookie efímera con el id de la VerificationSession de Stripe Identity.
 *
 * Stripe Identity NO templetiza el session id en el return_url (a diferencia
 * de Checkout con {CHECKOUT_SESSION_ID}), así que la página de resultado lo
 * recupera de esta cookie httpOnly seteada por la server action al crearla.
 *
 * §5.4: el id `vs_...` no es PII ni permite leer el documento — el documento
 * vive SOLO en Stripe. La cookie expira sola en 1 hora.
 */
export const IDENTITY_SESSION_COOKIE = "cl-identity-session";

export const IDENTITY_SESSION_COOKIE_MAX_AGE = 60 * 60; // 1 hora
