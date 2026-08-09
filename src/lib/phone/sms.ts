import "server-only";

import { isSmsConfigured } from "@/lib/config/services";
import { CODE_TTL_MINUTES } from "./verification";

/**
 * El envío de SMS, detrás de una interfaz.
 *
 * ── NO HAY PROVEEDOR, Y ES A PROPÓSITO ───────────────────────────────────────
 * Cuál se usa (Twilio, Vonage, MessageBird, Amazon SNS…) es una decisión
 * COMERCIAL pendiente. Lo que sí se puede terminar hoy —y está terminado— es
 * todo lo demás: el ciclo de vida del código, el rate limit, el tope de
 * intentos, la UI y el estado en el perfil. Enchufar un proveedor es escribir
 * una implementación de `SmsSender` y devolverla desde `getSmsSender()`.
 *
 * ── EN DESARROLLO EL CÓDIGO VA AL LOG DEL SERVIDOR ───────────────────────────
 * Nunca a la respuesta HTTP, nunca a la pantalla. Un código que viaja al cliente
 * "para probar" es un código que se puede leer desde la pestaña de red, y ese
 * atajo tiene la costumbre de quedarse. Al log del SERVIDOR sólo llega quien ya
 * tiene la consola, que es quien está desarrollando.
 *
 * ── MISMO PATRÓN QUE EL RESTO (§7) ───────────────────────────────────────────
 * `isStripeConfigured`, `isResendConfigured`, `isVisionConfigured` y compañía:
 * el flag sale de env, y sin servicio la feature degrada a un estado premium en
 * vez de a un error crudo.
 */

export interface SmsMessage {
  /** Destino en E.164. */
  to: string;
  /** Texto ya armado. El proveedor no compone nada. */
  body: string;
  /** Para trazar en el log sin filtrar el número entero. */
  maskedTo: string;
}

export type SmsSendResult =
  | { ok: true }
  /** El envío falló pero el sistema está sano (número inválido, sin saldo…). */
  | { ok: false; reason: "rechazado" | "proveedor" };

export interface SmsSender {
  /** Nombre para el log. Nunca se muestra a la persona. */
  readonly name: string;
  send(message: SmsMessage): Promise<SmsSendResult>;
}

/**
 * Implementación de desarrollo: escribe el código en el log del servidor.
 *
 * Es un remitente REAL en el sentido que importa —cumple el contrato y el flujo
 * completo funciona contra ella— y a la vez es imposible de confundir con
 * producción: el nombre lo dice y el log lo grita.
 */
const devSender: SmsSender = {
  name: "log-de-desarrollo",
  async send({ body, maskedTo }) {
    console.warn(
      `[sms] SIN PROVEEDOR CONFIGURADO — el mensaje NO se envió a nadie.\n` +
        `      Para: ${maskedTo}\n` +
        `      Texto: ${body}\n` +
        `      Configurá SMS_PROVIDER_API_KEY para enviar de verdad.`,
    );
    return { ok: true };
  },
};

/**
 * El remitente vigente.
 *
 * Devuelve el de desarrollo mientras no haya proveedor. NO devuelve `null`: el
 * flujo de verificación ya está cerrado por `isPhoneVerificationEnabled` (el
 * gate legal), así que sumar acá un segundo apagado sólo lograría que en
 * desarrollo, con el gate abierto a mano, no se pudiera probar nada.
 */
export function getSmsSender(): SmsSender {
  if (!isSmsConfigured) return devSender;

  // Punto de reemplazo. Cuando haya proveedor, la implementación va acá y este
  // archivo sigue siendo el único que sabe de él.
  console.warn(
    "[sms] SMS_PROVIDER_API_KEY está configurada pero no hay implementación de proveedor. " +
      "Se sigue usando el remitente de desarrollo.",
  );
  return devSender;
}

/**
 * El texto del SMS. Corto: muchos teléfonos lo muestran recortado en la
 * notificación, y el código tiene que entrar en esa primera línea.
 *
 * Los minutos salen de `CODE_TTL_MINUTES` y no de un literal: ese número lo
 * decide el DEFAULT de `phone_verification_codes.expires_at`, y un SMS que
 * promete un vencimiento distinto del real es la clase de detalle que hace que
 * alguien tire el mensaje creyendo que todavía le sirve.
 */
export function verificationSmsBody({
  code,
  communityName,
}: {
  code: string;
  communityName: string;
}): string {
  return `${code} es tu código de ${communityName}. Vence en ${CODE_TTL_MINUTES} minutos. No se lo pases a nadie.`;
}
