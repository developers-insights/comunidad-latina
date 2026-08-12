/**
 * Estado del formulario de reseñas, en su propio módulo.
 *
 * No está acá por prolijidad: `./actions.ts` lleva `"use server"`, y de un
 * archivo así sólo se pueden exportar funciones async — lo verifica
 * `src/test/use-server-exports.test.ts`, que rompe el build si aparece una
 * constante. El tipo y el valor inicial los necesitan tanto la action como los
 * componentes cliente, así que viven donde los dos pueden importarlos.
 *
 * Mismo criterio que `src/app/admin/creadores/solicitudes/decisiones.ts`.
 */

export type ResenaState =
  | { status: "idle" }
  | { status: "invalid" | "error"; message: string }
  | { status: "success"; message: string };

/** Lo que `useActionState` recibe antes del primer envío. */
export const RESENA_STATE_INICIAL: ResenaState = { status: "idle" };
