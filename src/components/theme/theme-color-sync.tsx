"use client";

import { useEffect, useLayoutEffect } from "react";
import { DARK_THEME_COLOR } from "./constants";
import { applyToDocument } from "./theme-store";
import { useTheme } from "./use-theme";

/**
 * `useLayoutEffect` avisa por consola si corre en el server. En el cliente sí
 * queremos layout effect: corre ANTES del paint, así que tras un `reset()` del
 * global-error boundary no hay ni un frame con el tema del SO.
 */
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Reafirma el tema resuelto en el DOM. Se monta una vez, en el root layout.
 *
 * ── 1. La clase de <html> ──────────────────────────────────────────────────
 * El <ThemeScript /> la estampa antes del paint, pero React trata a <html> como
 * HostSingleton: al montarlo o desmontarlo BORRA todos sus atributos y aplica
 * sólo los props del elemento nuevo (react-dom, `acquireSingletonInstance` /
 * `releaseSingletonInstance`). Eso pasa de verdad cuando el árbol cae al
 * global-error boundary y el usuario toca "Reintentar": el RootLayout remonta
 * con `className="…fonts… h-full antialiased"`, SIN la clase de tema, y el
 * <ThemeScript /> no se re-ejecuta (React crea los <script> con el truco de
 * "already started", así que un script creado por React nunca corre).
 * Sin esta reafirmación, la app quedaba siguiendo al SO el resto de la sesión
 * mientras `useTheme()` reportaba otra cosa: el toggle mostraba el ícono
 * equivocado, mentía en `aria-pressed` y había que tocarlo dos veces.
 *
 * ── 2. El <meta name="theme-color"> ────────────────────────────────────────
 * `generateViewport()` (src/app/layout.tsx) emite dos metas con `media`, así el
 * server ya acierta sin una línea de JS, y el script pre-paint deja una sola
 * meta con el color del tema resuelto. Pero esos `media` siguen al SISTEMA
 * OPERATIVO, no al toggle: acá pisamos el `content` de TODAS las metas cuando el
 * usuario cambia de tema en caliente.
 *
 * No renderiza nada.
 */
export function ThemeColorSync({ brandHex }: { brandHex: string }) {
  const { resolvedTheme } = useTheme();

  useIsomorphicLayoutEffect(() => {
    if (resolvedTheme === null) return; // todavía no montó: el server no sabe el tema
    applyToDocument(resolvedTheme);
  }, [resolvedTheme]);

  useEffect(() => {
    if (resolvedTheme === null) return;
    const color = resolvedTheme === "dark" ? DARK_THEME_COLOR : brandHex;
    for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
      meta.setAttribute("content", color);
    }
  }, [resolvedTheme, brandHex]);

  return null;
}
