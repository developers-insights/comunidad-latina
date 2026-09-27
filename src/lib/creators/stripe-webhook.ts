import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import {
  ESCROW_CONTRACT_COLUMNS,
  confirmGigFunding,
  recordContractEvent,
  releaseAbandonedCheckout,
  retryPendingPayoutsFor,
  syncConnectedAccount,
  type AdminClient,
  type EscrowContract,
} from "./escrow";
import { GIG_PAYMENT_KIND } from "./gig-payments";

const MONEY_HELD: ReadonlySet<string> = new Set(["funded", "delivered", "changes_requested", "approved"]);

function db(admin: AdminClient): SupabaseClient {
  return admin as unknown as SupabaseClient;
}

function idOf(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

async function contractByPaymentIntent(
  admin: AdminClient,
  paymentIntentId: string | null,
): Promise<EscrowContract | null> {
  if (!paymentIntentId) return null;
  const { data, error } = await db(admin)
    .from("gig_contracts")
    .select(ESCROW_CONTRACT_COLUMNS)
    .eq("stripe_payment_intent_id", paymentIntentId)
    .maybeSingle();
  if (error) throw new Error(`select gig_contracts por payment_intent: ${error.code}`);
  return (data as EscrowContract | null) ?? null;
}

async function freezeForMoneyBack(
  admin: AdminClient,
  contract: EscrowContract,
  kind: "refunded" | "chargeback",
  note: string,
  extra: Record<string, unknown>,
): Promise<void> {
  const { data, error } = await db(admin)
    .from("gig_contracts")
    .update({ status: "disputed", review_deadline_at: null, ...extra })
    .eq("id", contract.id)
    .eq("status", contract.status)
    .select("id");
  if (error) throw new Error(`update gig_contracts (${kind}): ${error.code}`);
  if ((data ?? []).length === 0) return;
  await recordContractEvent(admin, {
    tenantId: contract.tenant_id,
    contractId: contract.id,
    actorId: null,
    kind,
    note,
  });
}

/**
 * Devuelve true si el evento era del Creator Marketplace (y ya quedó atendido).
 * Para todo lo demás devuelve false sin escribir nada, así el route sigue con
 * los otros productos.
 */
export async function handleGigContractEvent(
  admin: AdminClient,
  event: Stripe.Event,
  getStripe: () => Stripe,
): Promise<boolean> {
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.metadata?.kind !== GIG_PAYMENT_KIND) return false;
      await confirmGigFunding(admin, getStripe(), session);
      return true;
    }

    case "checkout.session.expired":
    case "checkout.session.async_payment_failed": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.metadata?.kind !== GIG_PAYMENT_KIND) return false;
      await releaseAbandonedCheckout(admin, session);
      return true;
    }

    case "charge.refunded": {
      const charge = event.data.object as Stripe.Charge;
      const contract = await contractByPaymentIntent(admin, idOf(charge.payment_intent));
      if (!contract) return false;
      if (contract.stripe_refund_id) return true;

      const refundId = charge.refunds?.data?.[0]?.id ?? `externo:${charge.id}`;
      if (MONEY_HELD.has(contract.status)) {
        console.error(
          `[creadores:reembolso] ALERTA el contrato ${contract.id} estaba "${contract.status}" y su pago se reembolsó por fuera de la app. Queda en disputa y sin transferencia.`,
        );
        await freezeForMoneyBack(admin, contract, "refunded", "El pago se reembolsó desde Stripe.", {
          stripe_refund_id: refundId,
        });
        return true;
      }
      if (contract.status === "released") {
        console.error(
          `[creadores:reembolso] ALERTA el contrato ${contract.id} ya estaba liberado y su pago se reembolsó: la transferencia ${contract.stripe_transfer_id} hay que revertirla a mano.`,
        );
      }
      const { data, error } = await db(admin)
        .from("gig_contracts")
        .update({ stripe_refund_id: refundId })
        .eq("id", contract.id)
        .is("stripe_refund_id", null)
        .select("id");
      if (error) throw new Error(`update gig_contracts (refund id): ${error.code}`);
      if ((data ?? []).length > 0) {
        await recordContractEvent(admin, {
          tenantId: contract.tenant_id,
          contractId: contract.id,
          actorId: null,
          kind: "refunded",
          meta: { refund_id: refundId },
        });
      }
      return true;
    }

    case "charge.dispute.created": {
      const dispute = event.data.object as Stripe.Dispute;
      const contract = await contractByPaymentIntent(admin, idOf(dispute.payment_intent));
      if (!contract) return false;
      console.error(
        `[creadores:contracargo] ALERTA contracargo ${dispute.id} sobre el contrato ${contract.id} (estado "${contract.status}", motivo ${dispute.reason}).`,
      );
      if (MONEY_HELD.has(contract.status)) {
        await freezeForMoneyBack(
          admin,
          contract,
          "chargeback",
          "El banco del negocio abrió un contracargo. El pago queda retenido hasta que se resuelva.",
          {},
        );
      }
      return true;
    }

    case "account.updated": {
      const account = event.data.object as Stripe.Account;
      const { data, error } = await db(admin)
        .from("connected_accounts")
        .select("owner_ref, owner_type")
        .eq("stripe_account_id", account.id)
        .maybeSingle();
      if (error) throw new Error(`select connected_accounts: ${error.code}`);
      const owner = data as { owner_ref: string; owner_type: string } | null;
      if (!owner || owner.owner_type !== "creator") return false;
      await syncConnectedAccount(admin, account);
      await retryPendingPayoutsFor({ admin, stripe: getStripe(), creatorId: owner.owner_ref });
      return true;
    }

    default:
      return false;
  }
}
