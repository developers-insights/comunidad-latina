"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { m, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import { COPY } from "./copy";
import { FEED_TABS, type FeedTabId } from "./helpers";

const TAB_LABELS: Record<FeedTabId, string> = {
  "para-ti": COPY.tabs.paraTi,
  propiedades: COPY.tabs.propiedades,
  negocios: COPY.tabs.negocios,
  profesionales: COPY.tabs.profesionales,
  eventos: COPY.tabs.eventos,
};

/**
 * Acento por módulo (globals.css) para el underline del tab activo: cada
 * vertical con su color, en vez de un único `bg-brand`. El underline es
 * decorativo, así que el acento va en el fondo del subrayado; el TEXTO queda en
 * foreground para no arriesgar contraste (p. ej. el amarillo de Negocios).
 */
const TAB_ACCENT: Record<FeedTabId, string> = {
  "para-ti": "var(--accent-feed)",
  propiedades: "var(--accent-vivienda)",
  negocios: "var(--accent-negocios)",
  profesionales: "var(--accent-profesionales)",
  eventos: "var(--accent-eventos)",
};

const TAB_INDEX: Record<FeedTabId, number> = Object.fromEntries(
  FEED_TABS.map((tab, index) => [tab.id, index]),
) as Record<FeedTabId, number>;

/**
 * Resorte del subrayado, en función de cuántos tabs saltó.
 *
 * El salto corto casi no rebota; el largo se pasa un poco más y vuelve — que es
 * como se mueve algo con inercia real. `bounce` es la amplitud del sobrepaso
 * (0 = frena en seco) y `visualDuration` el tiempo percibido hasta asentarse.
 * Los topes están puestos para que el efecto se note pero nunca se lea como
 * "rebotó": 2% de sobrepaso en un salto de un tab, ~10% cruzando los cinco.
 */
export function underlineSpring(distance: number) {
  const d = Math.min(Math.max(distance, 1), 4);
  return {
    type: "spring" as const,
    visualDuration: 0.24 + d * 0.028, // 0.27s → 0.35s
    bounce: 0.06 + d * 0.035, // 0.10 → 0.20
  };
}

/**
 * Tabs de los 5 feeds (§4.b). El estado de verdad sigue viviendo en la URL
 * (`?tab=`), pero el subrayado se mueve APENAS TOCÁS, sin esperar a que la
 * navegación aterrice: estas rutas son server-rendered con queries a la base y
 * tardan; con el underline atado sólo al server, el tab "saltaba" recién al
 * terminar de cargar y se sentía tosco.
 *
 * `aria-current` queda atado al valor REAL de la URL, no al optimista: mover el
 * subrayado antes de tiempo es una promesa visual razonable, pero anunciarle a
 * un lector de pantalla que ya estás en una página que todavía no cargó, no.
 */
export function FeedTabs({ active }: { active: FeedTabId }) {
  const reduceMotion = useReducedMotion();
  const listRef = useRef<HTMLUListElement>(null);
  const activeItemRef = useRef<HTMLLIElement>(null);

  // Optimista + de dónde venía (para la distancia del salto). La URL manda:
  // cuando la navegación aterriza, el optimista se descarta. Se ajusta DURANTE
  // el render — un efecto acá encadenaría un render de más por navegación.
  const [optimistic, setOptimistic] = useState<FeedTabId | null>(null);
  const [lastActive, setLastActive] = useState<FeedTabId>(active);
  const [from, setFrom] = useState<FeedTabId>(active);

  if (active !== lastActive) {
    setFrom(lastActive);
    setLastActive(active);
    setOptimistic(null);
  }

  const current = optimistic ?? active;
  const distance = Math.abs(TAB_INDEX[current] - TAB_INDEX[from]);

  // El tab elegido siempre visible: si quedó fuera del scroll horizontal, entra
  // solo. Imperativo a propósito (no toca estado de React).
  useEffect(() => {
    activeItemRef.current?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
      behavior: reduceMotion ? "auto" : "smooth",
    });
  }, [current, reduceMotion]);

  return (
    <nav aria-label={COPY.tabs.ariaLabel} className="-mx-4 border-b border-border-subtle">
      <ul
        ref={listRef}
        className="flex overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {FEED_TABS.map((tab) => {
          const isSelected = tab.id === current;
          return (
            <li
              key={tab.id}
              ref={isSelected ? activeItemRef : undefined}
              className="shrink-0"
            >
              <Link
                href={tab.id === "para-ti" ? "/feed" : `/feed?tab=${tab.id}`}
                aria-current={tab.id === active ? "page" : undefined}
                onClick={() => {
                  if (tab.id === current) return;
                  setFrom(current);
                  setOptimistic(tab.id);
                }}
                className={cn(
                  "relative flex min-h-11 items-center whitespace-nowrap px-3.5 pb-2.5 pt-2 text-sm font-semibold",
                  "transition-colors duration-(--duration-fast)",
                  "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
                  isSelected
                    ? "text-foreground"
                    : "text-foreground-muted hover:text-foreground-secondary",
                )}
              >
                {TAB_LABELS[tab.id]}
                {isSelected && (
                  // layoutId: Motion mide las dos posiciones y anima el salto —
                  // no hay que calcular offsets a mano ni guardarlos en estado.
                  <m.span
                    layoutId="feed-tab-underline"
                    aria-hidden="true"
                    className="absolute inset-x-3 bottom-0 h-0.5 rounded-full"
                    style={{ backgroundColor: TAB_ACCENT[tab.id] }}
                    transition={reduceMotion ? { duration: 0 } : underlineSpring(distance)}
                  />
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
