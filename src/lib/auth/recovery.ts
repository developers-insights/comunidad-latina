import "server-only";

import { createHash } from "node:crypto";
import * as Sentry from "@sentry/nextjs";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email";
import { resetPasswordEmail } from "@/lib/email/templates";
import { isResendConfigured, isSentryConfigured } from "@/lib/config/services";

/**
 * Recuperar la cuenta: mintea el token y manda el correo por Resend.
 *
 * ── POR QUÉ NO `resetPasswordForEmail` ───────────────────────────────────────
 * Ese método delega el correo en Supabase: la plantilla y el destino del enlace
 * quedan en el dashboard, y el `redirectTo` depende de su allow-list. Eso es un
 * solo juego de ajustes para todas las comunidades, y cada una vive en su dominio.
 * Acá Supabase sólo firma el token: el enlace lo armamos contra el host validado
 * de quien lo pidió, con la marca de su comunidad, y Resend lo entrega. No queda
 * ningún ajuste del dashboard entre la persona y su cuenta.
 *
 * El enlace pega en `/callback` con `?token_hash=…&type=recovery`, que no usa
 * PKCE: anda aunque el correo se abra en otra app que la que lo pidió, que es lo
 * normal en un teléfono y lo que pasa siempre desde la app de iPhone.
 *
 * ── SIN TELÉFONO ─────────────────────────────────────────────────────────────
 * Recuperar la cuenta NO pide teléfono. Quien no lo verificó entra igual, y el
 * pedido aparece recién adentro (ver `lib/phone/gate.ts`).
 *
 * ── NUNCA CAE AL MAILER DE SUPABASE ──────────────────────────────────────────
 * Sin Resend el correo no sale y queda alerta. La alternativa era perder la
 * plantilla por comunidad y el host correcto, que es lo que esto evita.
 */

const CALLBACK_PATH = "/callback";
const RECOVERY_NEXT = "/recuperar/actualizar";

/** Un solo reintento, corto: corre después de responder y dentro del límite de la función. */
const SEND_ATTEMPTS = 2;
const RETRY_DELAY_MS = 500;

export type RecoveryOutcome = { ok: true } | { ok: false; reason: "mint" | "email" };

export function buildRecoveryUrl(origin: string, tokenHash: string): string {
  const url = new URL(CALLBACK_PATH, origin);
  url.searchParams.set("token_hash", tokenHash);
  url.searchParams.set("type", "recovery");
  url.searchParams.set("next", RECOVERY_NEXT);
  return url.toString();
}

function report(error: unknown, reason: string): void {
  if (isSentryConfigured) {
    Sentry.captureException(error, { tags: { module: "auth", reason } });
  }
}

/** Sin Resend sólo se sigue en dev local, donde el enlace va a la consola. */
function esDevLocal(): boolean {
  return process.env.NODE_ENV !== "production" && !process.env.VERCEL_ENV;
}

/**
 * Si hoy se puede entregar un correo. Se pregunta ANTES de mintear, y no depende
 * del correo pedido: un deploy sin Resend le contesta lo mismo a todo el mundo, así
 * que el error no dice si una cuenta existe.
 */
export function canalDeRecuperacionListo(): boolean {
  if (isResendConfigured || esDevLocal()) return true;
  console.error("[auth] recuperar: Resend no configurado, el correo no puede salir");
  report(new Error("[auth] recuperación sin canal de correo"), "recovery-no-mailer");
  return false;
}

/**
 * Key del límite por cuenta. Con hash porque el limitador guarda la key en memoria
 * y un correo es PII (§11). El correo ya llega normalizado por el schema de la acción.
 */
export function claveDeLimitePorCuenta(email: string): string {
  return `recuperar-mail:${createHash("sha256").update(email).digest("hex")}`;
}

async function mintRecoveryToken(email: string): Promise<string | null> {
  let tokenHash: string | undefined;
  let code: string | undefined;
  try {
    const { data, error } = await createAdminClient().auth.admin.generateLink({
      type: "recovery",
      email,
    });
    tokenHash = data?.properties?.hashed_token;
    code = error?.code;

    // Lo único esperable: un correo sin cuenta. Sin PII en el log (§11).
    if (code === "user_not_found") {
      console.info("[auth] recuperar: no se minteó enlace", { code });
      return null;
    }
    if (error) throw error;
    if (!tokenHash) throw new Error("[auth] generateLink sin hashed_token");
    return tokenHash;
  } catch (error) {
    console.error("[auth] recuperar: no se pudo mintear el enlace", { code });
    report(error, "recovery-mint");
    return null;
  }
}

/** `sendEmail` no lanza, y ya loguea y reporta cada falla: acá sólo se reintenta. */
async function enviarConReintento(message: Parameters<typeof sendEmail>[0]): Promise<boolean> {
  for (let intento = 1; intento <= SEND_ATTEMPTS; intento += 1) {
    const sent = await sendEmail(message);
    if (sent.ok) return true;
    if (intento < SEND_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }
  return false;
}

/**
 * NUNCA lanza. Quien llama responde lo mismo pase lo que pase (anti-enumeración),
 * y lo llama desde `after()`: la respuesta ya salió, así que tampoco importa cuánto
 * tarde, y un correo inexistente y uno real son indistinguibles también por tiempo.
 */
export async function sendRecoveryEmail(params: {
  email: string;
  tenantName: string;
  brandHex: string;
  /** Origin ya validado por `resolveOriginAsync`. */
  origin: string;
}): Promise<RecoveryOutcome> {
  try {
    if (!canalDeRecuperacionListo()) return { ok: false, reason: "email" };

    const tokenHash = await mintRecoveryToken(params.email);
    if (!tokenHash) return { ok: false, reason: "mint" };

    const resetUrl = buildRecoveryUrl(params.origin, tokenHash);

    // Mismo criterio que `confirmation.ts`: la condición es el entorno. En un
    // deploy este enlace abre sesión sin contraseña y no puede ir a los logs.
    if (!isResendConfigured) {
      console.info(`[auth] Resend no configurado — enlace de recuperación (solo dev): ${resetUrl}`);
      return { ok: true };
    }

    const message = resetPasswordEmail({
      resetUrl,
      tenantName: params.tenantName,
      brandHex: params.brandHex,
    });
    if (await enviarConReintento({ to: params.email, ...message })) return { ok: true };

    console.error("[auth] recuperar: el correo no salió");
    return { ok: false, reason: "email" };
  } catch (error) {
    console.error("[auth] recuperar: falló el armado del correo");
    report(error, "recovery-email");
    return { ok: false, reason: "email" };
  }
}
