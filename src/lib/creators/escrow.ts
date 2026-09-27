import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { createNotification } from "@/lib/notifications/notify";
import { crearCheckoutSessionIdempotente } from "@/lib/stripe/checkout";
import type { Database } from "@/lib/types/database.types";
import {
  GIG_PAYMENT_KIND,
  fundingDiscrepancy,
  gigTransferGroup,
  payoutAmountCents,
  payoutReadiness,
  refundIdempotencyKey,
  transferIdempotencyKey,
  checkoutIdempotencyKey,
} from "./gig-payments";
import { formatMoney } from "@/lib/utils";

export type AdminClient = SupabaseClient<Database>;

// Las columnas y tablas de 0165–0168 todavía no están en database.types.ts
// (se regenera cuando se aplican las migraciones): de ahí el cliente sin tipar.
function db(admin: AdminClient): SupabaseClient {
  return admin as unknown as SupabaseClient;
}

export const ESCROW_CONTRACT_COLUMNS =
  "id, tenant_id, code, client_id, creator_id, title, status, payment_mode, amount_cents, currency, fee_pct, platform_fee_cents, creator_net_cents, terms_version, stripe_checkout_session_id, stripe_payment_intent_id, stripe_charge_id, stripe_transfer_id, stripe_refund_id, review_deadline_at, approved_at, released_at, payout_error";

export interface EscrowContract {
  id: string;
  tenant_id: string;
  code: string;
  client_id: string;
  creator_id: string;
  title: string;
  status: string;
  payment_mode: string;
  amount_cents: number;
  currency: string;
  fee_pct: number;
  platform_fee_cents: number | null;
  creator_net_cents: number | null;
  terms_version: number;
  stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null;
  stripe_charge_id: string | null;
  stripe_transfer_id: string | null;
  stripe_refund_id: string | null;
  review_deadline_at: string | null;
  approved_at: string | null;
  released_at: string | null;
  payout_error: string | null;
}

export type ContractEventKind =
  | "proposed"
  | "terms_edited"
  | "terms_changes_requested"
  | "accepted"
  | "rejected"
  | "signed"
  | "fully_signed"
  | "checkout_opened"
  | "funded"
  | "payment_orphan_refunded"
  | "milestone_added"
  | "milestone_done"
  | "milestone_undone"
  | "delivered"
  | "revision_requested"
  | "approved"
  | "auto_approved"
  | "payout_blocked"
  | "payout_failed"
  | "released"
  | "disputed"
  | "chargeback"
  | "canceled"
  | "refunded";

export async function recordContractEvent(
  admin: AdminClient,
  event: {
    tenantId: string;
    contractId: string;
    actorId: string | null;
    kind: ContractEventKind;
    note?: string | null;
    meta?: Record<string, unknown>;
  },
): Promise<void> {
  const { error } = await db(admin).from("gig_contract_events").insert({
    tenant_id: event.tenantId,
    contract_id: event.contractId,
    actor_id: event.actorId,
    kind: event.kind,
    note: event.note ?? null,
    meta: event.meta ?? {},
  });
  if (error) {
    console.error(
      `[creadores:historial] no se pudo registrar "${event.kind}" en el contrato ${event.contractId} — code=${error.code}. La acción ya quedó hecha; falta su rastro.`,
    );
  }
}

export async function notifyContractParty(
  admin: AdminClient,
  input: {
    tenantId: string;
    profileId: string;
    contractId: string;
    title: string;
    body: string;
    money?: boolean;
  },
): Promise<void> {
  await createNotification(admin, {
    tenantId: input.tenantId,
    profileId: input.profileId,
    kind: input.money ? "payment" : "creator_deliverable",
    category: input.money ? "pagos" : "creator",
    ignorePrefs: input.money ?? false,
    title: input.title,
    body: input.body,
    href: `/creadores/colaboraciones/${input.contractId}`,
  });
}

function money(cents: number | null, currency: string): string {
  return formatMoney((cents ?? 0) / 100, { currency: currency.toUpperCase() });
}

