/**
 * =============================================================================
 * CATÁLOGO DE PRECIOS — qué se cobra, cómo se llama, en qué orden se muestra
 * =============================================================================
 *
 * MÓDULO PURO a propósito: sin Supabase, sin React, sin `server-only`. Lo usa
 * el editor del panel (client component), la página que lo arma (server) y los
 * tests. Los MONTOS no viven acá — viven en la base (`tenant_prices`, 0072) con
 * respaldo en las constantes de `src/lib/stripe/index.ts` (ver `defaults.ts`).
 *
 * Este archivo es el ESPEJO EXACTO de los tres CHECK de la migración 0072
 * (`product`, `variant`, `billing_interval`). Si se separan, el panel ofrece
 * combinaciones que la base rechaza — y el rechazo llega como un 400 sin copy
 * en medio de una pantalla de precios. Por eso hay un test que compara este
 * catálogo contra el `insert` de la 0073 fila por fila.
 */

export const PRICE_PRODUCTS = [
  "presencia",
  "listing_premium",
  "boost",
  "post_promo",
  "store_membership",
] as const;
export type PriceProduct = (typeof PRICE_PRODUCTS)[number];

export const PRICE_INTERVALS = ["mensual", "anual", "unico"] as const;
export type PriceInterval = (typeof PRICE_INTERVALS)[number];

export function isPriceProduct(raw: unknown): raw is PriceProduct {
  return PRICE_PRODUCTS.includes(raw as PriceProduct);
}

export function isPriceInterval(raw: unknown): raw is PriceInterval {
  return PRICE_INTERVALS.includes(raw as PriceInterval);
}

/** Una casilla del catálogo: un precio editable y nada más. */
export interface PriceSlot {
  product: PriceProduct;
  /** El escalón dentro del producto ('basico', '14d', 'estandar'…). */
  variant: string;
  interval: PriceInterval;
  /** Cómo se nombra en la pantalla — nunca el identificador crudo. */
  label: string;
}

/**
 * Las 14 casillas, en el orden en que se muestran.
 *
 * El orden importa: primero lo recurrente (la suscripción del negocio, que es
 * el ingreso previsible), después lo puntual. Dentro de cada producto, del más
 * barato al más caro, que es como se lee una lista de precios.
 */
export const PRICE_SLOTS: readonly PriceSlot[] = [
  { product: "presencia", variant: "basico", interval: "mensual", label: "Básico · por mes" },
  { product: "presencia", variant: "basico", interval: "anual", label: "Básico · por año" },
  { product: "presencia", variant: "destacado", interval: "mensual", label: "Prioridad · por mes" },
  { product: "presencia", variant: "destacado", interval: "anual", label: "Prioridad · por año" },
  { product: "presencia", variant: "pro", interval: "mensual", label: "Pro · por mes" },
  { product: "presencia", variant: "pro", interval: "anual", label: "Pro · por año" },

  { product: "boost", variant: "7d", interval: "unico", label: "7 días" },
  { product: "boost", variant: "14d", interval: "unico", label: "14 días" },
  { product: "boost", variant: "30d", interval: "unico", label: "30 días" },

  { product: "post_promo", variant: "7d", interval: "unico", label: "7 días" },
  { product: "post_promo", variant: "14d", interval: "unico", label: "14 días" },
  { product: "post_promo", variant: "30d", interval: "unico", label: "30 días" },

  {
    product: "store_membership",
    variant: "estandar",
    interval: "mensual",
    label: "Membresía · por mes",
  },
  {
    product: "listing_premium",
    variant: "estandar",
    interval: "mensual",
    label: "Publicación premium · por mes",
  },
] as const;

/**
 * Cómo se presenta cada producto en el panel.
 *
 * `blurb` explica QUÉ compra la persona, no qué hace el sistema. Quien fija un
 * precio necesita saber qué está vendiendo; "post_promo" no se lo dice.
 */
export const PRODUCT_COPY: Record<PriceProduct, { label: string; blurb: string }> = {
  presencia: {
    label: "Presencia Verificada",
    blurb:
      "La suscripción del negocio en el directorio. El precio anual son diez mensualidades: dos meses gratis.",
  },
  boost: {
    label: "Impulso de un aviso",
    blurb: "Pago único. Pone un aviso al frente de su zona por unos días, marcado como publicidad.",
  },
  post_promo: {
    label: "Campaña de una publicación",
    blurb:
      "Pago único. Lleva una publicación al feed de toda la comunidad, marcada como publicidad.",
  },
  store_membership: {
    label: "Membresía de tienda",
    blurb: "Mensual. Mantiene la tienda visible en el marketplace. Sin comisión por venta.",
  },
  listing_premium: {
    label: "Publicación premium",
    blurb: "Mensual. Sube una publicación gratuita a premium: más fotos, video largo y botones.",
  },
};

