import "server-only";

import { isResendConfigured } from "@/lib/config/services";

/**
 * =============================================================================
 * EMAILS TRANSACCIONALES (módulo EMAILS) — Resend con degradación elegante §5.6
 * =============================================================================
 *
 * `sendEmail()` NUNCA lanza y NUNCA rompe el flujo del caller:
 *   - Resend configurado → envía de verdad.
 *   - Resend ausente (hoy) → loguea el skip y devuelve `{ ok: true, skipped: true }`.
 *   - Error de red / API → loguea (sin PII: jamás el `to`) y devuelve `{ ok: false }`.
 *
 * Para server actions usá `sendEmailInBackground()`: fire-and-forget con .catch
 * interno — el usuario no espera al email y un email caído jamás tira la acción.
 *
 * Anti-honeypot (§11): en logs NUNCA va la dirección de email del destinatario
 * ni contenido de mensajes. Solo subject + tag técnico.
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
      return { ok: false, error: error.message };
    }

    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "error desconocido";
    console.error("[email] fallo inesperado enviando email", { subject, message });
    return { ok: false, error: message };
  }
}

/**
 * Fire-and-forget para server actions: dispara el envío sin await y con .catch
 * interno. El caller sigue su flujo; un email caído solo deja un log.
 */
export function sendEmailInBackground(input: SendEmailInput): void {
  void sendEmail(input).catch((error: unknown) => {
    console.error("[email] envío en background falló", {
      subject: input.subject,
      message: error instanceof Error ? error.message : "error desconocido",
    });
  });
}
