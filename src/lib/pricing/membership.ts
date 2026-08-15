/**
 * =============================================================================
 * MEMBRESÍA DE TIENDA — el PRECIO, y nada más
 * =============================================================================
 *
 * POR QUÉ ESTAS DOS CONSTANTES VIVEN ACÁ Y NO EN `components/` (auditoría
 * 2026-08-13)
 * ---------------------------------------------------------------------------
 * Vivían en `src/components/marketplace/membership.ts`, junto a las etiquetas y
 * los tonos del badge de estado, y `src/lib/pricing/defaults.ts` las importaba
 * DESDE AHÍ. Eso es una inversión de capas con consecuencia real: `defaults.ts`
 * es el mapa de precios de RESPALDO —lo que rige mientras un tenant no tiene
 * fila en `tenant_prices` (migración 0072)— y `components/` es, por el contrato
 * de `docs/ARQUITECTURA.md` §2, propiedad del agente de DISEÑO. O sea que un
 * cambio "de UI" en un archivo de componentes movía un precio de cobro sin que
 * nadie lo leyera como un cambio de precio.
 *
 * Acá el precio queda del lado del dinero. `components/marketplace/membership.ts`
 * los re-exporta para que nada de lo que ya los importaba de ahí se rompa, pero
 * la definición —lo que hay que editar para cambiar cuánto se cobra— es esta.
 *
 * MÓDULO PURO, y tiene que seguir siéndolo: lo importa `defaults.ts`
 * (`server-only`) y también la cadena de componentes del marketplace, que llega
 * a client components. Nada de `server-only` ni de `@/lib/stripe` acá adentro.
 */

/**
 * USD 10,00 al mes (spec §7).
 *
 * Es el RESPALDO, no la última palabra: si la fila de `store_memberships` trae
 * `price_cents`, manda la fila — alguien pudo haber quedado con un precio
 * anterior y no se le cambia por debajo. Lo mismo del lado del catálogo: si el
 * tenant tiene su casilla en `tenant_prices`, gana esa.
 */
export const MEMBERSHIP_PRICE_CENTS = 1_000;

/**
 * En minúsculas porque es lo que espera la API de Stripe (`currency: "usd"`).
 * Quien la muestre en pantalla la pasa por `toUpperCase()`.
 */
export const MEMBERSHIP_CURRENCY = "usd";
