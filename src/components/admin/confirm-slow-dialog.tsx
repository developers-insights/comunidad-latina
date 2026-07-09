"use client";

import { useEffect, useState } from "react";
import { m } from "motion/react";
import { Button, Dialog } from "@/components/ui";

/**
 * Confirmación de alto riesgo (§4.4 del design brief): la entrada del Dialog
 * ya es deliberadamente lenta (400ms) y ADEMÁS el botón de confirmar queda
 * inhabilitado ~1.6s mientras una barrita de "pensalo" se llena — la lentitud
 * comunica "esto es importante, no lo hagas sin pensar". Se usa para crear
 * tenant y enviar broadcast global (acciones cross-tenant de alto impacto).
 */

const THINK_MS = 1600;

export function ConfirmSlowDialog({
  open,
  onClose,
  title,
  description,
  confirmLabel,
  onConfirm,
  confirmLoading = false,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  confirmLabel: string;
  /** Se invoca al confirmar; el caller cierra el dialog cuando termina. */
  onConfirm: () => void;
  /** true mientras la server action está en vuelo. */
  confirmLoading?: boolean;
  /** Resumen de lo que está por pasar (datos, targets, etc.). */
  children?: React.ReactNode;
}) {
  const [ready, setReady] = useState(false);

  // Reset del "pensalo" al abrir/cerrar — ajuste de estado EN RENDER (patrón
  // recomendado, sin cascada de effects).
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    setReady(false);
  }

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => setReady(true), THINK_MS);
    return () => window.clearTimeout(timer);
  }, [open]);

  return (
    <Dialog open={open} onClose={onClose} title={title} description={description} highRisk>
      {children}
      <div className="mt-4">
        <div
          aria-hidden="true"
          className="h-1 w-full overflow-hidden rounded-full bg-surface-subtle"
        >
          <m.div
            className="h-full rounded-full bg-brand"
            initial={{ width: "0%" }}
            animate={{ width: open ? "100%" : "0%" }}
            transition={{ duration: THINK_MS / 1000, ease: "linear" }}
          />
        </div>
        <p className="mt-2 text-xs text-foreground-muted" aria-live="polite">
          {ready
            ? "Listo — confirmá cuando quieras."
            : "Un segundo… revisá los datos antes de confirmar."}
        </p>
      </div>
      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="ghost" onClick={onClose} disabled={confirmLoading}>
          Cancelar
        </Button>
        <Button
          variant="primary"
          disabled={!ready}
          loading={confirmLoading}
          onClick={onConfirm}
        >
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
