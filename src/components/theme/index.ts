/**
 * Sistema de tema (light / dark / system).
 *
 * Montaje (ya hecho en src/app/layout.tsx):
 *   <head><ThemeScript brandHex /></head> → estampa .light/.dark y el theme-color
 *                                           antes del primer paint
 *   <body>… <ThemeColorSync brandHex /> … → reafirma la clase de <html> tras un
 *                                           remonte y sigue al toggle en caliente
 *
 * Uso:
 *   <ThemeToggle />                       → sol↔luna (44×44) + "Seguir al sistema"
 *                                           al lado, sólo si hay preferencia explícita
 *   const { theme, resolvedTheme, setTheme, toggle } = useTheme();
 *
 * Regla: nadie escribe `dark:` ni toca `document.documentElement.classList`.
 * El tema vive en los tokens semánticos de globals.css.
 */

export { ThemeScript } from "./theme-script";
export { ThemeToggle } from "./theme-toggle";
export { ThemeColorSync } from "./theme-color-sync";
export { useTheme, type UseThemeResult } from "./use-theme";
export {
  DARK_THEME_COLOR,
  DEFAULT_THEME,
  THEME_STORAGE_KEY,
  type ResolvedTheme,
  type Theme,
} from "./constants";
