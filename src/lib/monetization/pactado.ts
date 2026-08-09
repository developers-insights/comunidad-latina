import "server-only";

import type Stripe from "stripe";

/**
 * =============================================================================
 * LO PACTADO EN EL CHECKOUT — el precio contra el que se verifica un cobro
 * =============================================================================
 *
 * Vive acá y no dentro de un handler porque hay DOS productos que necesitan la
 * misma regla (el premium de una publicación y Presencia Verificada) y la
 * tercera copia es siempre la que se olvida de arreglar. `metadataString` está
 * en el mismo archivo por lo mismo: `pactadoFromMetadata` lo necesita, y
 * tenerlo duplicado en cada handler era cómo empezaba la divergencia.
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ LA METADATA Y NO `tenant_prices`
 *
 * Las actions que abren el Checkout escriben en la metadata de la Session el
 * MISMO número que leyeron de `tenant_prices` (0072) para armar el
 * `unit_amount` — o sea, exactamente lo que la persona vio en pantalla. Lo
 * escribimos nosotros y viene firmado por Stripe, así que es la única fuente que
 * no se desfasa: si alguien edita el precio de la comunidad entre que se abre el
 * Checkout y que llega el evento, volver a leer la tabla acá rechazaría un cobro
 * legítimo.
 *
 * POR QUÉ NO HAY RESPALDO A UNA CONSTANTE DEL CÓDIGO
 * Ese respaldo ERA el bug del premium: con una comunidad cobrando USD 15, el
 * Checkout cobraba 1500, el webhook esperaba la constante 900 y el premium no se
 * concedía nunca. Y al revés —conceder igual cuando no hay precio legible— sería
 * peor: un Checkout manipulado pagaría un centavo. Sin precio pactado no se
 * concede, y el log de quien llama deja el rastro para reconciliar a mano.
 * -----------------------------------------------------------------------------
 */

/** El precio que se le mostró a la persona al abrir ESA Session. */
export interface PactadoPrice {
  cents: number;
  /** ISO 4217 en minúsculas, que es como Stripe y `tenant_prices` la guardan. */
  currency: string;
}

/** Un valor de metadata que existe y no es la cadena vacía, o `null`. */
export function metadataString(
  metadata: Stripe.Metadata | null | undefined,
  key: string,
): string | null {
  const value = metadata?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Lee de la metadata de la Session el precio que se pactó, o `null` si no está. */
export function pactadoFromMetadata(
  metadata: Stripe.Metadata | null | undefined,
): PactadoPrice | null {
  const rawCents = metadataString(metadata, "price_cents");
  const rawCurrency = metadataString(metadata, "price_currency");
  if (!rawCents || !rawCurrency) return null;

  const cents = Number.parseInt(rawCents, 10);
  // `> 0` y no `>= 0`: nada que pase por un Checkout es gratis, y un 0 acá sería
  // justamente el cobro vacío que estas verificaciones existen para frenar.
  if (!Number.isSafeInteger(cents) || cents <= 0) return null;
  if (!/^[A-Za-z]{3}$/.test(rawCurrency)) return null;

  return { cents, currency: rawCurrency.toLowerCase() };
}

/**
 * Lo pactado según la FILA que la app escribió al abrir el Checkout.
 *
 * Es la variante de `pactadoFromMetadata` para los dos productos ONE-TIME
 * (impulso de aviso y campaña de post): esos SÍ dejan fila propia antes de
 * mandar a la persona a Stripe —`boosts` / `post_promotions`, con
 * `amount_cents` y `currency` escritos de la misma lectura de `tenant_prices`
 * que arma el `unit_amount`—, y el webhook además exige que la Session del
 * evento sea EXACTAMENTE la vinculada a esa fila. Con ese vínculo verificado, la
 * fila es tan fiel a lo que la persona vio como la metadata.
 *
 * Existe para que la NORMALIZACIÓN de la moneda no se escriba una cuarta vez:
 * `boosts.currency` tiene default 'usd' minúscula (0016) pero `tenant_prices`
 * la guarda en MAYÚSCULAS (0072), así que los dos lados se bajan a minúsculas
 * antes de compararse. Que el case decida si se entrega lo comprado sería
 * absurdo.
 */
export function pactadoFromRow(row: {
  amount_cents: number | null;
  currency: string | null;
}): PactadoPrice | null {
  const { amount_cents: cents, currency } = row;
  if (typeof cents !== "number" || !Number.isSafeInteger(cents) || cents <= 0) return null;
  if (typeof currency !== "string" || !/^[A-Za-z]{3}$/.test(currency)) return null;
  return { cents, currency: currency.toLowerCase() };
}

/**
 * Qué se cobró y qué decía la metadata, en una línea para el log de rechazo.
 *
 * No es adorno: sin esto, reconciliar un cobro que no se concedió obliga a
 * abrir el Dashboard de Stripe a ciegas a buscar cuál de todas las sessions
 * fue. Con esto, el log solo alcanza para decidir si va refund o va la mano.
 */
export function diagnosticoDeCobro(session: Stripe.Checkout.Session): string {
  return (
    `cobrado=${session.amount_total ?? "null"} ${session.currency ?? "?"}` +
    ` · metadata price_cents="${session.metadata?.price_cents ?? ""}"` +
    ` price_currency="${session.metadata?.price_currency ?? ""}"`
  );
}

/**
 * Compara lo cobrado contra lo pactado. Devuelve `null` si coincide, o el motivo
 * del rechazo listo para el log si no.
 *
 * LA MONEDA SE COMPARA SIEMPRE. Comparar centavos entre monedas distintas es una
 * comparación sin sentido: 1500 ARS y 1500 USD dan el mismo entero y no son el
 * mismo cobro. Si `amount_total`/`currency` no vienen (Sessions sin monto), no
 * hay nada que comparar y ese campo no rechaza por sí solo.
 */
export function motivoDeDiscrepancia(
  session: Stripe.Checkout.Session,
  pactado: PactadoPrice,
): string | null {
  if (typeof session.amount_total === "number" && session.amount_total !== pactado.cents) {
    return `cobró ${session.amount_total} ≠ pactado ${pactado.cents}`;
  }
  const cobrada =
    typeof session.currency === "string" ? session.currency.toLowerCase() : null;
  if (cobrada && cobrada !== pactado.currency) {
    return `cobró en ${cobrada} ≠ pactado ${pactado.currency}`;
  }
  return null;
}
