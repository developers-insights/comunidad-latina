import "server-only";

import * as Sentry from "@sentry/nextjs";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email";
import { confirmAccountEmail } from "@/lib/email/templates";
import { isResendConfigured, isSentryConfigured } from "@/lib/config/services";

/**
 * =============================================================================
 * CONFIRMACIÓN DE CUENTA — mintea el token y manda el correo (por Resend)
 * =============================================================================
 *
 * Por qué existe este módulo y no `resend()` de Supabase: el mailer compartido
 * de Supabase solo entrega a miembros del team, así que un correo de
 * confirmación mandado por ahí no llega a un usuario real. Acá el token lo firma
 * Supabase (Admin API) y el correo lo manda Resend, que es el único canal
 * verificado del proyecto.
 *
 * El enlace NO es el `action_link` que devuelve Supabase: ese pega en
 * `/auth/v1/verify` y después redirige al `Site URL` del proyecto (hoy
 * `localhost:3000`, porque los dominios de producción no están en la allow-list
 * del dashboard). Usamos el `hashed_token` contra nuestra propia ruta
 * `/confirmar`, que no depende de esa configuración y siempre vuelve al mismo
 * host donde la persona se registró.
 *
 * Verificado en vivo contra el proyecto (2026-08-01):
 *   - `generateLink({ type: "signup" })` sobre un usuario ya creado con
 *     `email_confirm: false` devuelve 200 y CONSERVA su `app_metadata`
 *     (tenant_id, role) — por eso el usuario se crea con `createUser` y el link
 *     se mintea después, en dos pasos.
 *   - `verifyOtp({ type: "signup", token_hash })` confirma el email Y devuelve
 *     sesión, y el token es de un solo uso (el segundo intento da 403).
 */

/** Ruta propia que canjea el token (ver `src/app/(auth)/confirmar/route.ts`). */
export const CONFIRM_PATH = "/confirmar";

export type ConfirmationOutcome =
  /** Correo entregado a Resend. */
  | { ok: true }
  /** Sin Resend configurado (dev): el enlace se loguea en la consola del server. */
  | { ok: true; skipped: true }
  | { ok: false; reason: "mint" | "email" };

function buildConfirmUrl(params: {
  origin: string;
  tokenHash: string;
  next?: string;
}): string {
  const url = new URL(CONFIRM_PATH, params.origin);
  url.searchParams.set("token_hash", params.tokenHash);
  url.searchParams.set("type", "signup");
  if (params.next) url.searchParams.set("next", params.next);
  return url.toString();
}

/**
 * Mintea el token de confirmación del usuario y le manda el correo.
 *
 * NUNCA lanza: el registro ya creó la cuenta cuando esto corre, así que una
 * falla de correo no puede tirar la acción — se reporta y el caller decide qué
 * contarle a la persona (hay reenvío desde /entrar).
 */