/** Orden en que se agrupan los productos en la pantalla. */
export const PRODUCT_ORDER: readonly PriceProduct[] = [
  "presencia",
  "boost",
  "post_promo",
  "store_membership",
  "listing_premium",
];

/** Clave estable de una casilla. Es la misma tripleta del UNIQUE de 0072. */
export function slotKey(slot: {
  product: string;
  variant: string;
  interval: string;
}): string {
  return `${slot.product}:${slot.variant}:${slot.interval}`;
}

// ---------------------------------------------------------------------------
// Resolución: fila de la base sobre constante del código
// ---------------------------------------------------------------------------

/** Un precio ya resuelto, listo para cobrar o para mostrar. */
export interface ResolvedPrice extends PriceSlot {
  amountCents: number;
  currency: string;
  /**
   * De dónde salió el número. Lo mira la pantalla para decirlo en voz alta:
   * un precio "por defecto" no es lo mismo que uno que alguien decidió, y
   * confundirlos es cómo se termina cobrando algo que nadie aprobó.
   */
  source: "tenant" | "fallback";
  /** id de la fila de `tenant_prices`, o null si rige la constante. */
  id: string | null;
  updatedAt: string | null;
}

/** Fila cruda de `tenant_prices`, tal como la devuelve el select. */
export interface TenantPriceRow {
  id: string;
  product: string;
  variant: string;
  billing_interval: string;
  amount_cents: number;
  currency: string;
  active: boolean;
  updated_at: string | null;
}

/**
 * Superpone lo que hay en la base sobre las constantes del código.
 *
 * FUNCIÓN PURA para poder testearla sin base. La regla, en una línea: una
 * casilla usa la fila SÓLO si existe, está activa y trae un entero de centavos
 * sano. En cualquier otro caso rige la constante — nunca hay un precio vacío,
 * que es la diferencia entre "el Checkout cobra lo de siempre" y "el Checkout
 * explota en la cara de alguien que quería pagar".
 *
 * Una fila con `amount_cents` no entero o negativa se DESCARTA en vez de
 * arrastrarse: la base ya lo impide con un CHECK, pero este módulo también lee
 * datos que podrían venir de un dump viejo o de una migración a medio aplicar.
 */
export function resolvePrices(
  rows: readonly TenantPriceRow[],
  fallback: ReadonlyMap<string, { amountCents: number; currency: string }>,
): ResolvedPrice[] {
  const byKey = new Map<string, TenantPriceRow>();
  for (const row of rows) {
    if (!row.active) continue;
    if (!Number.isSafeInteger(row.amount_cents) || row.amount_cents < 0) continue;
    if (typeof row.currency !== "string" || !/^[A-Z]{3}$/.test(row.currency)) continue;
    byKey.set(
      slotKey({ product: row.product, variant: row.variant, interval: row.billing_interval }),
      row,
    );
  }

  return PRICE_SLOTS.map((slot) => {
    const key = slotKey(slot);
    const row = byKey.get(key);
    const base = fallback.get(key);

    if (row) {
      return {
        ...slot,
        amountCents: row.amount_cents,
        currency: row.currency,
        source: "tenant" as const,
        id: row.id,
        updatedAt: row.updated_at,
      };
    }

    return {
      ...slot,
      // `base` siempre existe: `defaults.ts` cubre las 14 casillas y hay un test
      // que lo prueba. El `?? 0` es la red por si alguien suma una casilla acá
      // y se olvida del default — y en ese caso el cero es visible y ruidoso,
      // no un cobro silencioso.
      amountCents: base?.amountCents ?? 0,
      currency: base?.currency ?? "USD",
      source: "fallback" as const,
      id: null,
      updatedAt: null,
    };
  });
}

/** Busca un precio ya resuelto. Devuelve `null` si la casilla no existe. */
export function findPrice(
  prices: readonly ResolvedPrice[],
  product: PriceProduct,
  variant: string,
  interval: PriceInterval,
): ResolvedPrice | null {
  const key = slotKey({ product, variant, interval });
  return prices.find((price) => slotKey(price) === key) ?? null;
}
