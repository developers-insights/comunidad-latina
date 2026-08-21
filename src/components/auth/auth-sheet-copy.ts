/**
 * Textos y tipos de la hoja de entrada. Módulo aparte y SIN JSX para que el
 * provider (que sí viaja en el bundle del feed) pueda leer los títulos sin
 * arrastrar los formularios de auth, que se cargan recién al abrir la hoja.
 */

/** En qué paso está la hoja. No es un wizard: son tres pantallas hermanas. */
export type AuthSheetStep = "login" | "register" | "check-email";

export const AUTH_SHEET_COPY = {
  ariaLabel: "Entrar a tu comunidad",
  /** Título cuando quien llama no dio un motivo. */
  defaultReason: "Entrá para seguir",
  promise: "Entrás y seguís justo acá, sin perder lo que estabas haciendo.",
  registerTitle: "Sumate a tu comunidad",
  registerPromise: "Creás tu cuenta en un minuto y volvés a esta pantalla.",
  or: "o",
  toLoginPrompt: "¿Ya tenés cuenta?",
  toLoginAction: "Entrá",
  checkEmailBack: "Listo, cerrar",
  loading: "Abriendo…",
} as const;

/**
 * Por qué se pide entrar. Viven acá y no en `feed/copy.ts` porque son el
 * TÍTULO de esta hoja: si mañana cambia el tono de la puerta, cambia en un solo
 * lugar y no en cinco islas.
 *
 * Todos empiezan por el verbo y nombran la acción que la persona ACABA de
 * intentar — nunca "Autenticación requerida", que le cuenta cómo está hecho el
 * sistema en vez de qué le falta para seguir.
 */
export const AUTH_REASON = {
  comment: "Entrá y dejá tu comentario",
  like: "Entrá para dar me gusta",
  save: "Entrá para guardarlo",
  vote: "Entrá para votar",
  report: "Entrá para reportar",
  apply: "Entrá y mandá tu postulación",
  message: "Entrá y escribile",
  follow: "Entrá para seguir",
  interest: "Entrá y anotate",
  contract: "Entrá para contratar",
  review: "Entrá y dejá tu reseña",
} as const;
