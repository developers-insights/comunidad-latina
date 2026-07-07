import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Contador de CORTESÍA de preguntas para visitantes anónimos (3 por sesión)
 * vía cookie FIRMADA con HMAC-SHA256 (secreto: CRON_SECRET). El valor viaja
 * como `count.expiraEpochMs.firma` — sin firma válida el contador vuelve a 0,
 * así que manipular la cookie no regala preguntas… solo las resetea, que es
 * el mismo poder que ya tiene "borrar cookies" (u omitir el header Cookie).
 *
 * ⚠️ Esto NO es el control de abuso: es solo la UX de "te quedan N preguntas
 * de invitado". La capa DURA para anónimos vive en el route handler del
 * asistente (rate limit por IP + breaker global con lib/rate-limit, ANTES de
 * cualquier llamada paga a OpenAI); el límite de usuarios logueados va por DB.
 */

export const ANON_COOKIE = "cl-asst";
export const ANON_LIMIT = 3;
/** Ventana de la sesión anónima: 24 h (la cookie además es de sesión). */
const WINDOW_MS = 24 * 60 * 60 * 1000;

function hmacSecret(): string {
  const value = process.env.CRON_SECRET;
  if (value && value.length > 0) return value;
  // Solo posible en dev sin .env completo — jamás romper por esto (§5.6).
  console.warn(
    "[asistente] CRON_SECRET ausente — la cookie anónima usa un secreto de dev.",
  );
  return "cl-asistente-dev-only";
}

function sign(payload: string): string {
  return createHmac("sha256", hmacSecret()).update(payload).digest("hex");
}

/** Serializa el contador firmado para Set-Cookie. */
export function encodeAnonUsage(count: number): string {
  const payload = `${count}.${Date.now() + WINDOW_MS}`;
  return `${payload}.${sign(payload)}`;
}

/** Lee el contador desde la cookie. Firma inválida o vencida → 0. */
export function decodeAnonUsage(cookieValue: string | null | undefined): number {
  if (!cookieValue) return 0;
  const parts = cookieValue.split(".");
  if (parts.length !== 3) return 0;

  const [countRaw, expiresRaw, signature] = parts;
  const expected = sign(`${countRaw}.${expiresRaw}`);
  const given = Buffer.from(signature);
  const wanted = Buffer.from(expected);
  if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) return 0;

  const expiresAt = Number(expiresRaw);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return 0;

  const count = Number(countRaw);
  return Number.isInteger(count) && count >= 0 ? Math.min(count, 999) : 0;
}

/** Preguntas de invitado que le quedan a esta sesión. */
export function anonRemaining(cookieValue: string | null | undefined): number {
  return Math.max(0, ANON_LIMIT - decodeAnonUsage(cookieValue));
}

/** Header Set-Cookie completo (HttpOnly + SameSite=Lax + Secure en prod). */
export function anonUsageSetCookie(count: number): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${ANON_COOKIE}=${encodeAnonUsage(count)}; Path=/; Max-Age=86400; HttpOnly; SameSite=Lax${secure}`;
}
