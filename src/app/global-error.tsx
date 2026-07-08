"use client";

import { useEffect, useLayoutEffect } from "react";
import { DARK_THEME_COLOR, type ResolvedTheme } from "@/components/theme/constants";
import { applyToDocument, getSnapshot } from "@/components/theme/theme-store";

/**
 * global-error (§3.5): último recurso — se muestra si falla el ROOT layout,
 * o sea cuando el design system (globals.css, fuentes, providers) puede no
 * existir. Por eso es casi autónomo: HTML propio, un <style> inline, cero
 * componentes.
 *
 * ── Los dos únicos imports ────────────────────────────────────────────────
 * `constants.ts` no importa nada y `theme-store.ts` sólo importa `constants.ts`:
 * dos módulos hoja, sin React, sin JSX y sin CSS. A propósito NO se importa desde
 * el barrel `@/components/theme`, que arrastraría <ThemeScript>, <ThemeToggle> y
 * <ThemeColorSync> al chunk de la pantalla que aparece cuando ya falló todo.
 *
 * ── Tema oscuro sin depender de nada ──────────────────────────────────────
 * Acá no hay Tailwind ni tokens: `globals.css` lo importa el root layout, que es
 * exactamente lo que se acaba de romper. Los valores de abajo son copia literal
 * de las dos paletas de globals.css (`--cl-light-*` / `--cl-dark-*`).
 *
 * La BASE se resuelve por CASCADA, no por JS — el store de tema, el provider y
 * hasta la hidratación pueden no existir cuando esto renderiza (y puede renderizar
 * en el server). El <style> cubre los tres casos, igual que globals.css:
 *   1. `.dark`  en <html> → oscuro (la estampó el script pre-paint, si llegó a correr)
 *   2. `.light` en <html> → claro forzado
 *   3. sin clase          → manda el SO (`@media (prefers-color-scheme: dark)`)
 * Si el JS muere, con eso solo la pantalla ya sale legible: un celular en dark ve
 * una pantalla oscura, nunca el flash blanco cegador que había antes.
 *
 * Encima de esa base van DOS refuerzos con JS, porque la cascada sola pierde la
 * ELECCIÓN del usuario (que puede ser distinta de la del SO):
 *   · `className` en el render — React trata a <html> como HostSingleton: al montar
 *     este árbol BORRA todos los atributos del <html> real y aplica sólo los props
 *     de acá (react-dom, `acquireSingletonInstance`). O sea que NO alcanza con "no
 *     pasar className para no pisar la elección del usuario": la elección se pierde
 *     igual. El render del cliente corre ANTES del commit que borra los atributos,
 *     así que leer el store acá es seguro.
 *   · `applyToDocument()` en un layout effect — el className NO cubre el caso
 *     SSR: si el root layout tiró en el server, esta pantalla llega como HTML sin
 *     clase y React, al hidratar, no parchea los atributos que no matchean. El
 *     className del cliente nunca aterriza en el DOM. Corre antes del paint, así
 *     que no hay ni un frame con el tema equivocado, y `reset()` devuelve al
 *     usuario a la app con SU tema (después el <ThemeColorSync /> del root layout
 *     lo reafirma, porque el remonte vuelve a borrar los atributos del <html>).
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

/**
 * Color de la barra del navegador / status bar. Es el CANVAS de esta pantalla,
 * no la marca: en light el root layout tiñe el chrome con `tenant.brandHex`, que
 * acá no existe (vive en `getTenant()`). Pintar el azul default sería mostrarle
 * al usuario la marca de OTRO tenant; el canvas se funde con la pantalla y no
 * miente. En dark los dos coinciden: DARK_THEME_COLOR ES `--cl-dark-canvas`.
 */
const CHROME_COLOR = {
  light: "#fcfcfb", // --cl-light-canvas
  dark: DARK_THEME_COLOR, // #17150F = --cl-dark-canvas
} as const;

/**
 * El tema efectivo, leído del store (no de `localStorage` a mano): si el storage
 * está bloqueado, la elección de ESTA sesión sólo vive en la memoria del store.
 *
 * En el server devuelve `undefined`: no hay storage ni matchMedia, y sin clase
 * manda el `@media (prefers-color-scheme: dark)` del <style> de abajo — que es
 * la respuesta correcta cuando no se sabe nada del usuario. El try/catch cubre a
 * los browsers sin `matchMedia`, donde el store tira.
 */
function resolveThemeClass(): ResolvedTheme | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return getSnapshot().resolvedTheme ?? undefined;
  } catch {
    return undefined; // que decida el @media
  }
}

/** `useLayoutEffect` avisa por consola si corre en el server (y acá corre). */
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

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

  const resolved = resolveThemeClass();

  // Deps vacías a propósito: acá no hay toggle ni nadie suscripto al store, así
  // que el tema no puede cambiar mientras esta pantalla está montada.
  useIsomorphicLayoutEffect(() => {
    const theme = resolveThemeClass();
    if (theme === undefined) return; // sin JS útil: manda el @media del <style>

    applyToDocument(theme);

    // Se pisa el `content` de TODAS las metas, no se agrega una: el browser
    // aplica la PRIMERA que matchea, y cuando el boundary monta en el cliente ya
    // hay una meta anterior en el <head> —la que dejó el script pre-paint— que
    // React no conoce y que no va a desaparecer. Los `media` quedan como están:
    // si las dos dicen el mismo color, cuál matchea deja de importar.
    for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
      meta.setAttribute("content", CHROME_COLOR[theme]);
    }
  }, []);

  return (
    // suppressHydrationWarning: el server no puede saber el tema, el cliente sí.
    <html lang={COPY.lang} className={resolved} suppressHydrationWarning>
      <head>
        {/* `generateViewport()` es metadata del root layout y global-error lo
            REEMPLAZA, así que Next no emite nada acá: sin esta meta el celular
            renderiza la pantalla de error a ancho desktop y la achica.
            Sin `viewport-fit=cover` a propósito (el root layout sí lo usa): este
            <body> no tiene padding de safe-area, y sin `cover` el browser ya
            mantiene el contenido fuera del notch. */}
        <meta name="viewport" content="width=device-width, initial-scale=1" />

        {/* Las dos metas con `media` hacen que el color del chrome sea correcto
            aunque el JS esté muerto — el SO decide, igual que el @media del
            <style>. Con JS, el layout effect les pisa el `content` con el tema
            RESUELTO, que es la elección del usuario y puede no coincidir con el
            SO. Estáticas en server y cliente: no hay mismatch de hidratación. */}
        <meta name="theme-color" media="(prefers-color-scheme: light)" content={CHROME_COLOR.light} />
        <meta name="theme-color" media="(prefers-color-scheme: dark)" content={CHROME_COLOR.dark} />

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
