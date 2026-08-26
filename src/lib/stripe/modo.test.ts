import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getStripeMode } from "./index";

/**
 * ¿La plata que entra es de verdad?
 *
 * Una app apuntada a `sk_test_` acepta la 4242 4242 4242 4242, devuelve éxito,
 * activa el beneficio y manda el comprobante — sin cobrar un centavo. Desde
 * adentro es indistinguible de haber vendido. `getStripeMode()` es lo único que
 * separa las dos situaciones, así que su lectura del prefijo tiene que ser
 * exacta: contestar "live" de más regala productos, contestar "test" de más
 * esconde cobros reales.
 */

const KEY_ORIGINAL = process.env.STRIPE_SECRET_KEY;

beforeEach(() => {
  delete process.env.STRIPE_SECRET_KEY;
});

afterEach(() => {
  if (KEY_ORIGINAL === undefined) delete process.env.STRIPE_SECRET_KEY;
  else process.env.STRIPE_SECRET_KEY = KEY_ORIGINAL;
});

describe("getStripeMode", () => {
  it("sin clave no inventa un modo", () => {
    expect(getStripeMode()).toBeNull();
  });

  it("reconoce el modo de prueba", () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_abc123";
    expect(getStripeMode()).toBe("test");
  });

  it("reconoce el modo real", () => {
    process.env.STRIPE_SECRET_KEY = "sk_live_abc123";
    expect(getStripeMode()).toBe("live");
  });

  it("reconoce también las restricted keys, que empiezan con rk_", () => {
    // `rk_live_` es una clave real con permisos recortados. Leerla como "no sé"
    // haría que un deploy que SÍ cobra plata pareciera no cobrarla.
    process.env.STRIPE_SECRET_KEY = "rk_live_abc123";
    expect(getStripeMode()).toBe("live");
    process.env.STRIPE_SECRET_KEY = "rk_test_abc123";
    expect(getStripeMode()).toBe("test");
  });

  it("una clave con forma rara devuelve null, no un modo adivinado", () => {
    // El caso real: la clave pegada con comillas, con un espacio al principio o
    // cortada a la mitad. Adivinar "test" ahí sería tranquilizador y falso.
    process.env.STRIPE_SECRET_KEY = '"sk_live_abc123"';
    expect(getStripeMode()).toBeNull();
    process.env.STRIPE_SECRET_KEY = "pk_test_abc123";
    expect(getStripeMode()).toBeNull();
  });
});
