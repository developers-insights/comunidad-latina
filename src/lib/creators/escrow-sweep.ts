import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import {
  ESCROW_CONTRACT_COLUMNS,
  approveDelivery,
  attemptPayout,
  refundCanceledContract,
  type AdminClient,
  type EscrowContract,
  type PayoutResult,
} from "./escrow";

const BATCH = 50;

export interface SweepResult {
  autoApproved: number;
  released: number;
  blocked: number;
  failed: number;
  refunded: number;
}

function tally(result: SweepResult, payout: PayoutResult): void {
  if (payout.kind === "released") result.released += 1;
  else if (payout.kind === "blocked") result.blocked += 1;
  else if (payout.kind === "failed") result.failed += 1;
}

async function select(
  admin: AdminClient,
  build: (q: ReturnType<SupabaseClient["from"]>) => PromiseLike<{ data: unknown; error: { code?: string } | null }>,
  label: string,
): Promise<EscrowContract[]> {
  const { data, error } = await build((admin as unknown as SupabaseClient).from("gig_contracts"));
  if (error) throw new Error(`select gig_contracts (${label}): ${error.code}`);
  return (data ?? []) as EscrowContract[];
}

export async function runEscrowSweep(input: {
  admin: AdminClient;
  stripe: Stripe | null;
  now: Date;
}): Promise<SweepResult> {
  const { admin, stripe } = input;
  const nowIso = input.now.toISOString();
  const result: SweepResult = { autoApproved: 0, released: 0, blocked: 0, failed: 0, refunded: 0 };
  const touched = new Set<string>();

  const vencidas = await select(
    admin,
    (q) =>
      q
        .select(ESCROW_CONTRACT_COLUMNS)
        .eq("status", "delivered")
        .lte("review_deadline_at", nowIso)
        .order("review_deadline_at", { ascending: true })
        .limit(BATCH),
    "revisión vencida",
  );
  for (const contract of vencidas) {
    touched.add(contract.id);
    try {
      const approved = await approveDelivery({ admin, stripe, contract, via: "auto", actorId: null });
      if (approved.ok) {
        result.autoApproved += 1;
        tally(result, approved.payout);
      }
    } catch (error) {
      result.failed += 1;
      console.error(
        `[creadores:cron] no se pudo aprobar solo el contrato ${contract.id}: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  const aprobados = await select(
    admin,
    (q) =>
      q
        .select(ESCROW_CONTRACT_COLUMNS)
        .eq("status", "approved")
        .order("approved_at", { ascending: true })
        .limit(BATCH),
    "pagos pendientes",
  );
  for (const contract of aprobados) {
    if (touched.has(contract.id)) continue;
    try {
      tally(result, await attemptPayout({ admin, stripe, contractId: contract.id }));
    } catch (error) {
      result.failed += 1;
      console.error(
        `[creadores:cron] el pago del contrato ${contract.id} no se pudo reintentar: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  if (stripe) {
    const sinReembolso = await select(
      admin,
      (q) =>
        q
          .select(ESCROW_CONTRACT_COLUMNS)
          .eq("status", "canceled")
          .not("stripe_payment_intent_id", "is", null)
          .is("stripe_refund_id", null)
          .limit(BATCH),
      "reembolsos pendientes",
    );
    for (const contract of sinReembolso) {
      const refund = await refundCanceledContract(admin, stripe, contract);
      if (refund.ok) result.refunded += 1;
      else result.failed += 1;
    }
  }

  return result;
}
