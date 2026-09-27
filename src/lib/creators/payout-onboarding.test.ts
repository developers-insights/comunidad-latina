import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { createFakeDb } from "./fake-db.test-helper";

vi.mock("@/lib/notifications/notify", () => ({ createNotification: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock("@/lib/stripe/checkout", () => ({ crearCheckoutSessionIdempotente: vi.fn() }));

import { onboardingLink, payoutReturnUrls, syncAfterReturn } from "./payout-onboarding";
import type { AdminClient } from "./escrow";

const CREATOR = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const stripe = {
  accounts: {
    create: vi.fn().mockResolvedValue({ id: "acct_new", capabilities: {} }),
    retrieve: vi.fn().mockResolvedValue({
      id: "acct_1",
      capabilities: { transfers: "pending" },
      requirements: { currently_due: ["external_account"], past_due: [], disabled_reason: null },
    }),
  },
  accountLinks: { create: vi.fn().mockResolvedValue({ url: "https://connect.stripe.com/setup/x" }) },
  transfers: { list: vi.fn(), create: vi.fn() },
};

beforeEach(() => vi.clearAllMocks());

describe("onboarding de cobros", () => {
  it("las URLs de vuelta son las de la app, no las de otro sitio", () => {
    expect(payoutReturnUrls("https://app.test")).toEqual({
      refresh_url: "https://app.test/creadores/cobros/reintentar",
      return_url: "https://app.test/creadores/cobros/vuelta",
    });
  });

  it("crea la cuenta si falta y devuelve un link de onboarding para esa cuenta", async () => {
    const fake = createFakeDb({ connected_accounts: [] });
    const url = await onboardingLink({
      admin: fake.client as AdminClient,
      stripe: stripe as unknown as Stripe,
      tenantId: "t",
      profileId: CREATOR,
      email: null,
      siteUrl: "https://app.test",
    });
    expect(url).toBe("https://connect.stripe.com/setup/x");
    expect(stripe.accountLinks.create).toHaveBeenCalledWith(
      expect.objectContaining({ account: "acct_new", type: "account_onboarding" }),
    );
  });

  it("al volver, sincroniza la cuenta con lo que dice Stripe", async () => {
    const fake = createFakeDb({
      connected_accounts: [{ owner_type: "creator", owner_ref: CREATOR, stripe_account_id: "acct_1", capabilities: {} }],
      gig_contracts: [],
    });
    const result = await syncAfterReturn({
      admin: fake.client as AdminClient,
      stripe: stripe as unknown as Stripe,
      profileId: CREATOR,
    });
    expect(result).toBe("synced");
    expect(fake.tables.connected_accounts[0]).toMatchObject({
      capabilities: { transfers: "pending" },
      requirements_due: ["external_account"],
      verification_status: "pending",
    });
  });

  it("sin cuenta no llama a Stripe", async () => {
    const fake = createFakeDb({ connected_accounts: [] });
    const result = await syncAfterReturn({
      admin: fake.client as AdminClient,
      stripe: stripe as unknown as Stripe,
      profileId: CREATOR,
    });
    expect(result).toBe("none");
    expect(stripe.accounts.retrieve).not.toHaveBeenCalled();
  });
});