export async function loadEscrowContract(
  admin: AdminClient,
  contractId: string,
): Promise<EscrowContract | null> {
  const { data, error } = await db(admin)
    .from("gig_contracts")
    .select(ESCROW_CONTRACT_COLUMNS)
    .eq("id", contractId)
    .maybeSingle();
  if (error) throw new Error(`select gig_contracts: ${error.code}`);
  return (data as EscrowContract | null) ?? null;
}

// ---------------------------------------------------------------------------
// Cobro al negocio
// ---------------------------------------------------------------------------

export type OpenCheckoutResult =
  | { ok: true; url: string }
  | { ok: false; reason: "status" | "processing" | "stripe" | "link" };

export async function openGigCheckout(input: {
  admin: AdminClient;
  stripe: Stripe;
  contract: EscrowContract;
  clientEmail: string | null;
  siteUrl: string;
}): Promise<OpenCheckoutResult> {
  const { admin, stripe, contract } = input;
  if (contract.status !== "signed") return { ok: false, reason: "status" };

  let previousSessionId: string | null = null;
  if (contract.stripe_checkout_session_id) {
    const previous = await stripe.checkout.sessions.retrieve(contract.stripe_checkout_session_id);
    if (previous.status === "open" && previous.url) return { ok: true, url: previous.url };
    if (previous.status === "complete") return { ok: false, reason: "processing" };
    previousSessionId = previous.id;
  }

  const metadata = {
    kind: GIG_PAYMENT_KIND,
    contract_id: contract.id,
    tenant_id: contract.tenant_id,
  };
  const base = `${input.siteUrl}/creadores/colaboraciones/${contract.id}`;

  const session = await crearCheckoutSessionIdempotente(
    {
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: input.clientEmail ?? undefined,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: contract.currency.toLowerCase(),
            unit_amount: contract.amount_cents,
            product_data: { name: `Colaboración ${contract.code} · ${contract.title}`.slice(0, 250) },
          },
        },
      ],
      payment_intent_data: {
        transfer_group: gigTransferGroup(contract.id),
        description: `Pago protegido ${contract.code}`,
        metadata,
      },
      metadata,
      success_url: `${base}?pago=exito`,
      cancel_url: `${base}?pago=cancelado`,
    },
    checkoutIdempotencyKey(contract.id, contract.terms_version, previousSessionId),
  );

  if (!session.url) {
    console.error(`[creadores:pago] Checkout sin URL para el contrato ${contract.id} (session ${session.id}).`);
    return { ok: false, reason: "stripe" };
  }

  const linkQuery = db(admin)
    .from("gig_contracts")
    .update({ stripe_checkout_session_id: session.id, checkout_opened_at: new Date().toISOString() })
    .eq("id", contract.id)
    .eq("status", "signed");
  const { data: linked, error: linkError } = await (previousSessionId
    ? linkQuery.or(`stripe_checkout_session_id.eq.${previousSessionId},stripe_checkout_session_id.eq.${session.id}`)
    : linkQuery.or(`stripe_checkout_session_id.is.null,stripe_checkout_session_id.eq.${session.id}`)
  ).select("id");

  if (linkError || (linked ?? []).length === 0) {
    console.error(
      `[creadores:pago] no se pudo vincular la session ${session.id} al contrato ${contract.id} (code=${linkError?.code ?? "sin fila"}). Se expira para que no quede un pago huérfano.`,
    );
    try {
      await stripe.checkout.sessions.expire(session.id);
    } catch (error) {
      console.error(
        `[creadores:pago] tampoco se pudo expirar la session ${session.id}; si se paga, el webhook la reembolsa sola.`,
        error instanceof Error ? error.message : error,
      );
    }
    return { ok: false, reason: "link" };
  }

  if (!previousSessionId || previousSessionId !== session.id) {
    await recordContractEvent(admin, {
      tenantId: contract.tenant_id,
      contractId: contract.id,
      actorId: contract.client_id,
      kind: "checkout_opened",
      meta: { session_id: session.id },
    });
  }
  return { ok: true, url: session.url };
}

