/**
 * =============================================================================
 * EL VOCABULARIO DE UNA DECISIÓN SOBRE UNA SOLICITUD DE CREADOR
 * =============================================================================
 *
 * Vive en su propio módulo por dos razones, y las dos importan:
 *
 *  1. `actions.ts` lleva `"use server"`, y de un módulo así SOLO se pueden
 *     exportar funciones async. Exportar de ahí una constante rompe el build de
 *     Next entero — hay una guarda de regresión que lo verifica
 *     (`src/test/use-server-exports.test.ts`).
 *  2. La tarjeta es un Client Component y necesita los mismos números y los
 *     mismos valores. Duplicarlos a cada lado de la frontera sería garantizar
 *     que un día digan cosas distintas: el botón habilitado con 8 caracteres y
 *     el servidor pidiendo 10.
 *
 * Es un módulo sin dependencias y sin I/O: se importa igual desde el servidor y
 * desde el cliente.
 * =============================================================================
 */

/**
 * Los CUATRO valores que acepta el CHECK de
 * `public.admin_resolve_creator_activation` (migración 0032), exactos. No hay
 * traducción ni alias: lo que se manda es lo que la migración enumera, así que
 * un cambio allá rompe el tipo acá y no en producción.
 */
export const CREATOR_DECISIONS = ["approved", "needs_info", "rejected", "suspended"] as const;

export type CreatorDecision = (typeof CREATOR_DECISIONS)[number];

/** Mínimo de caracteres del motivo. "no" no es un motivo. */
export const NOTE_MIN_LENGTH = 10;

/** Tope del motivo — el mismo que valida la action con zod. */
export const NOTE_MAX_LENGTH = 500;

/**
 * ¿Esta decisión exige un motivo escrito?
 *
 * Aprobar no lo pide: nadie necesita que le expliquen un sí. Las otras tres sí,
 * porque del otro lado hay alguien que se queda sin saber qué hacer.
 */
export function decisionNeedsNote(decision: CreatorDecision): boolean {
  return decision !== "approved";
}
