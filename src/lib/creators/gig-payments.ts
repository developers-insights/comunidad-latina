export const GIG_PAYMENT_KIND = "gig_contract";

export type PayoutReadiness = "missing" | "incomplete" | "ready";

export function payoutReadiness(
  account: { stripe_account_id: string | null; capabilities: unknown } | null,
): PayoutReadiness {
  if (!account?.stripe_account_id) return "missing";
  const caps = account.capabilities;
  if (caps && typeof caps === "object" && (caps as Record<string, unknown>).transfers === "active") {
    return "ready";
  }
  return "incomplete";
}

export function payoutAmountCents(contract: {
  amount_cents: number;
  creator_net_cents: number | null;
}): number | null {
  const net = contract.creator_net_cents;
  if (typeof net !== "number" || !Number.isInteger(net)) return null;
  if (net <= 0 || net > contract.amount_cents) return null;
  return net;
}

interface SessionLike {
  id: string;
  amount_total: number | null;
  currency: string | null;
  metadata: Record<string, string> | null;
}

interface FundableContract {
  id: string;
  tenant_id: string;
  amount_cents: number;
  currency: string;
  stripe_checkout_session_id: string | null;
}

export function fundingDiscrepancy(session: SessionLike, contract: FundableContract): string | null {
  const meta = session.metadata ?? {};
  if (meta.contract_id !== contract.id) {
    return `la metadata apunta a otro contrato (${meta.contract_id ?? "ninguno"})`;
  }
  if (meta.tenant_id !== contract.tenant_id) {
    return `la metadata apunta a otra comunidad (${meta.tenant_id ?? "ninguna"})`;
  }
  if (!contract.stripe_checkout_session_id || contract.stripe_checkout_session_id !== session.id) {
    return `la sesión ${session.id} no es la vinculada al contrato (${contract.stripe_checkout_session_id ?? "ninguna"})`;
  }
  if (typeof session.amount_total !== "number" || session.amount_total !== contract.amount_cents) {
    return `el monto cobrado (${session.amount_total ?? "sin monto"}) no es el del contrato (${contract.amount_cents})`;
  }
  if (!session.currency || session.currency.toLowerCase() !== contract.currency.toLowerCase()) {
    return `la moneda cobrada (${session.currency ?? "sin moneda"}) no es la del contrato (${contract.currency})`;
  }
  return null;
}

export function gigTransferGroup(contractId: string): string {
  return `gig_${contractId}`;
}

export function checkoutIdempotencyKey(
  contractId: string,
  termsVersion: number,
  previousSessionId: string | null,
): string {
  return `gig-checkout:${contractId}:v${termsVersion}:${previousSessionId ?? "first"}`;
}

export function transferIdempotencyKey(contractId: string): string {
  return `gig-transfer:${contractId}`;
}

export function refundIdempotencyKey(contractId: string): string {
  return `gig-refund:${contractId}`;
}
