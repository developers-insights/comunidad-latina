"use client";

import { useId, useRef } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
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
}: BottomSheetProps) {
  const mounted = useMounted();
  const reduceMotion = useReducedMotion();
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useFocusTrap(panelRef, open, onClose);
  useBodyScrollLock(open);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50">
          <motion.div
            className="absolute inset-0 bg-scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.2 } }}
            transition={{ duration: 0.3 }}
            onClick={onClose}
            aria-hidden="true"
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? titleId : undefined}
            aria-label={title ? undefined : ariaLabel}
            tabIndex={-1}
            className={cn(
              "absolute inset-x-0 bottom-0 mx-auto flex max-h-[85dvh] w-full max-w-lg flex-col",
              "rounded-t-2xl bg-surface-raised shadow-xl",
              "pb-[max(env(safe-area-inset-bottom),1rem)]",
              className,
            )}
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
            <div className="overflow-y-auto px-6 pb-2 pt-4">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
