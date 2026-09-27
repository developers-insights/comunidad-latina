import "server-only";

import { createHash } from "node:crypto";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { roleOf, asContractStatus, type ContractRole, type ContractStatus } from "@/components/creators/contract-machine";
import { requireTenantMatch } from "@/lib/tenant/guard";
import type { Tenant } from "@/lib/tenant/resolve";
import type { AdminClient } from "./escrow";
import { CONTRACT_TEMPLATE_VERSION, buildContractText } from "./contract-terms";

export const PARTY_CONTRACT_COLUMNS =
  "id, tenant_id, code, gig_id, client_id, creator_id, title, scope, delivery_days, amount_cents, currency, fee_pct, platform_fee_cents, creator_net_cents, status, payment_mode, revisions_included, usage_rights, proposal_message, terms_version, terms_hash, contract_text, template_version, signed_at, review_deadline_at, stripe_checkout_session_id, stripe_payment_intent_id, stripe_refund_id, payout_error";

export interface PartyContract {
  id: string;
  tenant_id: string;
  code: string;
  gig_id: string | null;
  client_id: string;
  creator_id: string;
  title: string;
  scope: string;
  delivery_days: number;
  amount_cents: number;
  currency: string;
  fee_pct: number;
  platform_fee_cents: number | null;
  creator_net_cents: number | null;
  status: ContractStatus;
  payment_mode: string;
  revisions_included: number;
  usage_rights: string;
  proposal_message: string | null;
  terms_version: number;
  terms_hash: string | null;
  contract_text: string | null;
  template_version: string | null;
  signed_at: string | null;
  review_deadline_at: string | null;
  stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null;
  stripe_refund_id: string | null;
  payout_error: string | null;
}

export type PartyAccess =
  | {
      ok: true;
      tenant: Tenant;
      user: User;
      supabase: SupabaseClient;
      role: Exclude<ContractRole, "other">;
      contract: PartyContract;
    }
  | { ok: false; error: string; needsAuth?: boolean };

export const ACCESS_COPY = {
  needLogin: "Para seguir necesitás entrar a tu cuenta.",
  notAllowed: "Esa acción no está disponible en este momento.",
} as const;

export async function loadContractForParty(contractId: string): Promise<PartyAccess> {
  const guard = await requireTenantMatch();
  if (!guard.ok) {
    if (guard.reason === "unauthenticated") return { ok: false, needsAuth: true, error: ACCESS_COPY.needLogin };
    return { ok: false, error: guard.message };
  }
  const supabase = guard.supabase as unknown as SupabaseClient;
  const { data, error } = await supabase
    .from("gig_contracts")
    .select(PARTY_CONTRACT_COLUMNS)
    .eq("id", contractId)
    .maybeSingle();
  if (error) {
    console.error("[creadores] no se pudo leer el contrato", { contractId, code: error.code });
    return { ok: false, error: ACCESS_COPY.notAllowed };
  }
  const contract = data as PartyContract | null;
  if (!contract || contract.tenant_id !== guard.tenant.id || !asContractStatus(contract.status)) {
    return { ok: false, error: ACCESS_COPY.notAllowed };
  }
  const role = roleOf(guard.user.id, contract);
  if (role === "other") return { ok: false, error: ACCESS_COPY.notAllowed };
  return { ok: true, tenant: guard.tenant, user: guard.user, supabase, role, contract };
}

export function hashContractText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export async function buildContractSnapshot(
  admin: AdminClient,
  contract: PartyContract,
  communityName: string,
): Promise<{ text: string; hash: string; templateVersion: string }> {
  const { data, error } = await admin
    .from("profiles")
    .select("id, display_name")
    .in("id", [contract.client_id, contract.creator_id]);
  if (error) throw new Error(`select profiles (snapshot): ${error.code}`);
  const names = new Map((data ?? []).map((p) => [p.id, p.display_name ?? "Miembro de la comunidad"]));

  const text = buildContractText({
    code: contract.code,
    termsVersion: contract.terms_version,
    communityName,
    clientName: names.get(contract.client_id) ?? "Miembro de la comunidad",
    creatorName: names.get(contract.creator_id) ?? "Miembro de la comunidad",
    title: contract.title,
    scope: contract.scope,
    deliveryDays: contract.delivery_days,
    revisionsIncluded: contract.revisions_included,
    usageRights: contract.usage_rights,
    amountCents: contract.amount_cents,
    currency: contract.currency,
    feePct: contract.fee_pct,
    platformFeeCents: contract.platform_fee_cents ?? Math.trunc((contract.amount_cents * contract.fee_pct) / 100),
    creatorNetCents:
      contract.creator_net_cents ??
      contract.amount_cents - Math.trunc((contract.amount_cents * contract.fee_pct) / 100),
  });
  return { text, hash: hashContractText(text), templateVersion: CONTRACT_TEMPLATE_VERSION };
}
