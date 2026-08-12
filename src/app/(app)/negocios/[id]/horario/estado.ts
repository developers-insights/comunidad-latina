/**
 * Estado del formulario de horario, en su propio módulo.
 *
 * Mismo motivo que `src/app/(app)/negocios/resenas/estado.ts`: `./actions.ts`
 * lleva `"use server"` y de ahí sólo se pueden exportar funciones async
 * (`src/test/use-server-exports.test.ts` lo verifica y rompe el build si no).
 * El tipo y el valor inicial los comparten la action y el editor cliente.
 */

export type HorarioState =
  | { status: "idle" }
  | { status: "invalid" | "error"; message: string }
  | { status: "success"; message: string };

/** Lo que `useActionState` recibe antes del primer envío. */
export const HORARIO_STATE_INICIAL: HorarioState = { status: "idle" };
