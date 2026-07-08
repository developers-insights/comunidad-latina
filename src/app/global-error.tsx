"use client";

/**
 * global-error (§3.5): último recurso — se muestra si falla el ROOT layout,
 * o sea cuando el design system (globals.css, fuentes, providers) puede no
 * existir. Por eso es 100 % autónomo: HTML propio, un <style> inline, cero
 * imports de componentes y cero JS.
 *
 * ── Tema oscuro sin depender de nada ──────────────────────────────────────
 * Acá no hay Tailwind ni tokens: `globals.css` lo importa el root layout, que es
 * exactamente lo que se acaba de romper. Los valores de abajo son copia literal
 * de las dos paletas de globals.css (`--cl-light-*` / `--cl-dark-*`).
 *
 * Se resuelve por CASCADA, no por JS — el store de tema, el provider y hasta la
 * hidratación pueden no existir cuando esto renderiza (y puede renderizar en el
 * server). El <style> cubre los tres casos, igual que globals.css:
 *   1. `.dark`  en <html> → oscuro (la estampó el script pre-paint, si llegó a correr)
 *   2. `.light` en <html> → claro forzado
 *   3. sin clase          → manda el SO (`@media (prefers-color-scheme: dark)`)
 * Resultado: un error jamás cambia el tema debajo del usuario, y si el árbol se
 * rompió antes del script pre-paint, un celular en dark igual ve una pantalla
 * oscura — nunca el flash blanco cegador que había antes.
 *
 * Por qué NO `light-dark()`: pide Chrome 123 / Safari 17.5 / Firefox 120 y el
 * piso soportado por Next 16 es Chrome 111 / Safari 16.4 / Firefox 111
 * (node_modules/next/dist/docs/03-architecture/supported-browsers.md). Misma
 * decisión —y mismo motivo— que globals.css. Robustez > elegancia, sobre todo en
 * la pantalla que aparece cuando ya falló todo lo demás.
 *
 * El CTA usa el azul DEFAULT del brand pipeline, no la marca del tenant: el hex
 * vive en `getTenant()`, que corre en el layout caído. Un CTA con el color
 * equivocado es preferible a un CTA que no renderiza.
 */

const COPY = {
  lang: "es",
  title: "Algo no cargó bien de nuestro lado",
  message: "No es tu culpa. Probá de nuevo en unos segundos.",
  retry: "Reintentar",
} as const;

/** Espejo de THEME_STORAGE_KEY. Literal a propósito: cero imports (ver arriba). */
const THEME_KEY = "cl-theme";

/**
 * El tema, resuelto en el render del cliente.
 *
 * React trata a <html> como HostSingleton: al montar este árbol BORRA todos los
 * atributos del <html> real y aplica sólo los props de acá (react-dom,
 * `acquireSingletonInstance`). O sea que NO alcanza con "no pasar className para
 * no pisar la elección del usuario": la elección se pierde igual. Hay que
 * volver a calcularla y pasarla. El render del cliente corre ANTES del commit
 * que borra los atributos, así que leer el storage acá es seguro.
 *
 * En el server devuelve `undefined`: no hay storage ni matchMedia, y sin clase
 * manda el `@media (prefers-color-scheme: dark)` del <style> de abajo — que es
 * la respuesta correcta cuando no se sabe nada del usuario.
 */
function resolveThemeClass(): "light" | "dark" | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === "dark" || stored === "light") return stored;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return undefined; // storage bloqueado: que decida el @media
  }
}

/**
 * Paleta dark declarada UNA sola vez y reusada por los dos selectores que la
 * activan. La lista se repite (una condición @media no puede formar parte de un
 * selector), el VALOR no: misma estrategia que globals.css.
 */
const DARK_TOKENS = `
    --ge-canvas: #17150f;               /* --cl-dark-canvas — neutral-900, jamás #000 */
    --ge-foreground: #f7f6f3;           /* --cl-dark-foreground — neutral-50, jamás #fff (16.89:1) */
    --ge-foreground-secondary: #c8c3b8; /* --cl-dark-foreground-secondary (10.39:1) */
    --ge-brand: #3772df;                /* tono dark del CTA default: 4.03:1 vs canvas (WCAG 1.4.11) */
    --ge-on-brand: #ffffff;             /* 4.53:1 sobre --ge-brand */
`;

const STYLES = `
  :root { color-scheme: light dark; }
  :root.light { color-scheme: light; }
  :root.dark { color-scheme: dark; }

  .cl-global-error {
    --ge-canvas: #fcfcfb;               /* --cl-light-canvas — neutral-25 */
    --ge-foreground: #17150f;           /* --cl-light-foreground — neutral-900 (17.78:1) */
    --ge-foreground-secondary: #5c564a; /* --cl-light-foreground-secondary (7.09:1) */
    --ge-brand: #1a5edb;                /* default del brand pipeline */
    --ge-on-brand: #ffffff;             /* 5.73:1 sobre --ge-brand */
  }

  :root.dark .cl-global-error {${DARK_TOKENS}  }

  @media (prefers-color-scheme: dark) {
    :root:not(.light):not(.dark) .cl-global-error {${DARK_TOKENS}    }
  }
`;

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  console.error("[app] global-error", { digest: error.digest });

  return (
    // suppressHydrationWarning: el server no puede saber el tema, el cliente sí.
    // El className NO es opcional: sin él, React deja el <html> sin clase (borra
    // los atributos al adquirir el singleton) y la pantalla de error —y la app
    // entera, después de "Reintentar"— quedan siguiendo al SO en vez de a la
    // elección del usuario. Ver resolveThemeClass().
    <html lang={COPY.lang} className={resolveThemeClass()} suppressHydrationWarning>
      <head>
        <style dangerouslySetInnerHTML={{ __html: STYLES }} />
      </head>
      {/* Los fallbacks de var() son la red de la red: si ni el <style> llegara,
          la pantalla igual sale legible en claro en vez de transparente. */}
      <body
        className="cl-global-error"
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "16px",
          backgroundColor: "var(--ge-canvas, #fcfcfb)",
          color: "var(--ge-foreground, #17150f)",
          fontFamily:
            "'Plus Jakarta Sans', system-ui, -apple-system, 'Segoe UI', sans-serif",
          textAlign: "center",
        }}
      >
        <div style={{ maxWidth: "420px" }}>
          <h1 style={{ fontSize: "22px", lineHeight: 1.3, margin: "0 0 8px" }}>
            {COPY.title}
          </h1>
          <p
            style={{
              fontSize: "15px",
              lineHeight: 1.6,
              margin: "0 0 20px",
              color: "var(--ge-foreground-secondary, #5c564a)",
            }}
          >
            {COPY.message}
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              minHeight: "44px",
              padding: "0 24px",
              borderRadius: "9999px",
              border: "none",
              backgroundColor: "var(--ge-brand, #1a5edb)",
              color: "var(--ge-on-brand, #ffffff)",
              fontSize: "15px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {COPY.retry}
          </button>
        </div>
      </body>
    </html>
  );
}
