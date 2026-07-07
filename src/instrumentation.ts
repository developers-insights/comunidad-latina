import * as Sentry from "@sentry/nextjs";

/**
 * Instrumentation hook de Next (módulo OBSERVABILIDAD).
 *
 * Degradación elegante §5.6: sin NEXT_PUBLIC_SENTRY_DSN no se inicializa nada
 * — cero overhead, cero errores. Con DSN, se carga el config del runtime que
 * corresponda (Node.js / Edge). El scrub de PII vive en sentry.scrub.ts.
 */
export async function register(): Promise<void> {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return;

  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

/**
 * Captura errores de request de React Server Components / route handlers.
 * Guarded: sin DSN es un no-op (Sentry sin init igual lo tolera, pero mejor
 * ni entrar).
 */
export const onRequestError: typeof Sentry.captureRequestError = (...args) => {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return;
  return Sentry.captureRequestError(...args);
};
