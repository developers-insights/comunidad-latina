import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Combina clases Tailwind resolviendo conflictos (cva + clsx + tailwind-merge). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Español con convenciones de EE. UU. — el grueso de la diáspora objetivo. */
export const DEFAULT_LOCALE = "es-US";
export const DEFAULT_CURRENCY = "USD";

export interface FormatMoneyOptions {
  locale?: string;
  currency?: string;
  /** Mostrar centavos siempre. Por default se omiten si el monto es entero ($1,200 y no $1,200.00). */
  showCents?: boolean;
}

export function formatMoney(amount: number, options: FormatMoneyOptions = {}): string {
  const { locale = DEFAULT_LOCALE, currency = DEFAULT_CURRENCY, showCents } = options;
  const wholeAmount = Number.isInteger(amount) && !showCents;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: wholeAmount ? 0 : 2,
    maximumFractionDigits: wholeAmount ? 0 : 2,
  }).format(amount);
}

export interface FormatDateOptions {
  locale?: string;
  /** short: 5/3/26 · medium: 5 mar 2026 · long: 5 de marzo de 2026 */
  style?: "short" | "medium" | "long";
  withTime?: boolean;
}

export function formatDate(date: Date | string | number, options: FormatDateOptions = {}): string {
  const { locale = DEFAULT_LOCALE, style = "medium", withTime = false } = options;
  const value = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(value.getTime())) return "";
  return new Intl.DateTimeFormat(locale, {
    dateStyle: style,
    ...(withTime ? { timeStyle: "short" } : {}),
  }).format(value);
}

const TIME_DIVISIONS: ReadonlyArray<{ amount: number; unit: Intl.RelativeTimeFormatUnit }> = [
  { amount: 60, unit: "second" },
  { amount: 60, unit: "minute" },
  { amount: 24, unit: "hour" },
  { amount: 7, unit: "day" },
  { amount: 4.34524, unit: "week" },
  { amount: 12, unit: "month" },
  { amount: Number.POSITIVE_INFINITY, unit: "year" },
];

/**
 * Tiempo relativo en español cálido: "recién", "hace 5 minutos", "ayer", "hace 3 semanas".
 * Determinístico si se pasa `now` (útil en tests y en RSC para evitar drift de hidratación).
 */
export function timeAgo(date: Date | string | number, now: Date = new Date(), locale = "es"): string {
  const value = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(value.getTime())) return "";

  let delta = (value.getTime() - now.getTime()) / 1000;
  if (Math.abs(delta) < 45) return "recién";

  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  for (const division of TIME_DIVISIONS) {
    if (Math.abs(delta) < division.amount) {
      return rtf.format(Math.round(delta), division.unit);
    }
    delta /= division.amount;
  }
  return rtf.format(Math.round(delta), "year");
}
