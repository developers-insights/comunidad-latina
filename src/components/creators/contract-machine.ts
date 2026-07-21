/**
 * Máquina de estados del contrato del Creator Marketplace. Módulo PURO y sin
 * dependencias de servidor ni de copy: se usa idéntico en el server (para
 * autorizar una transición antes de escribir con el cliente admin) y en el
 * cliente (para decidir qué botones mostrar). La verdad de "quién puede
 * disparar qué" vive acá y SOLO acá.
 *
 * El negocio PROPONE un contrato y el creador tiene que ACEPTARLO antes de que
 * se mueva nada: nadie deposita en garantía hasta que el creador aceptó.
 *
 * Ciclo feliz de la garantía (escrow):
 *   proposed → accepted → funded → delivered → released
 * y sus ramas de salida:
 *   proposed → rejected              (el creador rechaza la propuesta)
 *   proposed/accepted/funded → canceled
 *   delivered → disputed
 *
 * NADIE que sea "parte" del contrato puede sacarlo de `disputed`: eso lo
 * resuelve el staff por fuera de esta UI (la disputa se muestra, no se opera).
 */

export type ContractStatus =
  | "proposed"
  | "accepted"
  | "funded"
  | "delivered"
  | "released"
  | "canceled"
  | "disputed"
  | "rejected";

/** Quién mira/opera el contrato, respecto de sus dos partes. */
export type ContractRole = "client" | "creator" | "other";

/** Acciones que puede disparar una parte (el staff no pasa por acá). */
export type ContractAction =
  | "accept"
  | "reject"
  | "fund"
  | "deliver"
  | "release"
  | "cancel"
  | "dispute";

/** Columna de timestamp que la DB sella en esta transición (la escribe el server). */
export type ContractStamp =
  | "accepted_at"
  | "rejected_at"
  | "funded_at"
  | "delivered_at"
  | "released_at"
  | "canceled_at"
  | null;

export interface TransitionRule {
  action: ContractAction;
  from: ContractStatus;
  to: ContractStatus;
  /** La ÚNICA parte habilitada a disparar esta transición. */
  role: Exclude<ContractRole, "other">;
  stamp: ContractStamp;
}

/**
 * Tabla canónica de transiciones legales por parte. Es exhaustiva: cualquier
 * (rol, estado, acción) que no matchee acá está PROHIBIDO. Ordenada por el
 * ciclo feliz para que `allowedActions` devuelva los botones en orden natural.
 *
 * - accept:  solo el CREADOR, desde proposed → accepted (acepta la propuesta).
 * - fund:    solo el CLIENTE, desde accepted → funded (deposita en garantía).
 *            Ya NO se puede depositar desde 'proposed': primero hay que aceptar.
 * - deliver: solo el CREADOR, desde funded → delivered (entrega el trabajo).
 * - release: solo el CLIENTE, desde delivered → released (aprueba y libera).
 * - reject:  solo el CREADOR, desde proposed → rejected (única salida del
 *            creador en 'proposed'; reemplaza su vieja cancelación de propuesta).
 * - cancel:  proposed → canceled SOLO el cliente (retira su propia propuesta);
 *            accepted → canceled cualquiera de las dos partes (se echan atrás
 *            antes de depositar); funded → canceled SOLO el cliente y SOLO antes
 *            de "delivered" (reembolso demo). Entregado ya no se cancela: se disputa.
 * - dispute: solo el CLIENTE, desde delivered → disputed (algo salió mal).
 */
export const TRANSITIONS: readonly TransitionRule[] = [
  // Ciclo feliz: proposed → accepted → funded → delivered → released
  { action: "accept", from: "proposed", to: "accepted", role: "creator", stamp: "accepted_at" },
  { action: "fund", from: "accepted", to: "funded", role: "client", stamp: "funded_at" },
  { action: "deliver", from: "funded", to: "delivered", role: "creator", stamp: "delivered_at" },
  { action: "release", from: "delivered", to: "released", role: "client", stamp: "released_at" },
  // Rechazo del creador: única salida de 'proposed' para el creador (terminal).
  { action: "reject", from: "proposed", to: "rejected", role: "creator", stamp: "rejected_at" },
  // Cancelaciones antes de la entrega.
  { action: "cancel", from: "proposed", to: "canceled", role: "client", stamp: "canceled_at" },
  { action: "cancel", from: "accepted", to: "canceled", role: "client", stamp: "canceled_at" },
  { action: "cancel", from: "accepted", to: "canceled", role: "creator", stamp: "canceled_at" },
  { action: "cancel", from: "funded", to: "canceled", role: "client", stamp: "canceled_at" },
  // Disputa tras la entrega.
  { action: "dispute", from: "delivered", to: "disputed", role: "client", stamp: null },
] as const;

/** Estados que ya no avanzan por acción de ninguna parte. */
const TERMINAL: ReadonlySet<ContractStatus> = new Set(["released", "canceled", "rejected"]);

export function isTerminalStatus(status: ContractStatus): boolean {
  return TERMINAL.has(status);
}

/** ¿Quién es este usuario respecto del contrato? Server-controlled (auth.uid()). */
export function roleOf(
  userId: string | null | undefined,
  contract: { client_id: string; creator_id: string },
): ContractRole {
  if (!userId) return "other";
  if (userId === contract.client_id) return "client";
  if (userId === contract.creator_id) return "creator";
  return "other";
}

/**
 * Devuelve la regla si la transición (rol, estado, acción) es legal; si no,
 * `null`. El server la usa como AUTORIZACIÓN: sin regla, no escribe. `other`
 * (un tercero) nunca puede nada.
 */
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

/** Acciones que ESTE rol puede disparar en ESTE estado (para pintar botones). */
export function allowedActions(role: ContractRole, status: ContractStatus): TransitionRule[] {
  if (role === "other") return [];
  return TRANSITIONS.filter((t) => t.from === status && t.role === role);
}

// ---------------------------------------------------------------------------
// Stepper visual — el ciclo feliz como cápsulas de progreso
// ---------------------------------------------------------------------------

/** Los 5 hitos del ciclo feliz, en orden. canceled/disputed/rejected aparte. */
export const CONTRACT_STEPS: readonly ContractStatus[] = [
  "proposed",
  "accepted",
  "funded",
  "delivered",
  "released",
] as const;

/**
 * Índice del hito actual dentro de CONTRACT_STEPS (0–4). Para los estados de
 * salida devuelve el hito donde el contrato se "salió del carril":
 *  - disputed: 3 (ocurre sobre "delivered").
 *  - canceled/rejected: -1 (salieron del carril; el detalle lo cuentan las
 *    fechas). Para el stepper alcanza con marcarlos terminales.
 */
export function contractStepIndex(status: ContractStatus): number {
  switch (status) {
    case "proposed":
      return 0;
    case "accepted":
      return 1;
    case "funded":
      return 2;
    case "delivered":
      return 3;
    case "released":
      return 4;
    case "disputed":
      return 3;
    case "canceled":
    case "rejected":
      return -1;
  }
}
