import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * El invariante que este test cuida no es un detalle de configuración: es la
 * diferencia entre cobrar y entregar, o cobrar y no entregar.
 *
 * Con Managed Payments prendido, Stripe le suma el impuesto al precio y
 * `session.amount_total` deja de ser el número pactado que quedó en
 * `metadata.price_cents` / `boosts.amount_cents`. `motivoDeDiscrepancia`
 * (lib/monetization/pactado.ts) compara justo eso y rechaza el evento: la
 * persona paga, el webhook no concede, y hay que reconciliar a mano de a uno.
 *
 * Por eso el apagado no puede vivir sólo en un comentario ni en el dashboard
 * —que ya se movió solo una vez, ver lib/stripe/checkout.ts—: si alguien lo
 * saca, esto se pone en rojo antes del deploy.
 */

const create = vi.fn().mockResolvedValue({ id: "cs_test_1", url: "https://x" });

vi.mock("./index", () => ({
  getStripe: () => ({ checkout: { sessions: { create } } }),
}));

beforeEach(() => {
  create.mockClear();
});

afterEach(() => {
  vi.resetModules();
});

describe("crearCheckoutSession", () => {
  it("apaga Managed Payments en TODA session que abre", async () => {
    const { crearCheckoutSession } = await import("./checkout");

    await crearCheckoutSession({ mode: "payment", line_items: [] });

    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      managed_payments: { enabled: false },
    });
  });

  it("no deja que un caller lo vuelva a prender", async () => {
    const { crearCheckoutSession } = await import("./checkout");

    // El tipo ya lo prohíbe (`Omit<…, "managed_payments">`), así que este caso
    // sólo puede llegar por un cast — que es exactamente cómo se cuela en la
    // vida real. El spread va primero justamente para que pierda.
    await crearCheckoutSession({
      mode: "payment",
      line_items: [],
      managed_payments: { enabled: true },
    } as unknown as Parameters<typeof crearCheckoutSession>[0]);

    expect(create.mock.calls[0]?.[0]).toMatchObject({
      managed_payments: { enabled: false },
    });
  });

  it("no toca nada más de lo que le pasan", async () => {
    const { crearCheckoutSession } = await import("./checkout");

    await crearCheckoutSession({
      mode: "subscription",
      metadata: { tenant_id: "t1", price_cents: "1000" },
      success_url: "https://ok",
      cancel_url: "https://no",
      line_items: [],
    });

    expect(create.mock.calls[0]?.[0]).toMatchObject({
      mode: "subscription",
      metadata: { tenant_id: "t1", price_cents: "1000" },
      success_url: "https://ok",
      cancel_url: "https://no",
    });
  });
});
