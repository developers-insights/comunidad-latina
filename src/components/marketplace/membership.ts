import { MEMBERSHIP_CURRENCY, MEMBERSHIP_PRICE_CENTS } from "@/lib/pricing/membership";

/**
 * =============================================================================
 * MEMBRESÍA DE TIENDA — USD 10/mes (spec §7)
 * =============================================================================
 *
 * Helpers PUROS. La verdad vive en la base y este archivo no la duplica:
 *
 *  - `store_memberships` (migración 0048) guarda el estado de facturación. Sus
 *    tres policies de escritura están en `false`: la escribe SOLO el webhook de
 *    Stripe o el cron, vía service_role. El dueño puede LEER la suya.
 *  - `listings.store_active` es el espejo público que mantiene un trigger. Es
 *    lo que la app lee para decidir si una tienda se muestra — nunca un join
 *    por fila contra una tabla que la RLS le esconde al visitante.
 *
 * REGLA DEL ESPEJO (`app.mirror_store_active`, 0048): `active` y `past_due`
 * dejan la tienda PRENDIDA; `canceled` y `expired` la apagan. `past_due` no
 * apaga a propósito: un cobro que rebotó da margen para reintentar, no le baja
 * la persiana al negocio de alguien en el acto.
 *
 * SIN COMISIÓN POR VENTA: la membresía es lo único que se cobra. Comunidad
 * Latina no toca el dinero de la venta — ver `EXTERNAL_CHECKOUT_FACTS`.
 */

/** Espeja el CHECK de `store_memberships.status` (0048). */
export const MEMBERSHIP_STATUSES = ["active", "past_due", "canceled", "expired"] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

/**
 * EL PRECIO YA NO SE DEFINE ACÁ (auditoría 2026-08-13).
 *
 * `MEMBERSHIP_PRICE_CENTS` vivía en este archivo y `src/lib/pricing/defaults.ts`
 * —el mapa de precios de respaldo del Checkout— lo importaba desde `components/`.
 * Una carpeta que el contrato (`docs/ARQUITECTURA.md` §2) le da al agente de
 * DISEÑO no puede ser la fuente de un monto que se cobra: un cambio "de UI"
 * movía un precio.
 *
 * Se re-exportan para no romper a quien ya los importaba de acá (el barril
 * `./index.ts`, los tests de la membresía). Para CAMBIAR el precio hay que ir a
 * `src/lib/pricing/membership.ts`.
 */
export { MEMBERSHIP_CURRENCY, MEMBERSHIP_PRICE_CENTS };

export function parseMembershipStatus(raw: unknown): MembershipStatus | null {
  return MEMBERSHIP_STATUSES.includes(raw as MembershipStatus)
    ? (raw as MembershipStatus)
    : null;
}

/**
 * ¿Este estado mantiene la tienda visible? Espejo EXACTO de
 * `app.mirror_store_active()`. Si las dos se separan, la app le miente al dueño
 * sobre lo que la comunidad está viendo.
 */
export function statusKeepsStoreOn(status: MembershipStatus): boolean {
  return status === "active" || status === "past_due";
}

/* -------------------------------------------------------------------------- */
/* Estado que ve el dueño                                                     */
/* -------------------------------------------------------------------------- */

/**
 * `none` es un estado real y frecuente: la tienda existe desde antes de que la
 * membresía existiera. `listings.store_active` nace en `true` justamente para
 * que esas tiendas NO se apaguen — no son morosas, nunca se les cobró.
 */
export type MembershipView = MembershipStatus | "none";

export type MembershipTone = "success" | "warning" | "danger" | "neutral";

export interface MembershipPresentation {
  view: MembershipView;
  /** Etiqueta corta para el badge. */
  label: string;
  /** Frase que explica qué significa el estado, para el dueño. */
  detail: string;
  tone: MembershipTone;
  /** ¿La tienda y sus productos se están mostrando ahora mismo? */
  storeVisible: boolean;
  /** ¿Corresponde ofrecer activar/reactivar? */
  canActivate: boolean;
}

export interface MembershipRow {
  status: string;
  currentPeriodEnd: string | null;
  priceCents?: number | null;
  currency?: string | null;
}

