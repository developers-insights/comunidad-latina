import type { BoostScope } from "./scope";

/**
 * =============================================================================
 * EL PRECIO DEL IMPULSO = DURACIÓN + ALCANCE
 * =============================================================================
 *
 * MÓDULO PURO. Existe por una sola razón: que el número que la pantalla MUESTRA
 * y el número que el Checkout COBRA salgan de la misma función. Antes del
 * alcance eso era trivial —había un solo precio— y ahora son dos filas de
 * `tenant_prices` que hay que sumar. Dos sumas escritas en dos archivos es cómo
 * se termina cobrando algo distinto de lo que alguien vio.
 *
 * POR QUÉ RECARGO Y NO NUEVE PRECIOS SUELTOS
 *   Nueve variantes ('7d_local', '7d_nacional', …) habrían dejado huérfanas las
 *   filas de duración que las comunidades YA tienen configuradas: la clave que
 *   busca el Checkout habría cambiado de nombre y el precio configurado se
 *   habría caído a la constante del código, en silencio. Ver el bloque 4 de la
 *   migración 0092.
 */

/** Un monto ya resuelto, en la forma mínima que necesita esta suma. */
export interface Money {
  amountCents: number;
  currency: string;
}

export interface BoostTotal {
  /** Lo que se cobra: duración + recargo por alcance. */
  amountCents: number;
  currency: string;
  /** Cuánto de ese total es el recargo del alcance. Se muestra desglosado. */
  surchargeCents: number;
  /**
   * `true` cuando el recargo se ignoró porque venía en otra moneda que la
   * duración. Es un error de configuración del panel, no del comprador: quien
   * lo lee (la pantalla y la acción de cobro) lo REGISTRA, y mientras tanto se
   * cobra sólo la duración. Nunca se convierte de moneda al vuelo ni se cobra
   * un total mezclado — las dos cosas serían inventar un número.
   */
  currencyMismatch: boolean;
}

/**
 * Suma el recargo del alcance al precio de la duración.
 *
 * REGLAS, completas:
 *   1. Sin recargo configurado (`null`) el total es la duración. La ausencia de
 *      fila ya significa "la constante del código" un escalón más arriba
 *      (`resolvePrices`), así que llegar acá con `null` es que la casilla no
 *      existe — y una casilla que no existe no cobra.
 *   2. Recargo en otra moneda ⇒ se ignora y se marca. Ver `currencyMismatch`.
 *   3. Un recargo negativo o no entero se descarta: la base lo impide con un
 *      CHECK, pero este módulo también corre en el navegador con props que
 *      cruzaron un borde.
 *
 * Nunca lanza. Un precio que revienta deja a alguien sin poder pagar.
 */
export function combineBoostPrice(duration: Money, surcharge: Money | null): BoostTotal {
  const base = Number.isSafeInteger(duration.amountCents) && duration.amountCents >= 0
    ? duration.amountCents
    : 0;
  const currency = duration.currency;

  if (!surcharge) {
    return { amountCents: base, currency, surchargeCents: 0, currencyMismatch: false };
  }

  if (surcharge.currency.toUpperCase() !== currency.toUpperCase()) {
    return { amountCents: base, currency, surchargeCents: 0, currencyMismatch: true };
  }

  const extra =
    Number.isSafeInteger(surcharge.amountCents) && surcharge.amountCents >= 0
      ? surcharge.amountCents
      : 0;

  return {
    amountCents: base + extra,
    currency,
    surchargeCents: extra,
    currencyMismatch: false,
  };
}

/**
 * Los recargos de los tres alcances, tal como los pasa el servidor a la
 * pantalla. `undefined` en una clave significa "esa casilla no está
 * configurada" y `combineBoostPrice` la trata como sin recargo.
 */
export type BoostScopeSurcharges = Partial<Record<BoostScope, Money>>;
