/**
 * =============================================================================
 * EL VOCABULARIO DE UNA DECISIÓN SOBRE UN AVISO DE AYUDA MUTUA
 * =============================================================================
 *
 * Vive en su propio módulo por las mismas dos razones que su hermano de
 * solicitudes de creador (`admin/creadores/solicitudes/decisiones.ts`):
 *
 *  1. `actions.ts` lleva `"use server"`, y de un módulo así SOLO se pueden
 *     exportar funciones async. Exportar de ahí una constante rompe el build de
 *     Next entero — hay una guarda de regresión que lo verifica
 *     (`src/test/use-server-exports.test.ts`).
 *  2. La tarjeta es un Client Component y necesita los mismos valores y los
 *     mismos números. Duplicarlos a cada lado de la frontera sería garantizar
 *     que un día digan cosas distintas: el botón habilitado con 8 caracteres y
 *     el servidor pidiendo 10.
 *
 * Es un módulo sin dependencias de I/O: se importa igual desde el servidor y
 * desde el cliente.
 * =============================================================================
 */

import { HELP_REVIEW_NOTE_MAX, HELP_REVIEW_NOTE_MIN, type HelpStatus } from "@/lib/comunidad";

/**
 * Los TRES estados a los que el equipo puede mover un aviso, exactos y en el
 * orden en que aparecen los botones.
 *
 * Es un subconjunto de `HELP_STATUSES`, no una lista paralela: `draft` y
 * `pending` no están porque no son decisiones del equipo (el primero es del
 * autor, el segundo es de dónde salen todos). Lo que se puede mover DESDE cada
 * estado lo decide `puedeTransicionar(…, "staff")`, que es el espejo del
 * trigger de la 0120 — acá sólo vive el vocabulario.
 */
export const HELP_DECISIONS = ["approved", "rejected", "archived"] as const;
export type HelpDecision = (typeof HELP_DECISIONS)[number];

export function isHelpDecision(value: unknown): value is HelpDecision {
  return typeof value === "string" && (HELP_DECISIONS as readonly string[]).includes(value);
}

export const NOTA_MIN = HELP_REVIEW_NOTE_MIN;
export const NOTA_MAX = HELP_REVIEW_NOTE_MAX;

/**
 * ¿Esta decisión exige un motivo escrito?
 *
 * Aprobar no lo pide: nadie necesita que le expliquen un sí. Rechazar sí,
 * porque del otro lado hay alguien que se ofreció a ayudar y se queda sin
 * saber qué hacer con su aviso — y a diferencia de otras colas de este panel,
 * acá el motivo SÍ le llega: se muestra en "Mis avisos", junto al botón de
 * corregir. Un rechazo mudo en esta sección es una persona que deja de
 * intentar.
 *
 * Bajar del tablón algo ya publicado también lo pide: el aviso estuvo a la
 * vista y su autor merece saber por qué dejó de estarlo.
 */
export function decisionNecesitaNota(decision: HelpDecision): boolean {
  return decision !== "approved";
}

/** Desde qué estados tiene sentido decidir. Espeja las transiciones de staff. */
export const ESTADOS_RESOLVIBLES: readonly HelpStatus[] = ["pending", "approved", "rejected"];
