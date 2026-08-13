/**
 * Estado del formulario de alta, en su propio archivo porque un módulo
 * `"use server"` sólo puede exportar funciones async — el valor inicial que
 * necesita `useActionState` no puede vivir en actions.ts.
 */
export type AltaState =
  | { estado: "inicial" }
  | { estado: "ok"; mensaje: string }
  | { estado: "error"; mensaje: string };

export const ALTA_INICIAL: AltaState = { estado: "inicial" };
