import type { TipoDeFotoDeNegocio } from "@/lib/negocios/pagina";

/**
 * Estados de las tres acciones de esta pantalla, en su propio archivo porque
 * un módulo `"use server"` sólo puede exportar funciones async — el valor
 * inicial que necesita `useActionState` no puede vivir en `actions.ts` (lo
 * cuida `src/app/admin/use-server-exports.test.ts`, y ya rompió la build dos
 * veces en este repo).
 */
export type EditarPaginaState =
  | { estado: "inicial" }
  | { estado: "ok"; mensaje: string }
  /** El formulario tiene datos mal: el mensaje apunta al campo cuando puede. */
  | { estado: "error"; mensaje: string; campo?: string };

export const EDITAR_PAGINA_INICIAL: EditarPaginaState = { estado: "inicial" };

/**
 * Resultado de subir o quitar una foto. Devuelve la URL pública ya resuelta
 * para que el formulario pinte el cambio sin volver a consultar la base.
 */
export type FotoDeNegocioResultado =
  | { ok: true; tipo: TipoDeFotoDeNegocio; url: string | null }
  | { ok: false; mensaje: string };
