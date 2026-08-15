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
 * ES EL PISO, YA NO EL TECHO (2026-08-08)
 * ---------------------------------------
 * El público está repartido por varias ciudades de EE.UU. (NY, NJ, Miami,
 * Houston, Chicago, Los Ángeles), o sea VARIAS zonas horarias. Elegir una sola
 * era elegir a quién se le muestra la hora correcta: alguien en Los Ángeles
 * publicando a las 22:00 veía su publicación fechada AL DÍA SIGUIENTE.
 *
 * Eso ya tiene salida — la que este mismo comentario anticipaba: la zona vive en
 * `profiles.timezone` (migración 0067) y baja por `options.timeZone`. Quien
 * mira formatea en SU zona:
 *   · servidor  → `getViewerTimeZone()` (lib/time/viewer-zone.ts)
 *   · cliente   → `useViewerTimeZone()` (components/time/viewer-time-zone.tsx)
 *
 * `DEFAULT_TIME_ZONE` queda como lo que siempre debió ser: el valor para quien
 * no eligió nada y para quien mira sin cuenta. Lo que NO es salida —ni antes ni
 * ahora— es dejar el formateo sin zona: eso devuelve el reloj del runtime y
 * reintroduce el bug de hidratación.
 */
export const DEFAULT_TIME_ZONE = "America/New_York";

export interface FormatMoneyOptions {
  locale?: string;
  currency?: string;
  /** Mostrar centavos siempre. Por default se omiten si el monto es entero ($1,200 y no $1,200.00). */
  showCents?: boolean;
}

/**
 * Monto (en unidades, no centavos) → texto con símbolo de moneda.
 *
 * EL `try/catch` NO ES DEFENSIVO POR LAS DUDAS (auditoría 2026-08-13).
 * `Intl.NumberFormat` con `style: "currency"` LANZA un `RangeError` si el
 * código de moneda no es ISO 4217 válido — y la moneda no la elige este código:
 * la elige el tenant (`tenants.currency`) y viaja por la fila del aviso
 * (`listings.price_currency`, `tenant_prices.currency`). O sea que una fila con
 * "US$" en vez de "USD" no rompe un número: rompe el render entero de la
 * pantalla que lo pinta, y esta función se pinta en 7 lugares — la tabla de
 * precios del panel, las tarjetas de avisos, los paquetes de creadores.
 *
 * `formatCents` (src/lib/pricing/money.ts) ya se protegía así, con el
 * argumento escrito: «una moneda que Intl no conoce no puede tumbar una
 * pantalla de precios». Acá se REPLICA en vez de delegar por dos razones
 * concretas: `formatCents` no tiene el modo `showCents` (decide los decimales
 * mirando si el monto es redondo), y `utils.ts` lo importa medio repo —
 * incluidos client components— así que colgarle una dependencia a `lib/pricing`
 * arrastraría el módulo de precios a bundles que sólo querían `cn()`.
 *
 * El fallback es el MISMO texto que el de `formatCents` ("USD 19,99" → `USD 19`)
 * a propósito: la app no puede tener dos dialectos para el mismo número.
 */
export function formatMoney(amount: number, options: FormatMoneyOptions = {}): string {
  const { locale = DEFAULT_LOCALE, currency = DEFAULT_CURRENCY, showCents } = options;
  const wholeAmount = Number.isInteger(amount) && !showCents;
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: wholeAmount ? 0 : 2,
      maximumFractionDigits: wholeAmount ? 0 : 2,
    }).format(amount);
  } catch {
    // Moneda fuera de ISO 4217 (o locale mal formado): se muestra el código tal
    // cual y el número. Un precio sin símbolo se lee igual; una pantalla en
    // blanco, no.
    return `${currency} ${wholeAmount ? String(amount) : amount.toFixed(2)}`;
  }
}

export interface FormatDateOptions {
  locale?: string;
  /** short: 5/3/26 · medium: 5 mar 2026 · long: 5 de marzo de 2026 */
  style?: "short" | "medium" | "long";
  withTime?: boolean;
  /**
   * Zona del INSTANTE. Por default, la de la comunidad (`DEFAULT_TIME_ZONE`).
   * Se ignora para fechas sin hora (`YYYY-MM-DD`), que siempre salen en UTC —
   * ver el comentario largo de `formatDate`.
   */
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
 * la zona de quien mira (o en la de la comunidad, si no eligió ninguna).
 *
 * ⚠️ EL `timeZone` EXPLÍCITO NO PISA LA REGLA DE LAS FECHAS SIN HORA. Antes sí,
 * y con la zona por usuario (0067) eso se volvió una trampa: pasar la zona del
 * lector a un `checked_at: "2026-07-06"` le restaría un día a alguien en Los
 * Ángeles y la app publicaría un dato falso al pie de un trámite oficial. Una
 * fecha sin hora no es un instante, así que NINGUNA zona de lector le aplica —
 * no hay hora que reubicar. Quien de verdad necesita otra zona para un día
 * calendario no está formateando una fecha: está haciendo aritmética, y eso no
 * vive acá.
 */
export function formatDate(date: Date | string | number, options: FormatDateOptions = {}): string {
  const { locale = DEFAULT_LOCALE, style = "medium", withTime = false } = options;
  const value = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(value.getTime())) return "";

  const isDateOnly = typeof date === "string" && DATE_ONLY.test(date.trim());
  const timeZone = isDateOnly ? "UTC" : (options.timeZone ?? DEFAULT_TIME_ZONE);

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
