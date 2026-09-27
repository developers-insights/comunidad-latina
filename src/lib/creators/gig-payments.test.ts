import { describe, expect, it } from "vitest";
import {
  GIG_PAYMENT_KIND,
  checkoutIdempotencyKey,
  fundingDiscrepancy,
  gigTransferGroup,
  payoutAmountCents,
  payoutReadiness,
  refundIdempotencyKey,
  transferIdempotencyKey,
} from "./gig-payments";

const CONTRACT = {
  id: "0199aaaa-0000-7000-8000-000000000001",
  tenant_id: "11111111-1111-4111-8111-111111111111",
  amount_cents: 100_000,
  currency: "usd",
  stripe_checkout_session_id: "cs_test_1",
};

const SESSION = {
  id: "cs_test_1",
  amount_total: 100_000,
  currency: "usd",
  metadata: {
    kind: GIG_PAYMENT_KIND,
    contract_id: CONTRACT.id,
    tenant_id: CONTRACT.tenant_id,
  },
};

describe("fundingDiscrepancy", () => {
  it("un cobro que coincide en todo no tiene discrepancia", () => {
    expect(fundingDiscrepancy(SESSION, CONTRACT)).toBeNull();
  });

  it("otra sesión que la vinculada al contrato no se acredita", () => {
    expect(fundingDiscrepancy({ ...SESSION, id: "cs_test_viejo" }, CONTRACT)).toMatch(/sesión/);
  });

  it("monto distinto al del contrato no se acredita", () => {
    expect(fundingDiscrepancy({ ...SESSION, amount_total: 99_999 }, CONTRACT)).toMatch(/monto/);
  });

  it("sin monto no se puede verificar, y lo que no se verifica no se acredita", () => {
    expect(fundingDiscrepancy({ ...SESSION, amount_total: null }, CONTRACT)).toMatch(/monto/);
  });

  it("la moneda cuenta: 1000 ARS no son 1000 USD", () => {
    expect(fundingDiscrepancy({ ...SESSION, currency: "ars" }, CONTRACT)).toMatch(/moneda/);
    expect(fundingDiscrepancy({ ...SESSION, currency: "USD" }, CONTRACT)).toBeNull();
  });

  it("metadata que apunta a otro contrato o a otra comunidad no se acredita", () => {
    expect(
      fundingDiscrepancy({ ...SESSION, metadata: { ...SESSION.metadata, contract_id: "otro" } }, CONTRACT),
    ).toMatch(/contrato/);
    expect(
      fundingDiscrepancy({ ...SESSION, metadata: { ...SESSION.metadata, tenant_id: "otra" } }, CONTRACT),
    ).toMatch(/comunidad/);
  });
});

describe("payoutReadiness", () => {
  it("sin cuenta conectada falta todo", () => {
    expect(payoutReadiness(null)).toBe("missing");
    expect(payoutReadiness({ stripe_account_id: null, capabilities: {} })).toBe("missing");
  });

  it("con cuenta pero sin transferencias activas, el onboarding está incompleto", () => {
    expect(payoutReadiness({ stripe_account_id: "acct_1", capabilities: { transfers: "pending" } })).toBe(
      "incomplete",
    );
    expect(payoutReadiness({ stripe_account_id: "acct_1", capabilities: {} })).toBe("incomplete");
    expect(payoutReadiness({ stripe_account_id: "acct_1", capabilities: null })).toBe("incomplete");
  });

  it("con transferencias activas está lista para cobrar", () => {
    expect(payoutReadiness({ stripe_account_id: "acct_1", capabilities: { transfers: "active" } })).toBe("ready");
  });
});

describe("payoutAmountCents", () => {
  it("es el neto congelado del contrato", () => {
    expect(payoutAmountCents({ amount_cents: 100_000, creator_net_cents: 80_000 })).toBe(80_000);
  });

  it("un neto imposible no se transfiere", () => {
    expect(payoutAmountCents({ amount_cents: 100_000, creator_net_cents: null })).toBeNull();
    expect(payoutAmountCents({ amount_cents: 100_000, creator_net_cents: 0 })).toBeNull();
    expect(payoutAmountCents({ amount_cents: 100_000, creator_net_cents: 100_001 })).toBeNull();
    expect(payoutAmountCents({ amount_cents: 100_000, creator_net_cents: 800.5 })).toBeNull();
  });
});

describe("claves de idempotencia y grupo de transferencia", () => {
  it("son estables por contrato", () => {
    expect(gigTransferGroup(CONTRACT.id)).toBe(`gig_${CONTRACT.id}`);
    expect(transferIdempotencyKey(CONTRACT.id)).toBe(transferIdempotencyKey(CONTRACT.id));
    expect(refundIdempotencyKey(CONTRACT.id)).not.toBe(transferIdempotencyKey(CONTRACT.id));
  });

  it("abrir el pago dos veces seguidas da la misma clave; después de una sesión vencida, otra", () => {
    expect(checkoutIdempotencyKey(CONTRACT.id, 1, null)).toBe(checkoutIdempotencyKey(CONTRACT.id, 1, null));
    expect(checkoutIdempotencyKey(CONTRACT.id, 1, "cs_test_1")).not.toBe(
      checkoutIdempotencyKey(CONTRACT.id, 1, null),
    );
    expect(checkoutIdempotencyKey(CONTRACT.id, 2, null)).not.toBe(checkoutIdempotencyKey(CONTRACT.id, 1, null));
  });
});
