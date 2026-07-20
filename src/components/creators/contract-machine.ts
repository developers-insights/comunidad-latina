/**
 * Máquina de estados del contrato del Creator Marketplace (feedback cliente
 * 2026-07-19). Módulo PURO y sin dependencias de servidor ni de copy: se usa
 * idéntico en el server (para autorizar una transición antes de escribir con el
 * cliente admin) y en el cliente (para decidir qué botones mostrar). La verdad
 * de "quién puede disparar qué" vive acá y SOLO acá.
 *
 * Ciclo feliz de la garantía (escrow):
 *   proposed → funded → delivered → released
 * y sus ramas de salida:
 *   proposed/funded → canceled   ·   delivered → disputed
 *
 * NADIE que sea "parte" del contrato puede sacarlo de `disputed`: eso lo
 * resuelve el staff por fuera de esta UI (la disputa se muestra, no se opera).
 */

export type ContractStatus =
  | "proposed"
  | "funded"
  | "delivered"
  | "released"
  | "canceled"
  | "disputed";

/** Quién mira/opera el contrato, respecto de sus dos partes. */
export type ContractRole = "client" | "creator" | "other";

/** Acciones que puede disparar una parte (el staff no pasa por acá). */
export type ContractAction = "fund" | "deliver" | "release" | "cancel" | "dispute";

/** Columna de timestamp que la DB sella en esta transición (la escribe el server). */
export type ContractStamp =
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
 * - fund:    solo el CLIENTE, desde proposed → funded (deposita en garantía).
 * - deliver: solo el CREADOR, desde funded → delivered (entrega el trabajo).
 * - release: solo el CLIENTE, desde delivered → released (aprueba y libera).
 * - cancel:  proposed → canceled lo puede cualquiera de las dos partes;
 *            funded → canceled SOLO el cliente y SOLO antes de "delivered"
 *            (reembolso demo). Después de entregado ya no se cancela: se disputa.
 * - dispute: solo el CLIENTE, desde delivered → disputed (algo salió mal).
 */
export const TRANSITIONS: readonly TransitionRule[] = [
  { action: "fund", from: "proposed", to: "funded", role: "client", stamp: "funded_at" },
  { action: "deliver", from: "funded", to: "delivered", role: "creator", stamp: "delivered_at" },
  { action: "release", from: "delivered", to: "released", role: "client", stamp: "released_at" },
  { action: "cancel", from: "proposed", to: "canceled", role: "client", stamp: "canceled_at" },
  { action: "cancel", from: "proposed", to: "canceled", role: "creator", stamp: "canceled_at" },
  { action: "cancel", from: "funded", to: "canceled", role: "client", stamp: "canceled_at" },
  { action: "dispute", from: "delivered", to: "disputed", role: "client", stamp: null },
] as const;

/** Estados que ya no avanzan por acción de ninguna parte. */
const TERMINAL: ReadonlySet<ContractStatus> = new Set(["released", "canceled"]);

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

/** Los 4 hitos del ciclo feliz, en orden. canceled/disputed se pintan aparte. */
export const CONTRACT_STEPS: readonly ContractStatus[] = [
  "proposed",
  "funded",
  "delivered",
  "released",
] as const;

/**
 * Índice del hito actual dentro de CONTRACT_STEPS (0–3). Para los estados de
 * salida devuelve el hito donde el contrato se "salió del carril":
 *  - canceled: -1 si venía de proposed no llegó a garantía; el detalle lo
 *    resuelve con las fechas. Para el stepper alcanza con marcarlo terminal.
 *  - disputed: 2 (ocurre sobre "delivered").
 */
export function contractStepIndex(status: ContractStatus): number {
  switch (status) {
    case "proposed":
      return 0;
    case "funded":
      return 1;
    case "delivered":
      return 2;
    case "released":
      return 3;
    case "disputed":
      return 2;
    case "canceled":
      return -1;
  }
}