const PRESENTATION: Record<MembershipView, Omit<MembershipPresentation, "view">> = {
  active: {
    label: "Activa",
    detail: "Tu tienda y tus productos se están mostrando en el Marketplace.",
    tone: "success",
    storeVisible: true,
    canActivate: false,
  },
  past_due: {
    label: "Pago pendiente",
    detail:
      "El último cobro no salió. Tu tienda sigue visible mientras lo reintentamos — actualizá tu tarjeta para no perder la vidriera.",
    tone: "warning",
    storeVisible: true,
    canActivate: true,
  },
  canceled: {
    label: "Cancelada",
    detail:
      "Cancelaste la membresía, así que tu tienda y tus productos ya no aparecen en el Marketplace. Podés volver cuando quieras.",
    tone: "danger",
    storeVisible: false,
    canActivate: true,
  },
  expired: {
    label: "Vencida",
    detail:
      "Se terminó el período pagado y tu tienda dejó de aparecer en el Marketplace. Reactivándola vuelve tal como estaba.",
    tone: "danger",
    storeVisible: false,
    canActivate: true,
  },
  none: {
    label: "Sin membresía",
    detail:
      "Todavía no activaste la membresía de esta tienda. Con ella tu vidriera y tus productos aparecen en el Marketplace.",
    tone: "neutral",
    storeVisible: false,
    canActivate: true,
  },
};

/**
 * Estado presentable a partir de la fila (o de su ausencia).
 *
 * `storeActive` es opcional y, cuando se pasa, MANDA sobre `storeVisible`: es
 * la columna que la comunidad realmente ve. Si el espejo y la fila difieren
 * (trigger en vuelo, cron a mitad de camino), preferimos decirle al dueño lo
 * que está pasando de verdad antes que lo que debería pasar.
 */
export function membershipPresentation(
  row: MembershipRow | null | undefined,
  storeActive?: boolean | null,
): MembershipPresentation {
  const status = row ? parseMembershipStatus(row.status) : null;
  const view: MembershipView = status ?? "none";
  const base = PRESENTATION[view];
  return {
    view,
    ...base,
    storeVisible: typeof storeActive === "boolean" ? storeActive : base.storeVisible,
  };
}

/* -------------------------------------------------------------------------- */
/* Fechas y precio                                                            */
/* -------------------------------------------------------------------------- */

const MS_PER_DAY = 86_400_000;

/** Días que faltan para el fin del período. null si no hay fecha o es ilegible. */
export function daysUntilPeriodEnd(
  currentPeriodEnd: string | Date | null | undefined,
  now: Date = new Date(),
): number | null {
  if (!currentPeriodEnd) return null;
  const end = currentPeriodEnd instanceof Date ? currentPeriodEnd : new Date(currentPeriodEnd);
  const time = end.getTime();
  if (!Number.isFinite(time)) return null;
  return Math.ceil((time - now.getTime()) / MS_PER_DAY);
}

/** USD 10,00 / mes — `tabular-nums` en la UI, como todo precio del repo. */
export function formatMembershipPrice(
  cents: number = MEMBERSHIP_PRICE_CENTS,
  currency: string = MEMBERSHIP_CURRENCY,
  locale = "es-US",
): string {
  const safeCents = Number.isFinite(cents) && cents > 0 ? cents : MEMBERSHIP_PRICE_CENTS;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: (currency || MEMBERSHIP_CURRENCY).toUpperCase(),
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(safeCents / 100);
}

/**
 * QUÉ INCLUYE la membresía. Es literalmente lo que se compra, así que se
 * escribe sin adjetivos: nada de "más ventas" ni "mayor confianza" — eso no lo
 * podemos prometer y prometerlo es lo que después genera el reclamo.
 */
export const MEMBERSHIP_INCLUDES: readonly string[] = [
  "Tu tienda con su vidriera propia en el Marketplace",
  "Catálogo de productos, sin tope de publicaciones",
  "Botón «Comprar» que lleva a tu propio checkout",
  "Tus productos aparecen en las búsquedas del Marketplace",
  "Tráfico de la comunidad hacia tu tienda",
] as const;

/**
 * LO QUE NO ES. Estas cuatro frases son la diferencia entre un modelo honesto y
 * un reclamo: se muestran en la pantalla de alta, no en la letra chica.
 */
export const MEMBERSHIP_EXCLUDES: readonly string[] = [
  "No cobramos comisión por venta — lo que vendés es tuyo",
  "El pago lo cobrás vos, en tu propio checkout",
  "Podés cancelar cuando quieras, desde acá",
  "Sin permanencia mínima ni cargo por dar de baja",
] as const;

/**
 * LO QUE COMUNIDAD LATINA NO HACE cuando alguien compra. Va donde el COMPRADOR
 * lo lee ANTES de salir del sitio, no escondido en los términos.
 *
 * Esto no es prudencia legal: es el modelo. El pago ocurre afuera, y decirlo de
 * frente es lo que evita que alguien crea que tiene una protección que no tiene.
 */
export const EXTERNAL_CHECKOUT_FACTS: readonly string[] = [
  "El pago lo cobra el negocio en su propio sitio",
  "El envío, la devolución y la garantía las maneja el negocio",
  "Comunidad Latina no participa de la compra ni puede reembolsarte",
] as const;
