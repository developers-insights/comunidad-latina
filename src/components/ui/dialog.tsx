"use client";

import { useId, useRef } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import {
  useBodyScrollLock,
  useFocusTrap,
  useMounted,
} from "@/lib/design/use-overlay";

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Texto de apoyo debajo del título. */
  description?: string;
  /** Modales de alto riesgo (pagos, eliminar, estafa): rol alertdialog. */
  highRisk?: boolean;
  children?: React.ReactNode;
  /** Acciones al pie (Button primario + secundario). */
  footer?: React.ReactNode;
  className?: string;
}

/**
 * Modal centrado. La entrada es DELIBERADAMENTE más lenta (400ms, §5.3):
 * la lentitud comunica "esto es importante, no lo hagas sin pensar".
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  highRisk = false,
  children,
  footer,
  className,
}: DialogProps) {
  const mounted = useMounted();
  const reduceMotion = useReducedMotion();
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useFocusTrap(panelRef, open, onClose);
  useBodyScrollLock(open);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <m.div
            className="absolute inset-0 bg-scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.2 } }}
            transition={{ duration: 0.4 }}
            onClick={onClose}
            aria-hidden="true"
          />
          <m.div
            ref={panelRef}
            role={highRisk ? "alertdialog" : "dialog"}
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={description ? descriptionId : undefined}
            tabIndex={-1}
            className={cn(
              "relative w-full max-w-sm rounded-xl bg-surface-raised p-6 shadow-xl",
              className,
            )}
            initial={
              reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.95, y: 8 }
            }
            animate={
              reduceMotion ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }
            }
            exit={{
              opacity: 0,
              ...(reduceMotion ? {} : { scale: 0.97 }),
              transition: { duration: 0.2, ease: [0.4, 0, 1, 1] },
            }}
            transition={{ duration: 0.4, ease: [0.32, 0.72, 0, 1] }}
          >
            <h2
              id={titleId}
              className="font-display text-xl font-bold text-foreground"
            >
              {title}
            </h2>
            {description && (
              <p
                id={descriptionId}
                className="mt-2 text-sm text-foreground-secondary"
              >
                {description}
              </p>
            )}
            {children && <div className="mt-4">{children}</div>}
            {footer && (
              <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                {footer}
              </div>
            )}
          </m.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
