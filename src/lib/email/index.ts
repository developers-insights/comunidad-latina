import "server-only";

import * as Sentry from "@sentry/nextjs";
import { isResendConfigured, isSentryConfigured } from "@/lib/config/services";

/**
 * =============================================================================
 * EMAILS TRANSACCIONALES (módulo EMAILS) — Resend con degradación elegante §5.6
 * =============================================================================
 *
 * `sendEmail()` NUNCA lanza y NUNCA rompe el flujo del caller:
 *   - Resend configurado → envía de verdad.
 *   - Resend ausente (hoy) → loguea el skip y devuelve `{ ok: true, skipped: true }`.
 *   - Error de red / API → loguea + reporta a Sentry (sin PII: jamás el `to` ni
 *     el `html`) y devuelve `{ ok: false }`.
 *
 * Para server actions usá `sendEmailInBackground()`: fire-and-forget con .catch
 * interno — el usuario no espera al email y un email caído jamás tira la acción.
 *
 * Observabilidad: un email que falla acá NUNCA llega a `onRequestError`
 * (src/instrumentation.ts) porque `sendEmail` atrapa todo antes de que la
 * excepción se propague — por diseño, para no romper el flujo del caller. Eso
 * significa que sin un `Sentry.captureException` explícito en cada rama de
 * error, un envío caído queda invisible incluso con Sentry activo. Por eso
 * cada rama de falla real (no el skip por Resend ausente, que es esperado)
 * reporta acá mismo, guardado por `isSentryConfigured` — igual que el resto
 * del repo (mismo patrón que `onRequestError`), sin DSN es un no-op.
 *
 * Anti-honeypot (§11): en logs y en Sentry NUNCA va la dirección de email del
 * destinatario ni contenido de mensajes. Solo subject (puede traer un
 * display_name, aceptado — ver templates.ts) + tag técnico + código de error.
 */

const DEFAULT_FROM = "Comunidad Latina <hola@comunidadlatina.com>";

export type SendEmailInput = {
  to: string;
  subject: string;
  /** HTML ya renderizado (ver ./templates.ts). */
  html: string;
  /** Override puntual del remitente; por default usa EMAIL_FROM del env. */
  from?: string;
};

export type SendEmailOutcome =
  | { ok: true; skipped?: boolean }
  | { ok: false; error: string };

/** Remitente configurable por env (EMAIL_FROM) con fallback de marca. */
export function getEmailFrom(): string {
  return process.env.EMAIL_FROM?.trim() || DEFAULT_FROM;
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailOutcome> {
  const { to, subject, html } = input;

  if (!to || !subject || !html) {
    console.warn("[email] sendEmail llamado con campos incompletos — salteado", {
      hasTo: Boolean(to),
      subject: subject || "(sin subject)",
    });
    if (isSentryConfigured) {
      Sentry.captureMessage("[email] sendEmail: campos incompletos", {
        level: "warning",
        tags: { module: "email", reason: "campos-incompletos" },
      });
    }
    return { ok: false, error: "campos incompletos" };
  }

  if (!isResendConfigured) {
    // Degradación elegante: sin RESEND_API_KEY el email se saltea con log.
    // Sin PII: jamás logueamos el `to`.
    console.info("[email] Resend no configurado — email salteado", { subject });
    return { ok: true, skipped: true };
  }

  try {
    // Import dinámico: el SDK solo se carga cuando de verdad se envía.
    const { Resend } = await import("resend");
    const resend = new Resend(process.env.RESEND_API_KEY);

    const { error } = await resend.emails.send({
      from: input.from ?? getEmailFrom(),
      to,
      subject,
      html,
    });

    if (error) {
      console.error("[email] Resend devolvió error", {
        subject,
        name: error.name,
      });
      if (isSentryConfigured) {
        Sentry.captureException(new Error(`[email] Resend error: ${error.name}`), {
          tags: { module: "email", reason: "resend-api-error" },
          extra: { subject },
        });
      }
      return { ok: false, error: error.message };
    }

    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "error desconocido";
    console.error("[email] fallo inesperado enviando email", { subject, message });
    if (isSentryConfigured) {
      Sentry.captureException(error instanceof Error ? error : new Error(message), {
        tags: { module: "email", reason: "excepcion-inesperada" },
        extra: { subject },
      });
    }
    return { ok: false, error: message };
  }
}

/**
 * Fire-and-forget para server actions: dispara el envío sin await y con .catch
 * interno. El caller sigue su flujo; un email caído solo deja un log + Sentry
 * (este .catch es un backstop defensivo — `sendEmail` ya no debería rechazar
 * la promesa nunca, pero si algún día lo hace, tampoco queda en silencio).
 */
export function sendEmailInBackground(input: SendEmailInput): void {
  void sendEmail(input).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "error desconocido";
    console.error("[email] envío en background falló", {
      subject: input.subject,
      message,
    });
    if (isSentryConfigured) {
      Sentry.captureException(error instanceof Error ? error : new Error(message), {
        tags: { module: "email", reason: "background-catch" },
        extra: { subject: input.subject },
      });
    }
  });
}