export async function sendConfirmationEmail(params: {
  email: string;
  /** La contraseña recién elegida (Supabase la exige para `type: "signup"`). */
  password: string;
  /** Si falta, se usa el `display_name` que devuelve la propia Admin API. */
  displayName?: string;
  tenantName: string;
  brandHex: string;
  /** Origin público del request (mismo host donde se registró). */
  origin: string;
  /** Ruta interna a la que aterriza después de confirmar. */
  next?: string;
}): Promise<ConfirmationOutcome> {
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return { ok: false, reason: "mint" };
  }

  const { data, error } = await admin.auth.admin.generateLink({
    type: "signup",
    email: params.email,
    password: params.password,
  });

  const tokenHash = data?.properties?.hashed_token;
  if (error || !tokenHash) {
    // Sin PII: jamás el email ni el token en logs ni en Sentry (§11).
    console.error("[auth] confirmación: no se pudo mintear el enlace", {
      code: error?.code,
    });
    if (isSentryConfigured) {
      Sentry.captureException(
        error ?? new Error("[auth] generateLink sin hashed_token"),
        { tags: { module: "auth", reason: "confirm-mint" } },
      );
    }
    return { ok: false, reason: "mint" };
  }

  const confirmUrl = buildConfirmUrl({
    origin: params.origin,
    tokenHash,
    next: params.next,
  });

  if (!isResendConfigured) {
    // Sin Resend la cuenta quedaría inaccesible en local, así que en DEV el
    // enlace se imprime en la consola del server.
    //
    // La condición es el entorno, NO `isResendConfigured` (auditoría
    // 2026-08-02). Antes alcanzaba con que faltara la key para imprimirlo, y
    // ese es un estado perfectamente alcanzable en producción: la clave vence,
    // se rota mal, o el deploy sale sin ella —ya pasó: producción llegó a tener
    // 7 de 20 variables—. En cualquiera de esos casos cada registro escribía en
    // los logs de Vercel un `token_hash` de un solo uso que abre sesión sin
    // contraseña. Quien lea los logs (o un drain, o el breadcrumb de consola
    // que el SDK de Sentry captura solo) se lleva la cuenta.
    if (process.env.NODE_ENV !== "production" && !process.env.VERCEL_ENV) {
      console.info(
        `[auth] Resend no configurado — enlace de confirmación (solo dev): ${confirmUrl}`,
      );
    } else {
      // En prod se avisa que falta el canal, sin el token: el enlace no salió.
      console.error(
        "[auth] confirmación: Resend no configurado — la cuenta quedó creada SIN correo de confirmación. Revisar RESEND_API_KEY.",
      );
      if (isSentryConfigured) {
        Sentry.captureException(
          new Error("[auth] confirmación sin canal de correo (RESEND_API_KEY ausente)"),
          { tags: { module: "auth", reason: "confirm-no-mailer" } },
        );
      }
    }
    return { ok: true, skipped: true };
  }

  const metaName = data?.user?.user_metadata?.display_name;
  const mail = confirmAccountEmail({
    displayName:
      params.displayName || (typeof metaName === "string" ? metaName : ""),
    confirmUrl,
    tenantName: params.tenantName,
    brandHex: params.brandHex,
  });

  const sent = await sendEmail({
    to: params.email,
    subject: mail.subject,
    html: mail.html,
  });

  // `sendEmail` ya loguea y reporta a Sentry cada rama de error.
  return sent.ok ? { ok: true } : { ok: false, reason: "email" };
}

/**
 * Reenvío del enlace desde /entrar, para quien se registró y nunca confirmó
 * (o no le llegó el correo).
 *
 * Exige la contraseña correcta a propósito: se verifica contra Supabase con un
 * cliente anónimo efímero y SOLO se manda el correo cuando la respuesta es
 * exactamente `email_not_confirmed`, o sea credenciales válidas + cuenta sin
 * confirmar. Sin esa puerta, el endpoint sería una forma de mandarle correos a
 * cualquier dirección ajena escribiéndola en un formulario.
 *
 * El cliente es efímero y sin cookies (`persistSession: false`) para que
 * verificar credenciales acá no pueda dejar una sesión abierta de rebote.
 */
export async function resendConfirmationForCredentials(params: {
  email: string;
  password: string;
  tenantName: string;
  brandHex: string;
  origin: string;
  next?: string;
}): Promise<{ sent: boolean }> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return { sent: false };

  const { createClient } = await import("@supabase/supabase-js");
  const anon = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { error } = await anon.auth.signInWithPassword({
    email: params.email,
    password: params.password,
  });

  // Cualquier otra cosa (credenciales malas, cuenta ya confirmada, rate limit
  // de Supabase) sale por acá sin mandar nada y sin decir cuál fue el caso.
  if (error?.code !== "email_not_confirmed") return { sent: false };

  const outcome = await sendConfirmationEmail({
    email: params.email,
    password: params.password,
    tenantName: params.tenantName,
    brandHex: params.brandHex,
    origin: params.origin,
    next: params.next,
  });

  return { sent: outcome.ok };
}
