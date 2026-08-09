/**
 * Barril del módulo PRECIOS.
 *
 * Exporta SÓLO lo puro (`catalog` y `money`), que es lo que pueden importar
 * tanto un Server Component como un client component. `defaults.ts` y `read.ts`
 * son "server-only" y se importan por su ruta directa a propósito: si entraran
 * acá, un editor de precios en el navegador arrastraría el cliente de Stripe al
 * bundle — o directamente rompería el build. Mismo criterio que el barril de
 * `src/lib/monetization`.
 */

export {
  PRICE_INTERVALS,
  PRICE_PRODUCTS,
  PRICE_SLOTS,
  PRODUCT_COPY,
  PRODUCT_ORDER,
  findPrice,
  isPriceInterval,
  isPriceProduct,
  resolvePrices,
  slotKey,
  type PriceInterval,
  type PriceProduct,
  type PriceSlot,
  type ResolvedPrice,
  type TenantPriceRow,
} from "./catalog";

export {
  AMOUNT_ERROR_COPY,
  MAX_AMOUNT_CENTS,
  centsToInput,
  formatCents,
  normalizeCurrency,
  parseAmountToCents,
  type AmountParseError,
  type AmountParseResult,
} from "./money";
