import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Combina clases Tailwind resolviendo conflictos (cva + clsx + tailwind-merge). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Español con convenciones de EE. UU. — el grueso de la diáspora objetivo. */
export const DEFAULT_LOCALE = "es-US";
export const DEFAULT_CURRENCY = "USD";

/**
 * ZONA HORARIA DE LA COMUNIDAD — fuente de verdad ÚNICA de todo el repo.
 *
 * POR QUÉ TIENE QUE ESTAR FIJADA
 * ------------------------------
 * Sin `timeZone`, `Intl.DateTimeFormat` usa el reloj del runtime. El server de
 * Vercel corre en UTC y el teléfono de la persona en su zona, así que el MISMO
 * instante se formatea distinto según quién lo pinte: el server manda "1 ago
 * 2026" y el navegador de alguien en Nueva York re-renderiza "31 jul 2026".
 * Eso rompe dos cosas a la vez — un mismatch de hidratación (React #418) y una
 * fecha que le miente a la persona.
 *
 * ⚠️ SUPUESTO DE PRODUCTO, NO UNA VERDAD TÉCNICA — A CONFIRMAR
 * -----------------------------------------------------------
 * El público está repartido por varias ciudades de EE.UU. (NY, NJ, Miami,
 * Houston, Chicago, Los Ángeles), o sea VARIAS zonas horarias. Elegir una es
 * elegir a quién se le muestra la hora correcta. Va `America/New_York` porque
 * es donde está el núcleo de la comunidad y porque era la que ya había elegido
 * el panel admin — no porque sea neutral.
 *
 * Lo que esto NO rompe: las fechas quedan estables y coherentes para todos. Lo
 * que sí implica: alguien en Los Ángeles publicando 22:00 hora local ve su
 * publicación fechada al día siguiente. Si eso pesa, la salida NO es volver a
 * la zona del runtime (eso reintroduce el bug) sino guardar la zona en el
 * perfil y pasarla por `options.timeZone`, que ya está soportado abajo.
 */
export const DEFAULT_TIME_ZONE = "America/New_York";

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
  /** Zona explícita. Por default, la de la comunidad (`DEFAULT_TIME_ZONE`). */
  timeZone?: string;
}

/**
 * `2026-07-06` — una fecha SIN hora. No es un instante: es un día del
 * calendario, y el día que dice es el día que hay que mostrar.
 */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Fecha legible, SIEMPRE en la misma zona horaria (ver `DEFAULT_TIME_ZONE`).
 *
 * EL CASO QUE PARECE UN DETALLE Y NO LO ES: las fechas sin hora.
 * `new Date("2026-07-06")` se interpreta como medianoche UTC (así lo manda la
 * spec). Formatear ESO en `America/New_York` da las 20:00 del 5 de julio, o
 * sea que la fecha se muestra un día antes de la que dice el dato. Y en esta
 * app eso no es cosmético: las guías guardan `checked_at: "2026-07-06"` y la
 * línea que lo usa dice "Fuentes consultadas al …" al pie de un trámite
 * oficial. Restarle un día a esa frase es publicar un dato falso.
 *
 * Por eso una fecha sin hora se formatea en UTC —que es la única zona donde
 * vuelve a salir el mismo día que entró— y un instante completo se formatea en
 * la zona de la comunidad. Quien pasa `timeZone` explícito manda por encima de
 * las dos reglas.
 */
export function formatDate(date: Date | string | number, options: FormatDateOptions = {}): string {
  const { locale = DEFAULT_LOCALE, style = "medium", withTime = false } = options;
  const value = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(value.getTime())) return "";

  const isDateOnly = typeof date === "string" && DATE_ONLY.test(date.trim());
  const timeZone = options.timeZone ?? (isDateOnly ? "UTC" : DEFAULT_TIME_ZONE);

  return new Intl.DateTimeFormat(locale, {
    dateStyle: style,
    ...(withTime ? { timeStyle: "short" } : {}),
    timeZone,
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
