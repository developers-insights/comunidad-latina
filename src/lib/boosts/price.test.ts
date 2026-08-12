import { describe, expect, it } from "vitest";
import { combineBoostPrice } from "./price";

/**
 * Lo que se prueba acá es una sola promesa: el número que se muestra es el
 * número que se cobra. Las dos puntas llaman a `combineBoostPrice`, así que
 * basta con que esta función no invente nada.
 */

const usd = (cents: number) => ({ amountCents: cents, currency: "USD" });

describe("combineBoostPrice", () => {
  it("suma el recargo del alcance al precio de la duración", () => {
    expect(combineBoostPrice(usd(2500), usd(1500))).toEqual({
      amountCents: 4000,
      currency: "USD",
      surchargeCents: 1500,
      currencyMismatch: false,
    });
  });

  it("un recargo de cero deja el precio de la duración intacto", () => {
    expect(combineBoostPrice(usd(1000), usd(0)).amountCents).toBe(1000);
  });

  it("sin recargo configurado cobra sólo la duración", () => {
    expect(combineBoostPrice(usd(4500), null)).toEqual({
      amountCents: 4500,
      currency: "USD",
      surchargeCents: 0,
      currencyMismatch: false,
    });
  });

  it("recargo en otra moneda: se ignora, se marca y NUNCA se convierte al vuelo", () => {
    const total = combineBoostPrice(usd(2500), { amountCents: 1500, currency: "DOP" });
    expect(total.amountCents).toBe(2500);
    expect(total.surchargeCents).toBe(0);
    expect(total.currencyMismatch).toBe(true);
  });

  it("la moneda se compara sin importar mayúsculas", () => {
    expect(combineBoostPrice(usd(1000), { amountCents: 500, currency: "usd" }).amountCents).toBe(
      1500,
    );
  });

  it("descarta montos imposibles en vez de arrastrarlos", () => {
    expect(combineBoostPrice(usd(1000), usd(-500)).amountCents).toBe(1000);
    expect(combineBoostPrice(usd(1000), usd(12.5)).amountCents).toBe(1000);
    expect(combineBoostPrice({ amountCents: -1, currency: "USD" }, usd(500)).amountCents).toBe(500);
  });

  it("nunca lanza, ni con lo peor que puede cruzar el borde", () => {
    expect(() =>
      combineBoostPrice(
        { amountCents: Number.NaN, currency: "USD" },
        { amountCents: Number.POSITIVE_INFINITY, currency: "USD" },
      ),
    ).not.toThrow();
  });
});
