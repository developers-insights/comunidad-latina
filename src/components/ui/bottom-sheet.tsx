"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import {
  useBodyScrollLock,
  useFocusTrap,
  useMounted,
} from "@/lib/design/use-overlay";

export interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  /** Título visible del sheet; si no hay, pasar ariaLabel obligatorio. */
  title?: string;
  ariaLabel?: string;
  children: React.ReactNode;
  className?: string;
  /**
   * Alto del panel. "auto" (default) crece con el contenido hasta 85dvh — el
   * comportamiento histórico que usan trust/report/apply sheets. "tall" fija un
   * alto casi-fullscreen (88dvh) para hojas con lista larga + footer fijo (la
   * hoja de comentarios): así el composer queda anclado abajo y la lista scrollea.
   */
  size?: "auto" | "tall";
  /**
   * Clases del contenedor de contenido (donde van los children). Por default
   * `overflow-y-auto px-6 pb-2 pt-4`. Se mergea con tailwind-merge, así que un
   * consumidor puede tomar el control del layout interno (p.ej. flex column con
   * su propio scroll + footer) pasando `overflow-hidden p-0 flex flex-col …`.
   */
  bodyClassName?: string;
  /**
   * Levanta el panel por encima del teclado virtual (visualViewport). Solo lo
   * necesitan las hojas con input al fondo (comentarios); default false para no
   * tocar el resto de las hojas.
   */
  keyboardAware?: boolean;
}

/**
 * Alto del teclado virtual en px (0 si está cerrado). Mide cuánto del layout
 * viewport tapa el teclado vía `visualViewport`: es la única señal fiable en
 * móvil, donde el teclado NO cambia `innerHeight` pero SÍ encoge el visual
 * viewport. SSR-safe: corre solo en efecto y devuelve 0 hasta medir.
 */
function useKeyboardInset(active: boolean): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    // Las mediciones se difieren a un frame: setState síncrono dentro del
    // efecto encadena renders (react-hooks/set-state-in-effect).
    if (!active) {
      const raf = requestAnimationFrame(() => setInset(0));
      return () => cancelAnimationFrame(raf);
    }
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const overlap = window.innerHeight - (vv.height + vv.offsetTop);
      setInset(Math.max(0, Math.round(overlap)));
    };
    const raf = requestAnimationFrame(update);
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      cancelAnimationFrame(raf);
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, [active]);
  return inset;
}

/**
 * Hoja inferior (§5.3): slide-up con ease-out-premium, handle de arrastre
 * para descartar, scrim ≥40%, focus trap y Escape. Salida 30% más rápida
 * que la entrada.
 */
export function BottomSheet({
  open,
  onClose,
  title,
  ariaLabel,
  children,
  className,
  size = "auto",
  bodyClassName,
  keyboardAware = false,
}: BottomSheetProps) {
  const mounted = useMounted();
  const reduceMotion = useReducedMotion();
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useFocusTrap(panelRef, open, onClose);
  useBodyScrollLock(open);
  const keyboardInset = useKeyboardInset(open && keyboardAware);

  if (!mounted) return null;

  // "tall" fija el alto (footer anclado + lista scrolleable); "auto" conserva el
  // max-h histórico. Con el teclado abierto, un tope inline recorta el panel al
  // espacio visible para que nunca se meta debajo del teclado.
  const heightClass = size === "tall" ? "h-[88dvh]" : "max-h-[85dvh]";

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50">
          <m.div
            className="absolute inset-0 bg-scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.2 } }}
            transition={{ duration: 0.3 }}
            onClick={onClose}
            aria-hidden="true"
          />
          <m.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? titleId : undefined}
            aria-label={title ? undefined : ariaLabel}
            tabIndex={-1}
            className={cn(
              "absolute inset-x-0 bottom-0 mx-auto flex w-full max-w-lg flex-col",
              heightClass,
              "rounded-t-2xl bg-surface-raised shadow-xl",
              "pb-[max(env(safe-area-inset-bottom),1rem)]",
              className,
            )}
            // Con teclado: sube el panel por encima y recorta su alto al espacio
            // libre. `transform` (drag/slide) lo maneja motion aparte — no chocan.
            style={
              keyboardInset > 0
                ? {
                    bottom: keyboardInset,
                    maxHeight: `calc(100dvh - ${keyboardInset}px - 0.5rem)`,
                  }
                : undefined
            }
            initial={reduceMotion ? { opacity: 0 } : { y: "100%" }}
            animate={reduceMotion ? { opacity: 1 } : { y: 0 }}
            exit={
              reduceMotion
                ? { opacity: 0, transition: { duration: 0.15 } }
                : {
                    y: "100%",
                    transition: { duration: 0.25, ease: [0.4, 0, 1, 1] },
                  }
            }
            transition={{ duration: 0.4, ease: [0.32, 0.72, 0, 1] }}
            drag={reduceMotion ? false : "y"}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.5 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 80 || info.velocity.y > 500) onClose();
            }}
          >
            {/* Handle de arrastre — indica "deslizable" (§4.c) */}
            <div
              aria-hidden="true"
              className="mx-auto mt-3 h-1.5 w-10 shrink-0 cursor-grab rounded-full bg-border"
            />
            {title && (
              <h2
                id={titleId}
                className="px-6 pt-4 font-display text-xl font-bold text-foreground"
              >
                {title}
              </h2>
            )}
            <div className={cn("overflow-y-auto px-6 pb-2 pt-4", bodyClassName)}>
              {children}
            </div>
          </m.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
