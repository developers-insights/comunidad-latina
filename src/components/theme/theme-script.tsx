import { themeScriptSource } from "./theme-script-source";

/**
 * Script anti-FOUC. Corre SINCRÓNICAMENTE mientras el browser parsea el <head>,
 * o sea ANTES del primer paint: estampa `light` o `dark` en <html> y deja el
 * `<meta name="theme-color">` en el color del tema RESUELTO (no el del SO).
 *
 * Por qué inline y no `next/script` ni un efecto de React: `useEffect` corre
 * después de la hidratación Y del paint → el usuario ve un flash blanco;
 * `useLayoutEffect` corre antes del paint pero después de que React cargó → en
 * un Android lento el HTML del server ya se pintó. El único momento
 * suficientemente temprano es el parseo del HTML.
 *
 * Ref: node_modules/next/dist/docs/01-app/02-guides/preventing-flash-before-hydration.md
 * (sección "Themes"), que prescribe exactamente `<script dangerouslySetInnerHTML>`
 * dentro del <head> del root layout, con `suppressHydrationWarning` en <html>.
 *
 * Lo único que entra del request es `brandHex`, y `themeScriptSource()` lo pasa
 * por un allowlist `^#[0-9a-f]{6}$` antes de interpolarlo: sin eso, un tenant
 * podría cerrar el `</script>` desde adentro del literal.
 *
 * CSP: next.config.ts sirve `script-src 'self' 'unsafe-inline'` (report-only).
 * Si algún día pasa a enforcing sin 'unsafe-inline', este script necesita nonce.
 */
export function ThemeScript({ brandHex }: { brandHex: string }) {
  return <script dangerouslySetInnerHTML={{ __html: themeScriptSource(brandHex) }} />;
}
