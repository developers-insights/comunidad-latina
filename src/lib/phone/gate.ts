import "server-only";

import * as Sentry from "@sentry/nextjs";
import {
  isPhonePepperConfigured,
  isPhoneVerificationEnabled,
  isSentryConfigured,
  isSmsConfigured,
} from "@/lib/config/services";

/**
 * El teléfono obligatorio: correo y teléfono verificados antes del acceso completo.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * EL RIESGO: UN GATE OBLIGATORIO CON EL SMS CAÍDO DEJA AFUERA A TODOS
 * ═══════════════════════════════════════════════════════════════════════════
 * Por eso esto NO se prende con una sola llave, y por eso el gate acota el daño:
 *
 *   1. `PHONE_VERIFICATION_ENABLED` (+ pepper + Twilio) abre el FLUJO: dice si se
 *      PUEDE verificar. Sola no obliga a nadie. Sigue siendo el gate legal.
 *   2. `tenants.phone_required` (0181) dice si la comunidad lo EXIGE. Nace en
 *      `false`, y es lo que lee el trigger. Vive en la base y no en una env por
 *      dos razones: el trigger no puede leer env de Vercel, y apagarlo en una
 *      caída tiene que ser un `update` de un minuto y no un redeploy. Es por
 *      comunidad porque dominicanos depende de WhatsApp y Comunidad Latina no.
 *
 * Qué NO bloquea nunca, ni con todo prendido: entrar, leer, recuperar la cuenta,
 * denunciar, apelar, ni el panel de admin. Una cuenta ya verificada no se entera
 * de nada aunque el SMS esté caído. El peor caso es acotado: las cuentas sin
 * verificar quedan en modo lectura.
 *
 * ── LA APP MUESTRA, LA BASE OBLIGA ───────────────────────────────────────────
 * Quien corta de verdad es `app.enforce_phone_verified()`. Esto de acá decide qué
 * mostrar. Si difieren (por ejemplo, el `tenants` cacheado hasta 5 minutos), gana
 * la base.
 *
 * ── ANTES DE APLICAR LA MIGRACIÓN ────────────────────────────────────────────
 * `tenants.phone_required` no existe y `getTenant()` devuelve `undefined`, que
 * acá es "no se exige". Esto se puede desplegar antes que la 0181 sin efecto.
 */

export {
  PHONE_REQUIRED_CODE,
  PHONE_REQUIRED_COPY,
  PHONE_REQUIRED_TOKEN,
  isPhoneRequiredError,
} from "./error";

export type PhoneFlowProblem = "apagado" | "sin_pepper" | "sin_sms";

/** Por qué hoy no se puede verificar un teléfono, o `null` si se puede. */
export function phoneFlowProblem(): PhoneFlowProblem | null {
  if (!isPhoneVerificationEnabled) return "apagado";
  if (!isPhonePepperConfigured) return "sin_pepper";
  if ((process.env.NODE_ENV === "production" || process.env.VERCEL_ENV) && !isSmsConfigured) {
    return "sin_sms";
  }
  return null;
}

export type PhoneGateStatus =
  /** Nada que pedir: sin sesión, staff, verificada, o la comunidad no lo exige. */
  | "libre"
  /** Le falta verificar y puede hacerlo. Lee, pero no publica ni chatea. */
  | "pendiente"
  /** Le falta verificar y HOY no puede: mala configuración, hay que apagar el gate. */
  | "sin_salida";

export function decidePhoneGate(input: {
  hasSession: boolean;
  isStaff: boolean;
  phoneVerified: boolean;
  tenantRequires: boolean;
  flowProblem: PhoneFlowProblem | null;
}): PhoneGateStatus {
  if (!input.hasSession || input.isStaff) return "libre";
  if (!input.tenantRequires || input.phoneVerified) return "libre";
  return input.flowProblem ? "sin_salida" : "pendiente";
}

/** El estado para quien mira, leído de lo que el shell ya tiene: no agrega consultas. */
export function getPhoneGateStatus(input: {
  hasSession: boolean;
  isStaff: boolean;
  phoneVerified: boolean;
  tenantRequires: boolean | undefined;
}): PhoneGateStatus {
  const flowProblem = phoneFlowProblem();
  const status = decidePhoneGate({
    ...input,
    tenantRequires: input.tenantRequires === true,
    flowProblem,
  });

  if (status === "sin_salida") {
    // La base bloquea a esta persona y la app no puede darle la salida. Se
    // arregla con `update tenants set phone_required = false`.
    console.error("[telefono] la comunidad exige teléfono y el flujo no está disponible", {
      motivo: flowProblem,
    });
    if (isSentryConfigured) {
      Sentry.captureMessage("[telefono] teléfono exigido con el flujo caído", {
        level: "error",
        tags: { module: "telefono", reason: flowProblem ?? "desconocido" },
      });
    }
  }
  return status;
}
