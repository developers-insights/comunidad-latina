/**
 * NOTIFICACIONES — resolución de preferencias (`notification_prefs`, 0045).
 *
 * REGLA CENTRAL: **la ausencia de fila significa TODO PRENDIDO.** Nadie nace
 * silenciado y no se siembran 13 filas por registro. Todo lo de acá parte de ese
 * default y sólo lo apaga cuando hay una fila que lo dice.
 *
 * Pura y sin I/O: recibe las filas ya leídas. Así el emisor y la pantalla de
 * ajustes deciden con el MISMO código, y el test no necesita base.
 */

import {
  isAlwaysOnCategory,
  isImportant,
  type NotificationCategory,
  type NotificationPriority,
} from "./categories";

export const NOTIFICATION_FREQUENCIES = ["all", "important", "digest", "off"] as const;

export type NotificationFrequency = (typeof NOTIFICATION_FREQUENCIES)[number];

export function isNotificationFrequency(value: unknown): value is NotificationFrequency {
  return (
    typeof value === "string" &&
    (NOTIFICATION_FREQUENCIES as readonly string[]).includes(value)
  );
}

export type NotificationPref = {
  inApp: boolean;
  email: boolean;
  /** Se guarda, todavía no entrega: faltan claves VAPID (§2 fuera de alcance). */
  push: boolean;
  frequency: NotificationFrequency;
};

/** El default de la base, columna por columna. `push` arranca en false. */
export const DEFAULT_PREF: NotificationPref = {
  inApp: true,
  email: true,
  push: false,
  frequency: "all",
};

/** Forma cruda de `notification_prefs` tal como vuelve de PostgREST. */
export type NotificationPrefRow = {
  category: string;
  in_app: boolean;
  email: boolean;
  push: boolean;
  frequency: string;
};

export type PrefsByCategory = Partial<Record<NotificationCategory, NotificationPref>>;

/**
 * Filas → mapa por categoría. Una fila con `frequency` que la app no conoce
 * (columna text, no enum: una migración futura podría sumar valores) se lee
 * como `all` — ante la duda, entregar. Callar por no entender un valor es el
 * peor default posible.
 */
export function prefsFromRows(rows: readonly NotificationPrefRow[]): PrefsByCategory {
  const byCategory: PrefsByCategory = {};
  for (const row of rows) {
    byCategory[row.category as NotificationCategory] = {
      inApp: row.in_app,
      email: row.email,
      push: row.push,
      frequency: isNotificationFrequency(row.frequency) ? row.frequency : "all",
    };
  }
  return byCategory;
}

/**
 * La preferencia efectiva de una categoría.
 *
 * En seguridad / pagos / cuenta devuelve el default entero aunque exista una
 * fila: el CHECK de la base ya impide guardarlas silenciadas, pero si alguien
 * llegara a colar una (o si mañana se relaja el CHECK), la app tiene que seguir
 * entregándolas. La garantía se sostiene sola en los dos lados.
 */
export function resolvePref(
  prefs: PrefsByCategory,
  category: NotificationCategory,
): NotificationPref {
  if (isAlwaysOnCategory(category)) return DEFAULT_PREF;
  return prefs[category] ?? DEFAULT_PREF;
}

/**
 * ¿Se crea la notificación en la bandeja?
 *
 * - `off`       → no.
 * - `important` → sólo high y critical.
 * - `digest`    → SÍ. Es la frecuencia del RESUMEN POR CORREO: lo que cambia es
 *                 cuántos mails salen, no si la bandeja de la app se entera.
 *                 Tratarla como "off" dejaría a la persona sin nada mientras el
 *                 cron del resumen no exista (§2 fuera de alcance), y la
 *                 pantalla de ajustes lo dice con todas las letras.
 * - `in_app` en false → no. Es el canal, y es más fuerte que la frecuencia.
 *
 * Las categorías críticas nunca llegan acá con algo apagado: `resolvePref` les
 * devuelve el default.
 */
export function shouldDeliverInApp(
  pref: NotificationPref,
  priority: NotificationPriority,
): boolean {
  if (!pref.inApp) return false;
  if (pref.frequency === "off") return false;
  if (pref.frequency === "important") return isImportant(priority);
  return true;
}

/** Atajo para el emisor: de las filas crudas a la decisión, en un paso. */
export function shouldDeliver(
  prefs: PrefsByCategory,
  category: NotificationCategory,
  priority: NotificationPriority,
): boolean {
  return shouldDeliverInApp(resolvePref(prefs, category), priority);
}
