/**
 * Máquina de estados del contrato del Creator Marketplace. Módulo puro: el
 * server la usa para autorizar antes de escribir con el cliente admin y la UI
 * para decidir qué botones mostrar. "Quién puede disparar qué" vive acá.
 *
 *   proposed → accepted → signed → funded → delivered → approved → released
 *                  ↑___________|                ↓↑
 *          (request_terms_changes)       changes_requested
 *
 * signed, approved y released los escribe el sistema (firma completa, webhook
 * de Stripe, ventana de revisión vencida, transferencia al creador). Las partes
 * sólo disparan lo que está en TRANSITIONS.
 */

export type ContractStatus =
  | "proposed"
  | "accepted"
  | "signed"
  | "funded"
  | "delivered"
  | "changes_requested"
  | "approved"
  | "released"
  | "canceled"
  | "disputed"
  | "rejected";

export type ContractRole = "client" | "creator" | "other";

export type ContractAction =
  | "accept"
  | "reject"
  | "request_terms_changes"
  | "fund"
  | "deliver"
  | "request_revision"
  | "approve"
  | "cancel"
  | "dispute";

export type SystemAction = "complete_signatures" | "fund_confirmed" | "auto_approve" | "release";

export type ContractStamp =
  | "accepted_at"
  | "rejected_at"
  | "signed_at"
  | "funded_at"
  | "delivered_at"
  | "changes_requested_at"
  | "approved_at"
  | "released_at"
  | "canceled_at"
  | null;

export interface TransitionRule {
  action: ContractAction;
  from: ContractStatus;
  to: ContractStatus;
  role: Exclude<ContractRole, "other">;
  stamp: ContractStamp;
}

export interface SystemTransitionRule {
  action: SystemAction;
  from: ContractStatus;
  to: ContractStatus;
  stamp: ContractStamp;
}

export const TRANSITIONS: readonly TransitionRule[] = [
  { action: "accept", from: "proposed", to: "accepted", role: "creator", stamp: "accepted_at" },
  { action: "request_terms_changes", from: "proposed", to: "proposed", role: "creator", stamp: null },
  { action: "reject", from: "proposed", to: "rejected", role: "creator", stamp: "rejected_at" },
  { action: "cancel", from: "proposed", to: "canceled", role: "client", stamp: "canceled_at" },

  { action: "request_terms_changes", from: "accepted", to: "proposed", role: "client", stamp: null },
  { action: "request_terms_changes", from: "accepted", to: "proposed", role: "creator", stamp: null },
  { action: "cancel", from: "accepted", to: "canceled", role: "client", stamp: "canceled_at" },
  { action: "cancel", from: "accepted", to: "canceled", role: "creator", stamp: "canceled_at" },

  { action: "fund", from: "signed", to: "funded", role: "client", stamp: "funded_at" },
  { action: "cancel", from: "signed", to: "canceled", role: "client", stamp: "canceled_at" },
  { action: "cancel", from: "signed", to: "canceled", role: "creator", stamp: "canceled_at" },

  { action: "deliver", from: "funded", to: "delivered", role: "creator", stamp: "delivered_at" },
  { action: "cancel", from: "funded", to: "canceled", role: "client", stamp: "canceled_at" },
  { action: "dispute", from: "funded", to: "disputed", role: "client", stamp: null },

  { action: "approve", from: "delivered", to: "approved", role: "client", stamp: "approved_at" },
  {
    action: "request_revision",
    from: "delivered",
    to: "changes_requested",
    role: "client",
    stamp: "changes_requested_at",
  },
  { action: "dispute", from: "delivered", to: "disputed", role: "client", stamp: null },

  { action: "deliver", from: "changes_requested", to: "delivered", role: "creator", stamp: "delivered_at" },
  { action: "dispute", from: "changes_requested", to: "disputed", role: "client", stamp: null },
  { action: "dispute", from: "changes_requested", to: "disputed", role: "creator", stamp: null },
] as const;

export const SYSTEM_TRANSITIONS: readonly SystemTransitionRule[] = [
  { action: "complete_signatures", from: "accepted", to: "signed", stamp: "signed_at" },
  { action: "fund_confirmed", from: "signed", to: "funded", stamp: "funded_at" },
  { action: "auto_approve", from: "delivered", to: "approved", stamp: "approved_at" },
  { action: "release", from: "approved", to: "released", stamp: "released_at" },
] as const;

const TERMINAL: ReadonlySet<ContractStatus> = new Set(["released", "canceled", "rejected"]);

export function isTerminalStatus(status: ContractStatus): boolean {
  return TERMINAL.has(status);
}

export function isMoneyFrozen(status: ContractStatus): boolean {
  return status === "disputed";
}

export function roleOf(
  userId: string | null | undefined,
  contract: { client_id: string; creator_id: string },
): ContractRole {
  if (!userId) return "other";
  if (userId === contract.client_id) return "client";
  if (userId === contract.creator_id) return "creator";
  return "other";
}

export function findTransition(
  role: ContractRole,
  from: ContractStatus,
  action: ContractAction,
): TransitionRule | null {
  if (role === "other") return null;
  return (
    TRANSITIONS.find((t) => t.action === action && t.from === from && t.role === role) ?? null
  );
}

export function allowedActions(role: ContractRole, status: ContractStatus): TransitionRule[] {
  if (role === "other") return [];
  return TRANSITIONS.filter((t) => t.from === status && t.role === role);
}

export function canSign(role: ContractRole, status: ContractStatus): boolean {
  return role !== "other" && status === "accepted";
}

export const CONTRACT_STEPS = ["propuesta", "contrato", "trabajo", "revision", "pago"] as const;
export type ContractStep = (typeof CONTRACT_STEPS)[number];

export function contractStepIndex(status: ContractStatus): number {
  switch (status) {
    case "proposed":
      return 0;
    case "accepted":
    case "signed":
      return 1;
    case "funded":
    case "changes_requested":
      return 2;
    case "delivered":
    case "disputed":
      return 3;
    case "approved":
    case "released":
      return 4;
    case "canceled":
    case "rejected":
      return -1;
  }
}

const KNOWN: ReadonlySet<string> = new Set<ContractStatus>([
  "proposed",
  "accepted",
  "signed",
  "funded",
  "delivered",
  "changes_requested",
  "approved",
  "released",
  "canceled",
  "disputed",
  "rejected",
]);

export function asContractStatus(raw: string): ContractStatus | null {
  return KNOWN.has(raw) ? (raw as ContractStatus) : null;
}
