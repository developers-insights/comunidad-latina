import "server-only";

import type Stripe from "stripe";

import { getStripe } from "./index";

/**
 * =============================================================================
 * LA ÚNICA PUERTA PARA ABRIR UN CHECKOUT
 * =============================================================================
 *
 * Los seis productos que cobran por Checkout hospedado pasan por acá. No es una
 * comodidad: es el lugar donde se sostiene un invariante que ninguno de los seis
 * puede sostener solo.
 *
 * -----------------------------------------------------------------------------
 * QUÉ PASÓ EL 2026-08-26, QUE ES DE DÓNDE SALE ESTE ARCHIVO
 *
 * El día que se cargó la primera clave de Stripe de la historia del proyecto,
 * TODOS los checkouts murieron en el mismo punto:
 *
 *     Invalid line_items[0]: the product tax code is missing.
 *     Product tax code is required for Managed Payments,
 *     which is enabled by default on your account.
 *
 * Managed Payments es el "merchant of record" de Stripe: Stripe pasa a ser el
 * vendedor legal, calcula el impuesto de la jurisdicción de quien compra, lo
 * agrega al total y lo remite. Stripe lo dejó PRENDIDO POR DEFECTO en la cuenta
 * nueva — nadie del proyecto lo eligió.
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ SE APAGA EN VEZ DE COMPLETAR EL `tax_code`
 *
 * Porque la salida fácil —agregar `tax_code` y dejar Managed Payments prendido—
 * cambia el error ruidoso y gratis por uno silencioso y caro.
 *
 * Con Managed Payments, Stripe le SUMA el impuesto al precio. O sea que
 * `session.amount_total` deja de ser el número que la persona vio en pantalla y
 * que quedó escrito en `metadata.price_cents` / `boosts.amount_cents`. Y ese
 * número es exactamente contra el que `motivoDeDiscrepancia`
 * (lib/monetization/pactado.ts) decide si el beneficio se entrega:
 *
 *     if (session.amount_total !== pactado.cents) → "cobró X ≠ pactado Y"
 *
 * Resultado: cada pago se cobraría bien en Stripe y el webhook lo rechazaría.
 * La persona paga, no recibe nada, y el único rastro es una línea "NO se
 * concede" en los logs — que docs/STRIPE.md ya señala como el error más caro de
 * este sistema, porque hay que devolver o acreditar a mano, de a uno.
 *
 * Hoy el error se ve al instante y no cobró nada. Ese es el fallo bueno.
 *
 * PRENDER MANAGED PAYMENTS ES UNA DECISIÓN COMERCIAL Y FISCAL, NO UN FIX.
 * Cambia quién es el vendedor legal, cambia las comisiones y cambia lo que se le
 * cobra a la gente. docs/STRIPE.md ya declara "no hay impuestos (Stripe Tax no
 * está configurado)" como límite conocido y aceptado. Si algún día se decide
 * prenderlo, no alcanza con borrar esta línea: hay que enseñarle a `pactado.ts`
 * a comparar contra el subtotal sin impuesto, o todo lo de arriba se cumple.
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ ACÁ Y NO EN EL DASHBOARD
 *
 * Porque el dashboard ya demostró que se mueve solo: Managed Payments llegó
 * prendido sin que nadie lo tocara. Un apagado hecho por panel dura hasta el
 * próximo cambio de default de Stripe, y cuando se caiga se va a caer callado y
 * en producción. Escrito acá, viaja con el deploy y se revisa en el diff.
 *
 * POR QUÉ UNA FUNCIÓN Y NO LA LÍNEA REPETIDA SEIS VECES
 *
 * Por lo mismo que dice `pactado.ts`: "la tercera copia es siempre la que se
 * olvida de arreglar". El séptimo producto que alguien agregue va a andar bien
 * sin que tenga que enterarse de nada de esto, porque no hay otra puerta.
 * `managed_payments` va FUERA del tipo de entrada a propósito: quien intente
 * pasarlo se lleva un error de TypeScript, no un valor pisado en silencio.
 */

/**
 * Lo mismo que acepta `stripe.checkout.sessions.create`, menos la única perilla
 * que este módulo existe para no dejar tocar.
 */
export type CheckoutParams = Omit<
  Stripe.Checkout.SessionCreateParams,
  "managed_payments"
>;

/**
 * Abre una Checkout Session con el invariante de arriba ya puesto.
 *
 * El spread va PRIMERO y `managed_payments` después: así el apagado gana siempre,
 * incluso si algún día alguien fuerza un cast.
 */
export async function crearCheckoutSession(
  params: CheckoutParams,
): Promise<Stripe.Checkout.Session> {
  return getStripe().checkout.sessions.create({
    ...params,
    managed_payments: { enabled: false },
  });
}
