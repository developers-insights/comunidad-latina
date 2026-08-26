import Link from "next/link";
import { cn } from "@/lib/utils";
import { COPY } from "./copy";
import type { FeedTabId } from "./helpers";

/**
 * SELECTOR DE MODO DEL FEED SOCIAL — "Para ti" | "Siguiendo".
 *
 * El tab "siguiendo" (0119) no tiene círculo en la fila de módulos, y no es un
 * descuido: los círculos salen del REGISTRO de módulos (`moduleCircles()`, que
 * por diseño no acepta entradas escritas a mano), y "Siguiendo" no es un
 * módulo — es un MODO del mismo feed social, igual que "Para ti". Meterlo como
 * círculo habría roto la promesa de esa fila (un círculo = un módulo del
 * panel) y el test que la cubre en los dos sentidos.
 *
 * Por eso el selector vive acá: un segmentado chico entre la fila de módulos y
 * el contenido, que solo aparece cuando el tab activo es social ("para-ti" o
 * "siguiendo"). En un tab vertical (Vivienda, Eventos…) no se muestra: ahí el
 * círculo activo ya dice dónde estás, y un segundo control diría otra cosa.
 *
 * Accesibilidad: mismo razonamiento que <NavTabs> — cada opción es un ENLACE
 * que navega (`?tab=`), así que el marcado es `<nav>` + links con
 * `aria-current`, nunca `role="tablist"` (no hay paneles client-side que se
 * muestren y oculten; la página se reemplaza entera, server-rendered).
 * No reusa <NavTabs> porque su forma (barra con subrayado y border-b al ancho
 * completo) compite visualmente con la fila de círculos que tiene encima; la
 * pastilla segmentada pesa menos y se lee como lo que es: un conmutador.
 */

const MODOS: readonly { id: FeedTabId; label: string }[] = [
  { id: "para-ti", label: COPY.modules.modeParaTi },
  { id: "siguiendo", label: COPY.modules.modeSiguiendo },
];

/** Solo estos dos tabs muestran el selector. */
export function esTabSocial(tab: FeedTabId): boolean {
  return tab === "para-ti" || tab === "siguiendo";
}

/**
 * Misma regla que `feedTabHref()` de module-circles.tsx ("para-ti" es el feed
 * pelado, sin query) — duplicada acá A PROPÓSITO y no importada: aquel archivo
 * es `"use client"`, y este componente corre en el servidor; importar una
 * función de un módulo cliente desde RSC revienta en runtime aunque tsc y el
 * build pasen (se comprobó). Los tests de los DOS archivos pin-ean los hrefs,
 * así que si la regla cambia en uno solo, se rompe un test, no producción.
 */
function modoHref(tab: FeedTabId): string {
  return tab === "para-ti" ? "/feed" : `/feed?tab=${tab}`;
}

export function FeedModeToggle({ active }: { active: FeedTabId }) {
  if (!esTabSocial(active)) return null;

  return (
    <nav aria-label={COPY.modules.modeLabel} className="mt-3">
      <ul className="inline-flex items-center gap-0.5 rounded-full border border-border-subtle bg-surface-raised p-0.5">
        {MODOS.map((modo) => {
          const current = modo.id === active;
          return (
            <li key={modo.id} className="shrink-0">
              <Link
                href={modoHref(modo.id)}
                aria-current={current ? "page" : undefined}
                // Cambiar de modo no manda al tope: el encabezado y los
                // círculos ya persisten fuera del Suspense — que la vista no
                // pegue saltos.
                scroll={false}
                className={cn(
                  "flex min-h-9 items-center whitespace-nowrap rounded-full px-4 text-sm",
                  "transition-colors duration-(--duration-fast) ease-(--ease-out-premium)",
                  "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
                  current
                    ? "bg-surface font-semibold text-foreground shadow-sm"
                    : "font-medium text-foreground-secondary hover:text-foreground",
                )}
              >
                {modo.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
