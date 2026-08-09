/**
 * Teléfonos en E.164 — el formato que exige el CHECK
 * `phone_verification_codes_e164_format` (`^\+[1-9]\d{7,14}$`, migración 0066).
 *
 * ── POR QUÉ NO ENTRA `libphonenumber-js` ─────────────────────────────────────
 * Sería la respuesta correcta si hubiera que validar planes de numeración de 200
 * países. Acá el 95% del público marca un número de EE.UU. de 10 dígitos y el
 * resto pega un número con el `+` adelante. La librería pesa ~145 kB y el flujo
 * está APAGADO por gate legal: meter esa dependencia hoy es cargar peso en el
 * bundle para una pantalla que nadie ve. Cuando el teléfono se encienda de
 * verdad, este módulo es un solo punto de reemplazo.
 *
 * Lo que sí hace bien: no inventa. Un número que no puede normalizar con
 * certeza vuelve como error, nunca como un `+1` puesto de prepo.
 */

export type PhoneProblem = "vacio" | "corto" | "largo" | "formato";

export interface PhoneParseOk {
  ok: true;
  /** E.164 canónico: `+` + 8 a 15 dígitos, sin separadores. */
  e164: string;
}
export interface PhoneParseError {
  ok: false;
  problem: PhoneProblem;
}
export type PhoneParseResult = PhoneParseOk | PhoneParseError;

/** El mismo patrón del CHECK de 0066. */
const E164 = /^\+[1-9]\d{7,14}$/;

/**
 * Normaliza lo que escribió la persona.
 *
 * Reglas, en orden:
 *   1. Se tiran espacios, guiones, puntos y paréntesis: `(917) 555-0142` es un
 *      número, no cuatro tokens.
 *   2. `00` inicial es el prefijo internacional de medio mundo → `+`.
 *   3. Sin `+` y con 10 dígitos → se asume EE.UU. (`+1`). Es la única
 *      suposición del módulo y es deliberada: es el país donde vive el público,
 *      y obligar a escribir `+1` cuando nadie lo marca al llamar es fricción sin
 *      contrapartida. Con 11 dígitos que arrancan en 1, lo mismo.
 *   4. Cualquier otra cosa sin `+` se rechaza. Adivinar el país de un número de
 *      9 dígitos sería inventarlo.
 */
export function parsePhone(raw: string): PhoneParseResult {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: false, problem: "vacio" };

  const cleaned = trimmed.replace(/[\s().\-–—]/g, "");
  if (!/^\+?\d+$/.test(cleaned)) return { ok: false, problem: "formato" };

  let candidate = cleaned;
  if (candidate.startsWith("00")) candidate = `+${candidate.slice(2)}`;

  if (!candidate.startsWith("+")) {
    const digits = candidate;
    if (digits.length === 10) candidate = `+1${digits}`;
    else if (digits.length === 11 && digits.startsWith("1")) candidate = `+${digits}`;
    else return { ok: false, problem: digits.length < 10 ? "corto" : "formato" };
  }

  const digitsOnly = candidate.slice(1);
  if (digitsOnly.length < 8) return { ok: false, problem: "corto" };
  if (digitsOnly.length > 15) return { ok: false, problem: "largo" };
  if (!E164.test(candidate)) return { ok: false, problem: "formato" };

  return { ok: true, e164: candidate };
}

/**
 * Cómo se muestra un número que la app ya conoce: `+1 (917) •••-•142`.
 *
 * ── ENMASCARADO SIEMPRE ──────────────────────────────────────────────────────
 * Ni siquiera al dueño se le repite el número entero en pantalla. Los últimos
 * cuatro dígitos alcanzan para que reconozca cuál es —que es lo único que
 * necesita— y un perfil abierto sobre la mesa deja de ser un teléfono anotado.
 */
export function maskPhone(e164: string): string {
  if (!E164.test(e164)) return "•••";
  const tail = e164.slice(-4);
  const head = e164.slice(0, Math.max(2, e164.length - 8));
  return `${head} ••• ${tail}`;
}
