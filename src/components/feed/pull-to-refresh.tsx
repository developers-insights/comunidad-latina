"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown } from "@phosphor-icons/react/dist/ssr";
import { Spinner } from "@/components/ui";
import { usePrefersReducedMotion } from "@/components/motion";
import { COPY } from "./copy";

/** Distancia de dedo (px) a partir de la cual soltar dispara el refresh. */
const REFRESH_THRESHOLD = 70;
/** Tope visual del indicador — el dedo puede seguir tirando, el indicador no. */
const MAX_PULL = 96;
/** El indicador se mueve más lento que el dedo (sensación de resorte/resistencia). */
const RESISTANCE = 0.5;

/**
 * Traduce el desplazamiento crudo del dedo a la distancia VISUAL del
 * indicador: solo hacia abajo, con resistencia y un tope — nunca "chicletea"
 * sin límite. Pura y testeable aparte del gesto táctil real.
 */
export function dampPull(rawDeltaY: number): number {
  if (rawDeltaY <= 0) return 0;
  return Math.min(rawDeltaY * RESISTANCE, MAX_PULL);
}

/** ¿La distancia ya alcanzó el umbral de "soltá para actualizar"? */
export function isPullReady(pull: number): boolean {
  return pull >= REFRESH_THRESHOLD;
}