async function chargeOf(
  stripe: Stripe,
  paymentIntentId: string,
): Promise<{ chargeId: string | null; receiptUrl: string | null }> {
  const intent = await stripe.paymentIntents.retrieve(paymentIntentId, { expand: ["latest_charge"] });
  const charge = intent.latest_charge;
  if (!charge) return { chargeId: null, receiptUrl: null };
  if (typeof charge === "string") return { chargeId: charge, receiptUrl: null };
  return { chargeId: charge.id, receiptUrl: charge.receipt_url ?? null };
}

function intentIdOf(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

async function refundOrphan(
  admin: AdminClient,
  stripe: Stripe,
  session: Stripe.Checkout.Session,
  contract: EscrowContract | null,
  motivo: string,
): Promise<void> {
  const paymentIntentId = intentIdOf(session.payment_intent);
  console.error(
    `[creadores:pago] ALERTA cobro que no se puede aplicar (session ${session.id}): ${motivo}. Se reembolsa completo.`,
  );
  if (!paymentIntentId) {
    console.error(`[creadores:pago] ALERTA la session ${session.id} no trae payment_intent: reembolsar a mano.`);
    return;
  }
  const refund = await stripe.refunds.create(
    {
      payment_intent: paymentIntentId,
      reason: "requested_by_customer",
      metadata: { kind: GIG_PAYMENT_KIND, orphan_session: session.id },
    },
    { idempotencyKey: `gig-orphan-refund:${paymentIntentId}` },
  );
  if (contract) {
    await recordContractEvent(admin, {
      tenantId: contract.tenant_id,
      contractId: contract.id,
      actorId: null,
      kind: "payment_orphan_refunded",
      note: motivo,
      meta: { session_id: session.id, refund_id: refund.id },
    });
    await notifyContractParty(admin, {
      tenantId: contract.tenant_id,
      profileId: contract.client_id,
      contractId: contract.id,
      money: true,
      title: "Te devolvimos un pago",
      body: `Recibimos un pago que ya no correspondía a esta colaboración y lo reembolsamos completo. Puede tardar unos días en verse en tu tarjeta.`,
    });
  }
}

export async function confirmGigFunding(
  admin: AdminClient,
  stripe: Stripe,
  session: Stripe.Checkout.Session,
): Promise<void> {
  if (session.payment_status !== "paid") return;

  const contractId = session.metadata?.contract_id ?? null;
  const contract = contractId ? await loadEscrowContract(admin, contractId) : null;
  const paymentIntentId = intentIdOf(session.payment_intent);

  if (!contract) {
    await refundOrphan(admin, stripe, session, null, `el contrato ${contractId ?? "(sin id)"} no existe`);
    return;
  }

  if (paymentIntentId && contract.stripe_payment_intent_id === paymentIntentId) return;

  const discrepancia = fundingDiscrepancy(
    {
      id: session.id,
      amount_total: session.amount_total,
      currency: session.currency,
      metadata: (session.metadata ?? {}) as Record<string, string>,
    },
    contract,
  );
  if (contract.status !== "signed" || discrepancia || !paymentIntentId) {
    await refundOrphan(
      admin,
      stripe,
      session,
      contract,
      discrepancia ?? (paymentIntentId ? `el contrato está "${contract.status}", no esperando pago` : "sin payment_intent"),
    );
    return;
  }

  let chargeId: string | null = null;
  let receiptUrl: string | null = null;
  try {
    ({ chargeId, receiptUrl } = await chargeOf(stripe, paymentIntentId));
  } catch (error) {
    console.error(
      `[creadores:pago] no se pudo leer el cargo de ${paymentIntentId}; se acredita igual y el cargo se busca al transferir.`,
      error instanceof Error ? error.message : error,
    );
  }

  const { data: funded, error } = await db(admin)
    .from("gig_contracts")
    .update({
      status: "funded",
      funded_at: new Date().toISOString(),
      payment_mode: "stripe",
      stripe_payment_intent_id: paymentIntentId,
      stripe_charge_id: chargeId,
      stripe_receipt_url: receiptUrl,
    })
    .eq("id", contract.id)
    .eq("status", "signed")
    .eq("stripe_checkout_session_id", session.id)
    .select("id");
  if (error) throw new Error(`update gig_contracts (fund): ${error.code}`);

  if ((funded ?? []).length === 0) {
    const fresh = await loadEscrowContract(admin, contract.id);
    if (fresh?.stripe_payment_intent_id === paymentIntentId) return;
    await refundOrphan(admin, stripe, session, fresh, `el contrato cambió a "${fresh?.status ?? "?"}" mientras se acreditaba`);
    return;
  }

  await recordContractEvent(admin, {
    tenantId: contract.tenant_id,
    contractId: contract.id,
    actorId: null,
    kind: "funded",
    meta: { payment_intent: paymentIntentId, amount_cents: contract.amount_cents },
  });
  await notifyContractParty(admin, {
    tenantId: contract.tenant_id,
    profileId: contract.creator_id,
    contractId: contract.id,
    money: true,
    title: "¡El pago está protegido! Ya podés empezar",
    body: `El negocio pagó ${money(contract.amount_cents, contract.currency)} y quedan retenidos hasta que apruebe tu entrega. Vos recibís ${money(contract.creator_net_cents, contract.currency)}.`,
  });
  await notifyContractParty(admin, {
    tenantId: contract.tenant_id,
    profileId: contract.client_id,
    contractId: contract.id,
    money: true,
    title: "Pago confirmado",
    body: `Tu pago de ${money(contract.amount_cents, contract.currency)} quedó protegido. Se libera cuando apruebes el trabajo.`,
  });
}

export async function releaseAbandonedCheckout(
  admin: AdminClient,
  session: Stripe.Checkout.Session,
): Promise<void> {
  const contractId = session.metadata?.contract_id;
  if (!contractId) return;
  const { error } = await db(admin)
    .from("gig_contracts")
    .update({ stripe_checkout_session_id: null })
    .eq("id", contractId)
    .eq("status", "signed")
    .eq("stripe_checkout_session_id", session.id);
  if (error) throw new Error(`update gig_contracts (checkout vencido): ${error.code}`);
}

// ---------------------------------------------------------------------------
// Aprobación y transferencia al creador
// ---------------------------------------------------------------------------

export async function approveDelivery(input: {
  admin: AdminClient;
  stripe: Stripe | null;
  contract: EscrowContract;
  via: "client" | "auto";
  actorId: string | null;
}): Promise<{ ok: true; payout: PayoutResult } | { ok: false; stale: true }> {
  const { admin, contract, via } = input;
  const now = new Date().toISOString();
  let query = db(admin)
    .from("gig_contracts")
    .update({ status: "approved", approved_at: now, approved_via: via, review_deadline_at: null })
    .eq("id", contract.id)
    .eq("status", "delivered");
  if (via === "auto") query = query.lte("review_deadline_at", now);
  const { data, error } = await query.select("id");
  if (error) throw new Error(`update gig_contracts (approve): ${error.code}`);
  if ((data ?? []).length === 0) return { ok: false, stale: true };

  await recordContractEvent(admin, {
    tenantId: contract.tenant_id,
    contractId: contract.id,
    actorId: input.actorId,
    kind: via === "auto" ? "auto_approved" : "approved",
  });
  if (via === "auto") {
    await notifyContractParty(admin, {
      tenantId: contract.tenant_id,
      profileId: contract.client_id,
      contractId: contract.id,
      title: "Se venció el período de revisión",
      body: "Pasaron 72 horas desde la entrega sin respuesta, así que la aprobamos y liberamos el pago al creador, como dice el contrato.",
    });
  }

  const payout = await attemptPayout({ admin, stripe: input.stripe, contractId: contract.id });
  return { ok: true, payout };
}

export type PayoutResult =
  | { kind: "released"; demo: boolean }
  | { kind: "blocked"; readiness: "missing" | "incomplete" }
  | { kind: "failed"; message: string }
  | { kind: "skipped"; status: string };

const PAYOUT_BLOCKED_COPY = {
  missing: "El creador todavía no configuró dónde cobrar.",
  incomplete: "La cuenta de cobro del creador todavía no está habilitada por Stripe.",
} as const;

export async function syncConnectedAccount(admin: AdminClient, account: Stripe.Account): Promise<void> {
  const capabilities = (account.capabilities ?? {}) as Record<string, string>;
  const disabledReason = account.requirements?.disabled_reason ?? null;
  const verification =
    capabilities.transfers === "active"
      ? "verified"
      : disabledReason?.startsWith("rejected")
        ? "disabled"
        : disabledReason
          ? "restricted"
          : "pending";
  const { error } = await db(admin)
    .from("connected_accounts")
    .update({
      details_submitted: account.details_submitted ?? false,
      charges_enabled: account.charges_enabled ?? false,
      payouts_enabled: account.payouts_enabled ?? false,
      requirements_due: account.requirements?.currently_due ?? [],
      requirements_past_due: account.requirements?.past_due ?? [],
      disabled_reason: disabledReason,
      capabilities,
      verification_status: verification,
      verification_updated_at: new Date().toISOString(),
      last_synced_at: new Date().toISOString(),
    })
    .eq("stripe_account_id", account.id);
  if (error) throw new Error(`update connected_accounts: ${error.code}`);
}

async function creatorAccount(
  admin: AdminClient,
  creatorId: string,
): Promise<{ stripe_account_id: string | null; capabilities: unknown } | null> {
  const { data, error } = await db(admin)
    .from("connected_accounts")
    .select("stripe_account_id, capabilities")
    .eq("owner_type", "creator")
    .eq("owner_ref", creatorId)
    .maybeSingle();
  if (error) throw new Error(`select connected_accounts: ${error.code}`);
  return (data as { stripe_account_id: string | null; capabilities: unknown } | null) ?? null;
}

async function markPayoutProblem(
  admin: AdminClient,
  contract: EscrowContract,
  message: string,
  kind: "payout_blocked" | "payout_failed",
): Promise<void> {
  const { error } = await db(admin)
    .from("gig_contracts")
    .update({ payout_error: message.slice(0, 500), payout_attempted_at: new Date().toISOString() })
    .eq("id", contract.id)
    .eq("status", "approved");
  if (error) {
    console.error(`[creadores:cobro] no se pudo anotar el motivo del pago pendiente en ${contract.id} — code=${error.code}.`);
  }
  if (contract.payout_error === message) return;

  await recordContractEvent(admin, {
    tenantId: contract.tenant_id,
    contractId: contract.id,
    actorId: null,
    kind,
    note: message,
  });
  if (kind === "payout_blocked") {
    await notifyContractParty(admin, {
      tenantId: contract.tenant_id,
      profileId: contract.creator_id,
      contractId: contract.id,
      money: true,
      title: "Tu pago está aprobado: falta un paso para cobrarlo",
      body: `Tenés ${money(contract.creator_net_cents, contract.currency)} esperándote. Configurá tu cuenta de cobro y te lo transferimos al toque.`,
    });
  }
}

export async function attemptPayout(input: {
  admin: AdminClient;
  stripe: Stripe | null;
  contractId: string;
}): Promise<PayoutResult> {
  const { admin, stripe } = input;
  const contract = await loadEscrowContract(admin, input.contractId);
  if (!contract) return { kind: "skipped", status: "missing" };
  if (contract.status !== "approved") return { kind: "skipped", status: contract.status };

  const isDemo = contract.payment_mode !== "stripe" || !contract.stripe_payment_intent_id;
  if (isDemo) {
    return finishRelease(admin, contract, null, true);
  }
  if (!stripe) {
    await markPayoutProblem(admin, contract, "Stripe no está configurado en el servidor.", "payout_failed");
    return { kind: "failed", message: "stripe_not_configured" };
  }

  const amount = payoutAmountCents(contract);
  if (amount === null) {
    console.error(
      `[creadores:cobro] ALERTA neto imposible en ${contract.id}: amount=${contract.amount_cents} net=${contract.creator_net_cents}. No se transfiere.`,
    );
    await markPayoutProblem(admin, contract, "El neto del contrato no es válido. Lo revisa el equipo.", "payout_failed");
    return { kind: "failed", message: "invalid_amount" };
  }

  try {
    let account = await creatorAccount(admin, contract.creator_id);
    if (account?.stripe_account_id) {
      const live = await stripe.accounts.retrieve(account.stripe_account_id);
      await syncConnectedAccount(admin, live);
      account = { stripe_account_id: live.id, capabilities: live.capabilities ?? {} };
    }
    const readiness = payoutReadiness(account);
    if (readiness !== "ready") {
      await markPayoutProblem(admin, contract, PAYOUT_BLOCKED_COPY[readiness], "payout_blocked");
      return { kind: "blocked", readiness };
    }
    const destination = account!.stripe_account_id!;

    let chargeId = contract.stripe_charge_id;
    if (!chargeId) {
      chargeId = (await chargeOf(stripe, contract.stripe_payment_intent_id!)).chargeId;
    }
    if (!chargeId) {
      await markPayoutProblem(admin, contract, "Stripe todavía no confirmó el cargo del pago.", "payout_failed");
      return { kind: "failed", message: "no_charge" };
    }

    const group = gigTransferGroup(contract.id);
    const existing = await stripe.transfers.list({ transfer_group: group, limit: 10 });
    let transfer = existing.data.find((t) => t.metadata?.contract_id === contract.id && !t.reversed) ?? null;
    if (!transfer) {
      transfer = await stripe.transfers.create(
        {
          amount,
          currency: contract.currency.toLowerCase(),
          destination,
          source_transaction: chargeId,
          transfer_group: group,
          description: `Colaboración ${contract.code}`,
          metadata: { kind: GIG_PAYMENT_KIND, contract_id: contract.id, tenant_id: contract.tenant_id },
        },
        { idempotencyKey: transferIdempotencyKey(contract.id) },
      );
    }
    return finishRelease(admin, contract, transfer.id, false);
  } catch (error) {
    const message = error instanceof Error ? error.message : "error desconocido";
    console.error(`[creadores:cobro] la transferencia del contrato ${contract.id} falló: ${message}`);
    await markPayoutProblem(admin, contract, `Stripe rechazó la transferencia: ${message}`, "payout_failed");
    return { kind: "failed", message };
  }
}

async function finishRelease(
  admin: AdminClient,
  contract: EscrowContract,
  transferId: string | null,
  demo: boolean,
): Promise<PayoutResult> {
  const { data, error } = await db(admin)
    .from("gig_contracts")
    .update({
      status: "released",
      released_at: new Date().toISOString(),
      stripe_transfer_id: transferId,
      payout_error: null,
      payout_attempted_at: new Date().toISOString(),
    })
    .eq("id", contract.id)
    .eq("status", "approved")
    .select("id");
  if (error) {
    if (transferId) {
      console.error(
        `[creadores:cobro] ALERTA la transferencia ${transferId} salió pero el contrato ${contract.id} no se pudo marcar liberado (code=${error.code}). El próximo intento la reencuentra por transfer_group.`,
      );
    }
    throw new Error(`update gig_contracts (release): ${error.code}`);
  }
  if ((data ?? []).length === 0) return { kind: "skipped", status: "raced" };

  await recordContractEvent(admin, {
    tenantId: contract.tenant_id,
    contractId: contract.id,
    actorId: null,
    kind: "released",
    meta: { transfer_id: transferId, amount_cents: contract.creator_net_cents, demo },
  });
  await notifyContractParty(admin, {
    tenantId: contract.tenant_id,
    profileId: contract.creator_id,
    contractId: contract.id,
    money: true,
    title: "¡Pago liberado!",
    body: demo
      ? `Se liberaron ${money(contract.creator_net_cents, contract.currency)} (modo demostración: no se movió dinero).`
      : `Te transferimos ${money(contract.creator_net_cents, contract.currency)}. Stripe lo deposita en tu banco según el calendario de tu cuenta.`,
  });
  await notifyContractParty(admin, {
    tenantId: contract.tenant_id,
    profileId: contract.client_id,
    contractId: contract.id,
    title: "Colaboración cerrada",
    body: "El pago ya se liberó al creador. Contanos cómo te fue dejándole una reseña.",
  });
  return { kind: "released", demo };
}

// ---------------------------------------------------------------------------
// Cancelación con reembolso
// ---------------------------------------------------------------------------

export async function refundCanceledContract(
  admin: AdminClient,
  stripe: Stripe,
  contract: EscrowContract,
): Promise<{ ok: boolean }> {
  if (contract.status !== "canceled" || !contract.stripe_payment_intent_id || contract.stripe_refund_id) {
    return { ok: true };
  }
  try {
    const refund = await stripe.refunds.create(
      {
        payment_intent: contract.stripe_payment_intent_id,
        reason: "requested_by_customer",
        metadata: { kind: GIG_PAYMENT_KIND, contract_id: contract.id },
      },
      { idempotencyKey: refundIdempotencyKey(contract.id) },
    );
    const { data: anotado, error } = await db(admin)
      .from("gig_contracts")
      .update({ stripe_refund_id: refund.id })
      .eq("id", contract.id)
      .is("stripe_refund_id", null)
      .select("id");
    if (error) {
      console.error(
        `[creadores:reembolso] el reembolso ${refund.id} salió pero no se anotó en ${contract.id} — code=${error.code}. El reintento usa la misma clave y no duplica.`,
      );
      return { ok: false };
    }
    if ((anotado ?? []).length === 0) return { ok: true };
    await recordContractEvent(admin, {
      tenantId: contract.tenant_id,
      contractId: contract.id,
      actorId: null,
      kind: "refunded",
      meta: { refund_id: refund.id, amount_cents: contract.amount_cents },
    });
    await notifyContractParty(admin, {
      tenantId: contract.tenant_id,
      profileId: contract.client_id,
      contractId: contract.id,
      money: true,
      title: "Te devolvimos el pago",
      body: `Reembolsamos ${money(contract.amount_cents, contract.currency)} a tu tarjeta. Puede tardar entre 5 y 10 días hábiles en verse.`,
    });
    return { ok: true };
  } catch (error) {
    console.error(
      `[creadores:reembolso] ALERTA el contrato ${contract.id} está cancelado y el reembolso falló: ${error instanceof Error ? error.message : error}. El cron lo reintenta cada hora.`,
    );
    return { ok: false };
  }
}

// ---------------------------------------------------------------------------
// Cuenta de cobro del creador (Stripe Connect, dashboard Express)
// ---------------------------------------------------------------------------

export async function ensureCreatorConnectedAccount(input: {
  admin: AdminClient;
  stripe: Stripe;
  tenantId: string;
  profileId: string;
  email: string | null;
}): Promise<string> {
  const { admin, stripe } = input;
  const existing = await creatorAccount(admin, input.profileId);
  if (existing?.stripe_account_id) return existing.stripe_account_id;

  const account = await stripe.accounts.create(
    {
      controller: {
        stripe_dashboard: { type: "express" },
        fees: { payer: "application" },
        losses: { payments: "application" },
        requirement_collection: "stripe",
      },
      capabilities: { transfers: { requested: true } },
      email: input.email ?? undefined,
      metadata: { tenant_id: input.tenantId, profile_id: input.profileId, owner_type: "creator" },
    },
    { idempotencyKey: `gig-connect:${input.profileId}` },
  );

  const { error } = await db(admin)
    .from("connected_accounts")
    .upsert(
      {
        tenant_id: input.tenantId,
        owner_type: "creator",
        owner_ref: input.profileId,
        stripe_account_id: account.id,
        capabilities: account.capabilities ?? {},
        last_synced_at: new Date().toISOString(),
      },
      { onConflict: "owner_type,owner_ref" },
    );
  if (error) {
    throw new Error(
      `upsert connected_accounts (${account.id}): ${error.code}. La cuenta existe en Stripe; el reintento la recupera por la misma clave de idempotencia.`,
    );
  }
  return account.id;
}

export async function retryPendingPayoutsFor(input: {
  admin: AdminClient;
  stripe: Stripe;
  creatorId: string;
}): Promise<PayoutResult[]> {
  const { data, error } = await db(input.admin)
    .from("gig_contracts")
    .select("id")
    .eq("creator_id", input.creatorId)
    .eq("status", "approved")
    .order("approved_at", { ascending: true })
    .limit(10);
  if (error) throw new Error(`select gig_contracts (pendientes): ${error.code}`);
  const results: PayoutResult[] = [];
  for (const row of (data ?? []) as { id: string }[]) {
    results.push(await attemptPayout({ admin: input.admin, stripe: input.stripe, contractId: row.id }));
  }
  return results;
}
