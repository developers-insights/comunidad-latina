import { describe, expect, it } from "vitest";
import type Stripe from "stripe";
import {
  cancelsAtPeriodEnd,
  mapStripeSubscriptionStatus,
  periodEndFromSubscription,
} from "./subscription";

/**
 * Tests de la lectura del objeto `Subscription` de Stripe.
 *
 * El más importante es el de `periodEndFromSubscription`: es el bug que este
 * repo YA PAGÓ una vez. En stripe-node 22 `current_period_end` se movió de la
 * raíz de la Subscription a cada SubscriptionItem; leerlo de la raíz devuelve
 * undefined, deja la columna en NULL, el cron nunca vence la fila y lo que se
 * cobra queda prendido para siempre. El test de "sólo en la raíz" existe
 * exactamente para que nadie vuelva a escribirlo así.
 *
 * Se testea sin red y sin claves: son objetos planos.
 */

/** Subscription mínima con los ítems que nos importan. */
function subscription(overrides: Record<string, unknown> = {}): Stripe.Subscription {
  return {
    id: "sub_1",
    status: "active",
    cancel_at_period_end: false,
    items: { data: [{ current_period_end: 1_800_000_000 }] },
    ...overrides,
  } as unknown as Stripe.Subscription;
}

describe("mapStripeSubscriptionStatus — 9 estados de Stripe → 4 nuestros", () => {
  it("active y trialing mantienen el beneficio encendido", () => {
    expect(mapStripeSubscriptionStatus("active")).toBe("active");
    expect(mapStripeSubscriptionStatus("trialing")).toBe("active");
  });

  it("unpaid cae en past_due, no en expired: el cobro se sigue reintentando", () => {
    // Si cayera en `expired`, un rebote de tarjeta apagaría el negocio de
    // alguien mientras Stripe todavía está reintentando cobrarle.
    expect(mapStripeSubscriptionStatus("unpaid")).toBe("past_due");
    expect(mapStripeSubscriptionStatus("past_due")).toBe("past_due");
  });

  it("canceled es canceled; los estados que nunca llegaron a pagarse son expired", () => {
    expect(mapStripeSubscriptionStatus("canceled")).toBe("canceled");
    expect(mapStripeSubscriptionStatus("incomplete")).toBe("expired");
    expect(mapStripeSubscriptionStatus("incomplete_expired")).toBe("expired");
    expect(mapStripeSubscriptionStatus("paused")).toBe("expired");
  });
});

describe("periodEndFromSubscription — el gotcha de stripe-node 22", () => {
  it("lee current_period_end de los ITEMS", () => {
    const end = periodEndFromSubscription(subscription());
    expect(end).toBe(new Date(1_800_000_000 * 1000).toISOString());
  });

  it("con varios ítems toma el que vence MÁS TARDE", () => {
    const sub = subscription({
      items: {
        data: [
          { current_period_end: 1_700_000_000 },
          { current_period_end: 1_900_000_000 },
          { current_period_end: 1_800_000_000 },
        ],
      },
    });
    // Tomar el primero cortaría algo que todavía está pago.
    expect(periodEndFromSubscription(sub)).toBe(new Date(1_900_000_000 * 1000).toISOString());
  });

  it("EL BUG QUE YA SE PAGÓ: con la fecha SOLO en la raíz devuelve null, no la lee de ahí", () => {
    // Así viene el objeto en los ejemplos viejos de internet. Si esta función
    // "arreglara" el caso leyendo la raíz, estaríamos consagrando la forma
    // vieja; devolver null es correcto — esa fecha no es la del período vigente
    // en esta versión de la API, y el cron prefiere no tocar una fila antes que
    // vencerla con un dato que no le corresponde.
    const sub = subscription({ current_period_end: 1_800_000_000, items: { data: [] } });
    expect(periodEndFromSubscription(sub)).toBeNull();
  });

  it("sin items devuelve null (y el cron no toca filas con NULL)", () => {
    expect(periodEndFromSubscription(subscription({ items: undefined }))).toBeNull();
  });

  it("ignora ítems con fecha no numérica en vez de romper", () => {
    const sub = subscription({
      items: { data: [{ current_period_end: null }, { current_period_end: 1_750_000_000 }] },
    });
    expect(periodEndFromSubscription(sub)).toBe(new Date(1_750_000_000 * 1000).toISOString());
  });
});

describe("cancelsAtPeriodEnd", () => {
  it("distingue una cancelación programada de una suscripción sana", () => {
    // Las dos están `active`: sin este flag, la pantalla diría "se renueva sola"
    // sobre algo que se apaga a fin de mes.
    expect(cancelsAtPeriodEnd(subscription())).toBe(false);
    expect(cancelsAtPeriodEnd(subscription({ cancel_at_period_end: true }))).toBe(true);
  });
});
