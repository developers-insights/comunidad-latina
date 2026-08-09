/**
 * =============================================================================
 * DINERO — parseo y formato de montos, en centavos enteros
 * =============================================================================
 *
 * MÓDULO PURO. Es el único lugar donde un texto tipeado por una persona se
 * convierte en el número que después se le cobra a alguien.
 *
 * POR QUÉ NO SE USA `parseFloat` NI `Number()`
 *   `Math.round(19.99 * 100)` da 1999 por suerte, pero `Math.round(1.005 * 100)`
 *   da 100 y no 101: el flotante 1.005 en realidad es 1.00499999999999989. En un
 *   editor de precios ese redondeo no es un decimal perdido, es un centavo que
 *   alguien cobra o deja de cobrar cada mes. Acá el texto se parte en parte
 *   entera y decimales COMO STRING y se arma el entero con aritmética de
 *   enteros. Nunca hay un flotante en el camino.
 *
 * QUÉ SE ACEPTA
 *   "19"      → 1900        "19.9"   → 1990
 *   "19,99"   → 1999        "0"      → 0        (gratis es un precio válido)
 *   "1.234,56"→ rechazado   "19.999" → rechazado (tres decimales no son plata)
 *   "-5"      → rechazado   ""       → rechazado
 *
 * Los separadores de miles se RECHAZAN en vez de interpretarse. "1.234" es mil
 * doscientos treinta y cuatro en español y uno coma doscientos treinta y cuatro
 * en inglés — adivinar cuál quiso decir quien tipeó es exactamente el tipo de
 * suposición que no corresponde hacer con el precio de otro.
 */

/** Tope de la base (0072): USD 1.000.000 en centavos. */
export const MAX_AMOUNT_CENTS = 100_000_000;

export type AmountParseError =
  | "vacio"
  | "formato"
  | "negativo"
  | "demasiados_decimales"
  | "demasiado_grande";

export type AmountParseResult =
  | { ok: true; cents: number }
  | { ok: false; reason: AmountParseError };

/** Un monto simple: dígitos, opcionalmente un separador y hasta 2 decimales. */
const AMOUNT_RE = /^(\d+)(?:[.,](\d+))?$/;

/**
 * Convierte lo que se tipeó en centavos enteros.
 *
 * El símbolo de moneda y los espacios se limpian antes: alguien que pega
 * "USD 19" o "$19" quiso decir 19, y hacerlo fallar por eso sería pedantería.
 * Lo que NO se limpia son los separadores de miles — ver la cabecera.
 */
export function parseAmountToCents(raw: string): AmountParseResult {
  const cleaned = raw
    .replace(/[\s ]/g, "")
    .replace(/^[$€]/, "")
    .replace(/^[A-Za-z]{3}/, "")
    .trim();

  if (cleaned.length === 0) return { ok: false, reason: "vacio" };
  if (cleaned.startsWith("-")) return { ok: false, reason: "negativo" };

  const match = AMOUNT_RE.exec(cleaned);
  if (!match) return { ok: false, reason: "formato" };

  const [, whole, decimals = ""] = match;
  if (decimals.length > 2) return { ok: false, reason: "demasiados_decimales" };

  // Aritmética de enteros de punta a punta: la parte entera se multiplica por
  // 100 y los decimales se completan a dos dígitos ("9" → "90"). Ni un flotante.
  const wholeCents = Number(whole) * 100;
  const fractionCents = Number(decimals.padEnd(2, "0") || "0");
  const cents = wholeCents + fractionCents;

  if (!Number.isSafeInteger(cents)) return { ok: false, reason: "demasiado_grande" };
  if (cents > MAX_AMOUNT_CENTS) return { ok: false, reason: "demasiado_grande" };

  return { ok: true, cents };
}

/**
 * Centavos → el texto que se muestra en el input, para poder volver a editarlo.
 *
 * Siempre con dos decimales y con punto: es lo que `parseAmountToCents` vuelve
 * a leer sin ambigüedad. El formato bonito con símbolo de moneda es otra
 * función (`formatCents`) porque un input y una etiqueta no quieren lo mismo.
 */
export function centsToInput(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) return "";
  const whole = Math.trunc(cents / 100);
  const rest = cents % 100;
  return `${whole}.${String(rest).padStart(2, "0")}`;
}

/**
 * Centavos → texto para leer ("USD 19" / "USD 19,99").
 *
 * Los centavos se omiten cuando son cero: un precio de USD 19 se escribe 19, no
 * 19,00. Es lo que ya hace `formatMoney` en el resto de la app, y este módulo
 * no inventa un segundo dialecto para los mismos números.
 */
export function formatCents(cents: number, currency: string, locale = "es-US"): string {
  if (!Number.isFinite(cents)) return "";
  const amount = cents / 100;
  const isWhole = cents % 100 === 0;
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: isWhole ? 0 : 2,
      maximumFractionDigits: isWhole ? 0 : 2,
    }).format(amount);
  } catch {
    // Una moneda que Intl no conoce no puede tumbar una pantalla de precios.
    return `${currency} ${isWhole ? String(amount) : amount.toFixed(2)}`;
  }
}

/** ISO 4217: tres letras. La base exige lo mismo (CHECK de 0072). */
export function normalizeCurrency(raw: string): string | null {
  const upper = raw.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(upper) ? upper : null;
}

/** Mensajes de rechazo — cálidos, específicos y sin jerga. */
export const AMOUNT_ERROR_COPY: Record<AmountParseError, string> = {
  vacio: "Escribí un monto.",
  formato: "Usá solo números y, si hace falta, una coma para los centavos. Por ejemplo: 19,99.",
  negativo: "El monto no puede ser negativo. Si querés que sea gratis, poné 0.",
  demasiados_decimales: "Como mucho dos decimales — no existe medio centavo.",
  demasiado_grande: "Ese monto es demasiado alto. Revisá si sobra un cero.",
};
