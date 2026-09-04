import {
  HELP_REVIEW_NOTE_MAX,
  HELP_REVIEW_NOTE_MIN,
  type HelpReplyStatus,
  type HelpStatus,
} from "@/lib/comunidad";

/**
 * =============================================================================
 * EL VOCABULARIO DE UNA DECISIÓN DE MODERACIÓN
 * =============================================================================
 *
 * Vive en su propio módulo por las mismas dos razones que su hermano de
 * solicitudes de creador (`admin/creadores/solicitudes/decisiones.ts`):
 *
 *  1. `actions.ts` lleva `"use server"`, y de un módulo así SOLO se pueden
 *     exportar funciones async. Exportar de ahí una constante rompe el build de
 *     Next entero — hay una guarda de regresión que lo verifica
 *     (`src/test/use-server-exports.test.ts`).
 *  2. Las tarjetas son Client Components y necesitan los mismos valores y los
 *     mismos números. Duplicarlos a cada lado de la frontera sería garantizar
 *     que un día digan cosas distintas: el botón habilitado con 8 caracteres y
 *     el servidor pidiendo 10.
 *
 * Es un módulo sin dependencias de I/O: se importa igual desde el servidor y
 * desde el cliente.
 * =============================================================================
 */

/**
 * Los TRES estados a los que el equipo puede mover un pedido, en el orden en
 * que aparecen los botones.
 *
 * Es un subconjunto de `HELP_STATUSES`, no una lista paralela: `draft` y
 * `pending` no están porque no son decisiones del equipo. Lo que se puede mover
 * DESDE cada estado lo decide `puedeTransicionar(…, "staff")`, que es el espejo
 * del trigger — acá sólo vive el vocabulario.
 *
 * ── CAMBIÓ QUÉ SIGNIFICAN, NO CUÁLES SON ────────────────────────────────────
 * Con la 0120 esto era una cola de admisión: `approved` = "lo dejamos entrar".
 * Con la 0130 el pedido nace publicado, así que ahora `rejected` es OCULTAR y
 * `approved` es RESTAURAR. Los valores no se tocaron —hay filas viejas con
 * cada uno— pero las etiquetas de la pantalla sí, porque decían lo que ya no
 * pasa.
 */
export const HELP_DECISIONS = ["approved", "rejected", "archived"] as const;
export type HelpDecision = (typeof HELP_DECISIONS)[number];

export function isHelpDecision(value: unknown): value is HelpDecision {
  return typeof value === "string" && (HELP_DECISIONS as readonly string[]).includes(value);
}

/** Las dos cosas que el equipo puede hacerle a una respuesta. */
export const REPLY_DECISIONS = ["hidden", "visible"] as const;
export type ReplyDecision = (typeof REPLY_DECISIONS)[number];

export function isReplyDecision(value: unknown): value is ReplyDecision {
  return typeof value === "string" && (REPLY_DECISIONS as readonly string[]).includes(value);
}

export const NOTA_MIN = HELP_REVIEW_NOTE_MIN;
export const NOTA_MAX = HELP_REVIEW_NOTE_MAX;

/**
 * ¿Esta decisión exige un motivo escrito?
 *
 * Restaurar no lo pide: nadie necesita que le expliquen que su pedido volvió.
 * Ocultar sí, y con más razón que antes: el pedido ESTUVO PUBLICADO y la
 * persona lo vio en el tablón. Que un día no esté, sin explicación, es lo que
 * hace que alguien deje de usar la sección. Ese motivo se le muestra en "Mis
 * pedidos".
 *
 * Bajarlo (`archived`) también lo pide, por lo mismo.
 */
export function decisionNecesitaNota(decision: HelpDecision): boolean {
  return decision !== "approved";
}

/** Desde qué estados tiene sentido decidir. Espeja las transiciones de staff. */
export const ESTADOS_RESOLVIBLES: readonly HelpStatus[] = ["pending", "approved", "rejected"];

/** Ídem para una respuesta: de `deleted` no sale nada. */
export const ESTADOS_DE_RESPUESTA_RESOLVIBLES: readonly HelpReplyStatus[] = ["visible", "hidden"];
