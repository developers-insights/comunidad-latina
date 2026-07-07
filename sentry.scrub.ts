/**
 * Scrub de PII para Sentry — compartido por los inits de server, edge y client.
 *
 * Anti-honeypot también en telemetría (§11 del plan): a Sentry JAMÁS viajan
 * emails, nombres, cookies, ni contenido user-generated. Se scrubbea en
 * `beforeSend`, ANTES de salir del proceso — Sentry nunca ve el dato crudo.
 *
 * NOTA: este archivo NO es server-only a propósito: lo importa también
 * instrumentation-client.ts. No debe leer secretos ni importar nada de @/lib.
 */

import type { ErrorEvent, Breadcrumb } from "@sentry/nextjs";
// @sentry/nextjs re-exporta una lista curada de tipos que NO incluye
// TransactionEvent — se importa type-only desde core (dep transitiva del SDK).
import type { TransactionEvent } from "@sentry/core";

const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/gi;
// Teléfonos con formato (7+ dígitos con separadores) — mejor un falso positivo
// que un número real filtrado.
const PHONE_RE = /\+?\d[\d\s().-]{6,}\d/g;

function scrubText(value: string): string {
  return value.replace(EMAIL_RE, "[email]").replace(PHONE_RE, "[tel]");
}

function scrubUnknown<T>(value: T): T {
  if (typeof value === "string") return scrubText(value) as T;
  return value;
}

/**
 * `beforeSend` / `beforeSendTransaction`: PII fuera antes de salir del proceso.
 * Genérico sobre ambos tipos de evento: las TRANSACCIONES también llevan
 * request.url/query_string (emails en magic links / callbacks de auth) — sin
 * esto, el 10% sampleado de traces salía sin scrub (fiscal R3).
 */
export function scrubEvent<E extends ErrorEvent | TransactionEvent>(event: E): E | null {
  // Usuario: solo el id (uuid opaco). Nunca email, nombre ni IP.
  if (event.user) {
    event.user = event.user.id ? { id: event.user.id } : undefined;
  }

  // Request: nunca cookies ni headers sensibles; query strings pueden llevar
  // emails (magic links) → se scrubbean.
  if (event.request) {
    delete event.request.cookies;
    delete event.request.data;
    if (event.request.headers) {
      delete event.request.headers.cookie;
      delete event.request.headers.authorization;
      delete event.request.headers["x-forwarded-for"];
    }
    if (typeof event.request.query_string === "string") {
      event.request.query_string = scrubText(event.request.query_string);
    }
    if (typeof event.request.url === "string") {
      event.request.url = scrubText(event.request.url);
    }
  }

  // Mensajes y excepciones: emails/teléfonos incrustados en strings.
  if (event.message) event.message = scrubText(event.message);
  if (event.exception?.values) {
    for (const exception of event.exception.values) {
      if (exception.value) exception.value = scrubText(exception.value);
    }
  }

  // Breadcrumbs (fetch URLs, console.*, clicks): mismo tratamiento.
  if (event.breadcrumbs) {
    for (const crumb of event.breadcrumbs) {
      if (crumb.message) crumb.message = scrubText(crumb.message);
      if (crumb.data) {
        for (const key of Object.keys(crumb.data)) {
          crumb.data[key] = scrubUnknown(crumb.data[key]);
        }
      }
    }
  }

  return event;
}

/** `beforeBreadcrumb`: descarta consolas con posible contenido y scrubbea URLs. */
export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  if (breadcrumb.message) breadcrumb.message = scrubText(breadcrumb.message);
  if (breadcrumb.data) {
    for (const key of Object.keys(breadcrumb.data)) {
      breadcrumb.data[key] = scrubUnknown(breadcrumb.data[key]);
    }
  }
  return breadcrumb;
}

/** Opciones comunes a los tres runtimes (server / edge / client). */
export const SENTRY_SHARED_OPTIONS = {
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_APP_ENV ?? "development",
  // Sample rates sanos: 10% de traces alcanza para ver latencias sin quemar cuota.
  tracesSampleRate: 0.1,
  // PII por default: NUNCA. El scrub de arriba es la segunda barrera.
  sendDefaultPii: false,
  beforeSend: scrubEvent,
  // Mismo scrub para el sample de transacciones (tracesSampleRate 0.1): sus
  // request.url/query_string pueden llevar emails igual que un error.
  beforeSendTransaction: scrubEvent,
  beforeBreadcrumb: scrubBreadcrumb,
} as const;
