import "server-only";

import crypto from "node:crypto";

/**
 * =============================================================================
 * MUX — verificación de la firma del webhook
 * =============================================================================
 *
 * Mux firma cada entrega con HMAC-SHA256 sobre `<timestamp>.<body crudo>` y la
 * manda en el header `mux-signature`, con la forma `t=1700000000,v1=abc123…`.
 *
 * ESTA FUNCIÓN ES LA ÚNICA AUTORIZACIÓN DEL ENDPOINT. El webhook escribe con
 * service_role (bypassa RLS) y mueve el estado de publicaciones ajenas; no hay
 * sesión, no hay cookie, no hay nada más. Si esto se equivoca, cualquiera en
 * internet mueve el estado de cualquier video.
 *
 * ── POR QUÉ NO SE USA `mux.webhooks.unwrap()` DEL SDK ───────────────────────
 * El SDK trae `unwrap()` / `verifySignature()` y hacen esto mismo bien. No se
 * usan por dos razones concretas, no por gusto:
 *
 *   1. Cuelgan de una instancia del cliente, que exige `MUX_TOKEN_ID` y
 *      `MUX_TOKEN_SECRET` — credenciales de la API que la verificación no
 *      necesita. Atar "puedo verificar una firma" a "tengo claves de API" es
 *      atar dos cosas que se configuran en momentos distintos.
 *   2. Fallan LANZANDO, con mensajes en inglés y sin un código estable. Acá el
 *      motivo del rechazo se loguea y se distingue (ausente / mal formada /
 *      vencida / no coincide), que es lo que hace debuggeable un webhook que
 *      "no anda" a las tres de la mañana.
 *
 * El algoritmo es el documentado por Mux y está cubierto por tests con vectores
 * calculados a mano (`webhook.test.ts`).
 */

/**
 * Tolerancia de reloj: 5 minutos, el mismo número que usan Mux y Stripe.
 *
 * Es una defensa anti-replay, no un chequeo de puntualidad: sin ella, una firma
 * válida capturada una vez sirve para siempre. Se compara en VALOR ABSOLUTO —
 * un timestamp muy en el futuro es tan sospechoso como uno muy viejo, y sólo
 * mirar el pasado deja pasar una firma fabricada con reloj adelantado para que
 * dure meses.
 */
export const MUX_SIGNATURE_TOLERANCE_MS = 5 * 60 * 1000;

/** Por qué se rechazó una firma. Se loguea; nunca se le muestra a nadie. */
export type MuxSignatureFailure =
  | "sin_secreto"
  | "sin_firma"
  | "firma_malformada"
  | "firma_vencida"
  | "firma_invalida";

export type MuxSignatureResult =
  | { ok: true; timestampMs: number }
  | { ok: false; reason: MuxSignatureFailure };

/** 64 caracteres hex = los 32 bytes de un HMAC-SHA256. Ni uno más ni uno menos. */
const HEX_SHA256 = /^[0-9a-f]{64}$/i;

/**
 * Verifica la firma de una entrega de Mux.
 *
 * @param rawBody   El body TAL CUAL llegó (`await request.text()`). Si se parsea
 *                  y se vuelve a serializar antes, la firma no cierra: cambia un
 *                  espacio, el orden de una clave, y el HMAC ya es otro.
 * @param signature El header `mux-signature`.
 * @param secret    `MUX_WEBHOOK_SECRET`.
 */
export function verifyMuxSignature(
  rawBody: string,
  signature: string | null | undefined,
  secret: string | undefined,
  { nowMs = Date.now() }: { nowMs?: number } = {},
): MuxSignatureResult {
  // Fail-closed: sin secreto no se puede verificar NADA, y "no puedo verificar"
  // jamás puede resolverse como "entonces lo acepto".
  if (!secret) return { ok: false, reason: "sin_secreto" };
  if (!signature) return { ok: false, reason: "sin_firma" };

  // `t=...,v1=...`. Puede venir más de un `v1` durante una rotación de secreto:
  // Mux firma con el viejo y con el nuevo, y alcanza con que UNO cierre.
  let timestampSeconds: number | null = null;
  const firmas: string[] = [];
  for (const parte of signature.split(",")) {
    const separador = parte.indexOf("=");
    if (separador === -1) continue;
    const clave = parte.slice(0, separador).trim();
    const valor = parte.slice(separador + 1).trim();
    if (clave === "t" && timestampSeconds === null) {
      // `Number("")` es 0 y `Number("12abc")` es NaN: se exige dígitos y nada más.
      timestampSeconds = /^\d+$/.test(valor) ? Number(valor) : Number.NaN;
    } else if (clave === "v1") {
      firmas.push(valor);
    }
  }

  if (timestampSeconds === null || !Number.isFinite(timestampSeconds) || firmas.length === 0) {
    return { ok: false, reason: "firma_malformada" };
  }

  const timestampMs = timestampSeconds * 1000;
  if (Math.abs(nowMs - timestampMs) > MUX_SIGNATURE_TOLERANCE_MS) {
    return { ok: false, reason: "firma_vencida" };
  }

  const esperada = crypto
    .createHmac("sha256", secret)
    .update(`${timestampSeconds}.${rawBody}`)
    .digest();

  const coincide = firmas.some((candidata) => {
    /**
     * El chequeo de formato NO es cosmético: `crypto.timingSafeEqual` LANZA
     * `RangeError` si los buffers miden distinto, y `Buffer.from(x, "hex")`
     * trunca en silencio ante un carácter no-hex. Sin este filtro, un
     * `v1=chau` convierte un rechazo prolijo en un 500 con stack trace — que es
     * un canal de información gratis para quien esté probando el endpoint.
     */
    if (!HEX_SHA256.test(candidata)) return false;
    return crypto.timingSafeEqual(esperada, Buffer.from(candidata, "hex"));
  });

  if (!coincide) return { ok: false, reason: "firma_invalida" };
  return { ok: true, timestampMs };
}
