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
   * Clases del velo que oscurece lo que hay detrás. Default `bg-scrim` (§5.3,
   * ≥40% — aísla el diálogo del fondo). Una hoja que se abre SOBRE UN VIDEO lo
   * baja a un tinte apenas perceptible: ahí el fondo no es "ruido a tapar", es
   * justo lo que la persona está mirando (feedback cliente 2026-07-27: "le
   * bloqueó todo el video"). Se mergea con tailwind-merge.
   */
  scrimClassName?: string;
  /**
   * Levanta el panel por encima del teclado virtual (visualViewport). Solo lo
   * necesitan las hojas con input al fondo (comentarios); default false para no
   * tocar el resto de las hojas.
   */
  keyboardAware?: boolean;
  /**
   * APAGA EL ARRASTRE DEL PANEL mientras dure algo que se toca adentro. Todas
   * las demás salidas siguen igual: Escape, el velo y el botón que la hoja
   * tenga (Cancelar, la X). Lo único que deja de existir es deslizar el panel.
   *
   * Existe por el editor de fotos (feedback cliente 2026-09-03: "si lo mueves
   * un poquitico, boom, se regresa al paso uno"). El editor vive DENTRO de esta
   * hoja y sus gestos —arrastrar un emoji, panear el recorte, pellizcar— caen
   * sobre el mismo panel: framer-motion escucha el `pointerdown` acá y arranca
   * su arrastre igual, porque el `touch-action: none` del editor frena el
   * scroll del navegador pero no un gesto de JS. Al soltar, la hoja se cerraba.
   *
   * ── POR QUÉ ACÁ Y NO UN `stopPropagation` EN EL HIJO ────────────────────────
   * Motion documenta `onPointerDownCapture` + `stopPropagation()` en el hijo, y
   * funciona: React escucha en el contenedor del portal, así que su fase de
   * captura corre ANTES de que el evento baje hasta este panel. Pero hay que
   * acordarse de ponerlo en cada superficie que se arrastre (el stage, cada
   * emoji, lo que venga después), y olvidarse en una sola devuelve el bug
   * entero. Apagar la feature de arrastre es UN interruptor, en la fuente, y no
   * depende del orden de delegación de eventos ni de qué navegador sea: con
   * `drag={false}` framer-motion ni monta el gesto.
   */
  gesturesLocked?: boolean;
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
      // UN PELLIZCO NO ES EL TECLADO. Los dos encogen el visual viewport de la
      // misma forma, así que `height`/`offsetTop` no los distinguen: sólo
      // `scale` los separa, porque el teclado nunca cambia el zoom. Sin esto,
      // recortar una foto con dos dedos —que ES un pellizco: el segundo dedo
      // cae fuera del stage, sobre panel sin `touch-action`, y ahí iOS hace
      // zoom de página— se leía como un teclado gigante. Medido en vivo a
      // 375px: la hoja saltaba a `bottom: 406px` y su alto caía de 714 a 398.
      // Con el zoom puesto, el teclado no se puede medir de esta manera y el
      // valor honesto es 0: la hoja se queda donde está.
      if (vv.scale > 1.01) {
        setInset(0);
        return;
      }
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
  scrimClassName,
  keyboardAware = false,
  gesturesLocked = false,
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

  // Un solo lugar decide si el gesto existe, y de ahí salen las dos cosas que
  // dependen de él: la feature de motion y el cursor del asa.
  const dragEnabled = !reduceMotion && !gesturesLocked;

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50">
          <m.div
            className={cn("absolute inset-0 bg-scrim", scrimClassName)}
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
            drag={dragEnabled ? "y" : false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.5 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 80 || info.velocity.y > 500) onClose();
            }}
          >
            {/* Handle de arrastre — indica "deslizable" (§4.c). Sigue estando
                con el gesto apagado (es la marca visual de "esto es una hoja"),
                pero sin cursor de agarre: un asa que promete un gesto que no
                existe es peor que no tenerla. */}
            <div
              aria-hidden="true"
              className={cn(
                "mx-auto mt-3 h-1.5 w-10 shrink-0 rounded-full bg-border",
                dragEnabled && "cursor-grab",
              )}
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
