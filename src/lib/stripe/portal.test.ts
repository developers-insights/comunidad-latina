import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

vi.mock("server-only", () => ({}));

import { __resetPortalConfigCache, portalConfigurationId } from "./portal";

function fakeStripe(existentes: Array<{ id: string; metadata: Record<string, string> }>) {
  const list = vi.fn().mockResolvedValue({ data: existentes });
  const create = vi.fn().mockResolvedValue({ id: "bpc_nueva" });
  const stripe = { billingPortal: { configurations: { list, create } } } as unknown as Stripe;
  return { stripe, list, create };
}

beforeEach(() => {
  __resetPortalConfigCache();
});

describe("portalConfigurationId", () => {
  it("reusa la config marcada en vez de crear otra", async () => {
    const { stripe, create } = fakeStripe([
      { id: "bpc_ajena", metadata: {} },
      { id: "bpc_propia", metadata: { uso: "suscripciones-comunidad" } },
    ]);
    await expect(portalConfigurationId(stripe)).resolves.toBe("bpc_propia");
    expect(create).not.toHaveBeenCalled();
  });

  it("si no existe la crea sin cambio de plan y con cancelación al fin del período", async () => {
    const { stripe, create } = fakeStripe([]);
    await expect(portalConfigurationId(stripe)).resolves.toBe("bpc_nueva");
    const params = create.mock.calls[0]?.[0] as Stripe.BillingPortal.ConfigurationCreateParams;
    expect(params.features.subscription_update?.enabled).toBe(false);
    expect(params.features.subscription_cancel).toMatchObject({ enabled: true, mode: "at_period_end" });
    expect(params.metadata).toEqual({ uso: "suscripciones-comunidad" });
  });

  it("cachea el id: la segunda llamada no vuelve a Stripe", async () => {
    const { stripe, list } = fakeStripe([]);
    await portalConfigurationId(stripe);
    await portalConfigurationId(stripe);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("si Stripe falla devuelve undefined para que el portal abra igual", async () => {
    const list = vi.fn().mockRejectedValue(new Error("boom"));
    const stripe = { billingPortal: { configurations: { list } } } as unknown as Stripe;
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(portalConfigurationId(stripe)).resolves.toBeUndefined();
  });
});
