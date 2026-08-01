import { describe, expect, it } from "vitest";
import {
  PREMIUM_LISTING_PRICE_CENTS,
  parsePremiumStatus,
  premiumPresentation,
  premiumViewFor,
  statusKeepsListingPremium,
  tierForPremiumStatus,
} from "./premium";

/**
 * Tests de la lógica pura del premium de una publicación.
 *
 * Qué se está protegiendo acá, y por qué merece un test cada uno:
 *
 *  · `statusKeepsListingPremium` es un ESPEJO de `app.mirror_listing_tier()`
 *    (0054). Si se separan, la app le miente al dueño sobre lo que la comunidad
 *    está viendo. El comportamiento del trigger se verificó contra la base real;
 *    esto congela el lado TypeScript.
 *  · `canActivate` es lo que impide el DOBLE COBRO: con una suscripción viva,
 *    abrir un Checkout nuevo crea una segunda suscripción sobre el mismo aviso.
 *  · `premiumViewFor` separa "nunca pagó" de "se le venció", que para la persona
 *    son dos situaciones distintas y llevan copy distinto.
 */

/** Fecha formateada de mentira: los tests miran la lógica, no el locale. */
const fmt = (iso: string) => `FECHA(${iso})`;

describe("parsePremiumStatus", () => {
  it("acepta los 4 del CHECK y rechaza cualquier otra cosa", () => {
    for (const s of ["active", "past_due", "canceled", "expired"]) {
      expect(parsePremiumStatus(s)).toBe(s);
    }
    for (const basura of ["premium", "", null, undefined, 7, {}]) {
      expect(parsePremiumStatus(basura)).toBeNull();
    }
  });
});

describe("statusKeepsListingPremium — espejo del trigger de 0054", () => {
  it("active y past_due dejan el aviso premium", () => {
    expect(statusKeepsListingPremium("active")).toBe(true);
    // past_due NO apaga: un rebote de tarjeta da margen para actualizarla, no
    // le borra los botones a un comercio en el acto. Verificado también contra
    // la base: `update ... status='past_due'` deja listings.tier='premium'.
    expect(statusKeepsListingPremium("past_due")).toBe(true);
  });

  it("canceled y expired lo bajan a gratuito", () => {
    expect(statusKeepsListingPremium("canceled")).toBe(false);
    expect(statusKeepsListingPremium("expired")).toBe(false);
  });

  it("tierForPremiumStatus traduce a los valores exactos de listings.tier", () => {
    expect(tierForPremiumStatus("active")).toBe("premium");
    expect(tierForPremiumStatus("past_due")).toBe("premium");
    expect(tierForPremiumStatus("canceled")).toBe("free");
    expect(tierForPremiumStatus("expired")).toBe("free");
  });
});

describe("premiumViewFor", () => {
  it("sin fila es `none`, no `ended`: nunca se le cobró a nadie", () => {
    expect(premiumViewFor(null)).toBe("none");
    expect(premiumViewFor(undefined)).toBe("none");
  });

  it("un status desconocido cae en `none` (el default restrictivo)", () => {
    // Regalar premium por un valor raro es regalar la parte que se cobra.
    expect(premiumViewFor({ status: "vip" })).toBe("none");
  });

  it("active + cancel_at_period_end es `canceling`, no `active`", () => {
    expect(premiumViewFor({ status: "active" })).toBe("active");
    expect(premiumViewFor({ status: "active", cancel_at_period_end: true })).toBe("canceling");
  });

  it("past_due tiene vista propia; canceled y expired comparten `ended`", () => {
    expect(premiumViewFor({ status: "past_due" })).toBe("past_due");
    expect(premiumViewFor({ status: "canceled" })).toBe("ended");
    expect(premiumViewFor({ status: "expired" })).toBe("ended");
  });
});

describe("premiumPresentation — la regla que evita el doble cobro", () => {
  it("con una suscripción VIVA nunca ofrece abrir un Checkout nuevo", () => {
    for (const row of [
      { status: "active" },
      { status: "active", cancel_at_period_end: true },
      { status: "past_due" },
    ]) {
      const p = premiumPresentation(row, fmt);
      // Abrir un Checkout acá crearía una SEGUNDA suscripción sobre el mismo
      // aviso: la persona pagaría dos veces por lo mismo.
      expect(p.canActivate).toBe(false);
      // Y siempre hay salida: reanudar, cambiar tarjeta o cancelar, en el portal.
      expect(p.canManage).toBe(true);
    }
  });

  it("sin suscripción ofrece alta y NO ofrece portal (no hay nada que gestionar)", () => {
    const p = premiumPresentation(null, fmt);
    expect(p.canActivate).toBe(true);
    expect(p.canManage).toBe(false);
    expect(p.title).toBeNull(); // no se le anuncia a nadie que "no tiene nada"
  });

  it("terminada ofrece reactivar, y el portal sólo si ya hubo facturación", () => {
    const sinBilling = premiumPresentation({ status: "expired" }, fmt);
    expect(sinBilling.canActivate).toBe(true);
    expect(sinBilling.canManage).toBe(false);

    const conBilling = premiumPresentation(
      { status: "expired", stripe_customer_id: "cus_1" },
      fmt,
    );
    expect(conBilling.canManage).toBe(true);
  });

  it("usa la fecha del período cuando la hay", () => {
    const p = premiumPresentation(
      { status: "active", current_period_end: "2026-03-12T00:00:00.000Z" },
      fmt,
    );
    expect(p.body).toContain("FECHA(2026-03-12T00:00:00.000Z)");
  });

  it("sin fecha no arma una frase rota", () => {
    // `canceling` sin período no puede decir "Premium hasta el ..." — se cae al
    // título de activa en vez de mostrar un hueco.
    const p = premiumPresentation({ status: "active", cancel_at_period_end: true }, fmt);
    expect(p.title).not.toContain("undefined");
    expect(p.title).toBeTruthy();
    expect(p.body).toBeTruthy();
  });

  it("el estado con pago rebotado se muestra como problema, no como éxito", () => {
    expect(premiumPresentation({ status: "past_due" }, fmt).tone).toBe("danger");
    expect(premiumPresentation({ status: "active" }, fmt).tone).toBe("success");
  });
});

describe("precio", () => {
  it("es el mismo que el default de listing_premiums.price_cents (0054)", () => {
    // Si estos dos se separan, la correlación de monto del webhook rechaza
    // TODOS los pagos y nadie puede pasar a premium.
    expect(PREMIUM_LISTING_PRICE_CENTS).toBe(900);
  });
});
