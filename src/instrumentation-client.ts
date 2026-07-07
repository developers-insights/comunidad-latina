import * as Sentry from "@sentry/nextjs";
import { SENTRY_SHARED_OPTIONS } from "../sentry.scrub";

/**
 * Sentry — lado cliente (módulo OBSERVABILIDAD).
 *
 * Guarded por NEXT_PUBLIC_SENTRY_DSN (inlineada en build): sin DSN no se
 * inicializa nada. Session Replay queda APAGADO a propósito: graba pantallas
 * con contenido de usuarios (mensajes, avisos) — anti-honeypot §11.
 */
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    ...SENTRY_SHARED_OPTIONS,
    dsn,
    // Sin replays: privacidad primero (el contenido de la app es PII de la comunidad).
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
  });
}

/** Navegaciones del App Router como transacciones (no-op sin init). */
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
