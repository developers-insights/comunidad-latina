/**
 * Constantes compartidas entre el script pre-paint (server), el store (client)
 * y el root layout. Sin "use client": se importa desde los dos mundos.
 */

/** Lo que el usuario ELIGE. `system` = seguir al SO en vivo. */
export type Theme = "light" | "dark" | "system";
/** Lo que el usuario VE. Nunca `system`. */
export type ResolvedTheme = "light" | "dark";

/** Clave de localStorage. Cambiarla resetea la preferencia de todos. */
export const THEME_STORAGE_KEY = "cl-theme";

/** Sin preferencia guardada seguimos al sistema operativo. */
export const DEFAULT_THEME: Theme = "system";

/**
 * `--cl-dark-canvas` (= --color-neutral-900). Es el color de la barra de estado
 * del celular en dark: si acá quedara la marca del tenant, el teléfono pinta una
 * franja de color arriba de una app oscura.
 *
 * Debe coincidir con globals.css — lo verifica theme-tokens.test.ts.
 */
export const DARK_THEME_COLOR = "#17150F";

export const MEDIA_QUERY = "(prefers-color-scheme: dark)";

/** Evento propio: sincroniza todas las instancias del hook en la misma pestaña. */
export const THEME_CHANGE_EVENT = "cl:themechange";
