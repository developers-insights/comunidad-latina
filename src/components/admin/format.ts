import { DEFAULT_LOCALE, DEFAULT_TIME_ZONE } from "@/lib/utils";

/**
 * El panel admin NO tiene zona horaria propia: usa la de la comunidad, que vive
 * en `@/lib/utils` junto al locale y la moneda.
 *
 * Antes esta constante tenía su propio valor literal acá. Duraba lo que dura
 * cualquier constante duplicada: el `formatDate` global —el que usan las ~25
 * pantallas del producto— se había quedado sin fijar la zona, así que el mismo
 * instante salía distinto en el panel y en el resto de la app. Se mantiene el
 * NOMBRE porque el panel lo usa en su test, pero el VALOR ya no se decide acá.
 */
export const ADMIN_TIME_ZONE = DEFAULT_TIME_ZONE;

/** "31 jul, 10:00 PM" — para sellos de tiempo de items de moderación. */
export function formatAdminDateTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat(DEFAULT_LOCALE, {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: ADMIN_TIME_ZONE,
    }).format(new Date(iso));
  } catch {
    return "";
  }
}

/**
 * "31 jul 2026" — formato SIN hora, pero espera un instante completo
 * (`timestamptz`), no un `"YYYY-MM-DD"`. Con una fecha pelada el parser la lee
 * como medianoche UTC y esta zona le resta un día. Si algún día hay que
 * formatear una fecha sin hora, usá `formatDate` de `@/lib/utils`, que tiene la
 * guarda `DATE_ONLY` justamente para eso.
 */
export function formatAdminDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat(DEFAULT_LOCALE, {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: ADMIN_TIME_ZONE,
    }).format(new Date(iso));
  } catch {
    return "";
  }
}