export interface PullToRefreshProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * Pull-to-refresh conservador (pedido cliente: "que se sienta como
 * Instagram"): SOLO gestos táctiles, y SOLO cuando el documento ya está
 * scrolleado arriba del todo — nunca compite con un scroll en curso.
 *
 * `router.refresh()` vuelve a correr los Server Components de la ruta actual
 * con datos frescos (misma URL, sin perder el estado de cliente que no
 * cambie — doc use-router.md); `<FeedList>` detecta el `initialItems` nuevo
 * (otra referencia) y resetea su acumulado — ver el comentario en
 * feed-list.tsx. `isPending` de useTransition ata la duración del spinner al
 * refresh REAL, no a un timeout inventado.
 *
 * El listener de touchmove se agrega NATIVO (no vía JSX): React adjunta
 * touchstart/touchmove como PASIVOS por default, y un handler pasivo no puede
 * hacer preventDefault(). Sin poder frenarlo, el pull nativo del navegador
 * (que en Chrome/Android puede disparar una recarga COMPLETA de la página)
 * compite con este indicador propio. Solo se llama preventDefault cuando el
 * gesto YA es un tirón hacia abajo arrancado arriba del todo — cualquier otro
 * scroll (para abajo, o uno que no arranca en el tope) nunca se toca, así que
 * el overscroll nativo del resto de la app queda intacto.
 */
export function PullToRefresh({ children, className }: PullToRefreshProps) {
  const router = useRouter();
  const reduceMotion = usePrefersReducedMotion();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [pull, setPull] = useState(0);
  const [isTouching, setIsTouching] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Solo se lee dentro de los handlers de touch (nunca en el render): el
  // punto de partida del gesto no necesita ser reactivo.
  const startYRef = useRef<number | null>(null);
  // Espejo de `pull` legible SÍNCRONO en touchend, sin depender de un closure
  // que podría haber quedado viejo. (Deliberadamente NO se lee `pull` con el
  // updater funcional de setState para decidir el refresh ahí: ese callback
  // debe ser puro —sin llamar a triggerRefresh()— porque React puede
  // invocarlo dos veces en Strict Mode y dispararía el refresh doble.)
  const pullRef = useRef(0);

  const triggerRefresh = useCallback(() => {
    setRefreshing(true);
    startTransition(() => {
      router.refresh();
    });
  }, [router]);

  // El refresh terminó (la transición de router.refresh() se asentó): el
  // indicador vuelve a 0. Atado a isPending, no a un timeout fijo — y
  // calculado DURANTE el render (patrón "ajustar estado cuando cambia un
  // valor", sin efecto) en vez de un useEffect con setState adentro: un
  // efecto que solo sincroniza estado de React contra otro estado de React
  // dispara un re-render en cascada de más: ver
  // https://react.dev/learn/you-might-not-need-an-effect.
  const [prevIsPending, setPrevIsPending] = useState(isPending);
  if (prevIsPending !== isPending) {
    setPrevIsPending(isPending);
    if (!isPending && refreshing) {
      setRefreshing(false);
      setPull(0);
    }
  }

  useEffect(() => {
    const node = containerRef.current;
    if (!node || typeof window === "undefined") return;

    function getScrollTop(): number {
      return document.scrollingElement?.scrollTop ?? window.scrollY ?? 0;
    }

    function onTouchStart(e: TouchEvent) {
      if (refreshing || e.touches.length !== 1 || getScrollTop() > 0) {
        startYRef.current = null;
        return;
      }
      startYRef.current = e.touches[0].clientY;
      setIsTouching(true);
    }

    function onTouchMove(e: TouchEvent) {
      if (startYRef.current === null || refreshing) return;
      const deltaY = e.touches[0].clientY - startYRef.current;
      if (deltaY <= 0) {
        // Volvió a subir sin haber tirado: no es un pull, no tocamos el scroll.
        pullRef.current = 0;
        setPull(0);
        return;
      }
      // Tirón hacia abajo confirmado, arriba del todo: acá SÍ se frena el
      // comportamiento nativo (bounce / recarga del navegador).
      e.preventDefault();
      const next = dampPull(deltaY);
      pullRef.current = next;
      setPull(next);
    }

    function onTouchEnd() {
      const wasTracking = startYRef.current !== null;
      startYRef.current = null;
      setIsTouching(false);
      if (!wasTracking) return;
      if (isPullReady(pullRef.current)) {
        setPull(REFRESH_THRESHOLD);
        triggerRefresh();
      } else {
        pullRef.current = 0;
        setPull(0);
      }
    }

    node.addEventListener("touchstart", onTouchStart, { passive: true });
    node.addEventListener("touchmove", onTouchMove, { passive: false });
    node.addEventListener("touchend", onTouchEnd, { passive: true });
    node.addEventListener("touchcancel", onTouchEnd, { passive: true });
    return () => {
      node.removeEventListener("touchstart", onTouchStart);
      node.removeEventListener("touchmove", onTouchMove);
      node.removeEventListener("touchend", onTouchEnd);
      node.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [refreshing, triggerRefresh]);

  const ready = isPullReady(pull);
  const showIndicator = pull > 0 || refreshing;
  const noTransition = isTouching || reduceMotion;

  return (
    <div ref={containerRef} className="[overscroll-behavior-y:contain]">
      <div
        aria-hidden="true"
        className="flex items-center justify-center overflow-hidden text-foreground-muted"
        style={{
          height: pull,
          transition: noTransition ? "none" : "height var(--duration-base) var(--ease-out-premium)",
        }}
      >
        {showIndicator &&
          (refreshing ? (
            <Spinner size={20} />
          ) : (
            <ArrowDown
              size={20}
              aria-hidden="true"
              style={{
                transform: `rotate(${ready ? 180 : 0}deg)`,
                transition: reduceMotion ? "none" : "transform var(--duration-fast) var(--ease-spring)",
              }}
            />
          ))}
      </div>

      {/* Anuncio para lectores de pantalla — el gesto en sí es visual/táctil,
          pero quien use un lector igual se entera de que el feed se actualizó. */}
      <div role="status" aria-live="polite" className="sr-only">
        {refreshing
          ? COPY.feed.refreshing
          : ready
            ? COPY.feed.pullToRefreshRelease
            : ""}
      </div>

      {/* `className` del caller (layout del contenido, ej. "mt-4 flex flex-col
          gap-4") va SOLO acá — nunca en el div de arriba, o el `gap` metería un
          espacio fijo entre el indicador (alto 0 en reposo) y el contenido. */}
      <div className={className}>{children}</div>
    </div>
  );
}
