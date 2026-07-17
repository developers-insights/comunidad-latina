"use client";

import { useEffect, useState, useTransition } from "react";
import { CheckCircle } from "@phosphor-icons/react/dist/ssr";
import { reportTargetAction } from "@/app/(app)/reportes/actions";
import { BottomSheet, Button, Textarea } from "@/components/ui";
import { cn } from "@/lib/utils";

export type ReportTargetKind = "profile" | "listing" | "message";

/**
 * Motivos únicos para las 12+ superficies del flujo unificado: cortos,
 * tocables como fila completa, el primero preseleccionado para que reportar
 * sea "elegí (ya viene marcado) → enviar" — 2 taps.
 */
const REPORT_REASONS = [
  "Pidió dinero por adelantado",
  "Se hace pasar por otra persona",
  "Publicó algo falso o engañoso",
  "Me trató mal o me acosó",
  "Otra cosa",
] as const;

const COPY = {
  title: "Reportar",
  subtitle: "Es anónimo para esta persona. Lo revisa nuestro equipo.",
  reportingAbout: (label: string) => `Sobre: ${label}`,
  reasonLegend: "¿Qué pasó?",
  detailsToggleOpen: "Agregar detalles (opcional)",
  detailsToggleClose: "Ocultar detalles",
  detailsLabel: "Contanos más",
  detailsPlaceholder: "Todo detalle ayuda a que el equipo actúe rápido.",
  submit: "Enviar reporte",
  successTitle: "Gracias por avisar.",
  successBody: "Nuestro equipo lo revisa.",
  needLogin: "Entrá a tu cuenta para poder reportar.",
  genericError:
    "Algo no salió bien de nuestro lado — no es tu culpa. Probá de nuevo.",
} as const;

/** El sheet se autocierra tras el estado de éxito — sin un segundo tap. */
const AUTOCLOSE_MS = 1500;

export interface ReportSheetProps {
  open: boolean;
  onClose: () => void;
  targetKind: ReportTargetKind;
  targetId: string;
  /** Ej. título del aviso o nombre de la persona — da contexto al equipo. */
  contextLabel?: string;
}

/**
 * Flujo unificado de reporte (2 taps): motivo preseleccionado + "Enviar
 * reporte". Un solo componente para perfiles, avisos y mensajes — todas las
 * superficies del §3.3 lo montan igual, así "reportar" se siente siempre en
 * el mismo lugar y del mismo modo.
 */
export function ReportSheet({
  open,
  onClose,
  targetKind,
  targetId,
  contextLabel,
}: ReportSheetProps) {
  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel={COPY.title}>
      {/* BottomSheet desmonta los hijos al cerrar: el body monta fresco en cada
          apertura y el estado nunca arrastra el target anterior. El key cubre
          el caso borde de cambiar de target con el sheet abierto. */}
      <ReportSheetBody
        key={`${targetKind}:${targetId}`}
        onClose={onClose}
        targetKind={targetKind}
        targetId={targetId}
        contextLabel={contextLabel}
      />
    </BottomSheet>
  );
}

function ReportSheetBody({
  onClose,
  targetKind,
  targetId,
  contextLabel,
}: Omit<ReportSheetProps, "open">) {
  const [reason, setReason] = useState<string>(REPORT_REASONS[0]);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [details, setDetails] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!success) return;
    const timer = window.setTimeout(onClose, AUTOCLOSE_MS);
    return () => window.clearTimeout(timer);
  }, [success, onClose]);

  function submit() {
    if (isPending) return;
    setErrorMessage(null);

    const composedDetails = [
      contextLabel ? COPY.reportingAbout(contextLabel) : null,
      details.trim() || null,
    ]
      .filter(Boolean)
      .join(" — ");

    startTransition(async () => {
      const result = await reportTargetAction({
        targetKind,
        targetId,
        reason,
        details: composedDetails || undefined,
      });
      if (result.ok) {
        setSuccess(true);
        return;
      }
      setErrorMessage(
        result.code === "unauthenticated" ? COPY.needLogin : COPY.genericError,
      );
    });
  }

  return (
    <>
      {success ? (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <CheckCircle
            size={40}
            weight="fill"
            className="text-success"
            aria-hidden="true"
          />
          <p className="text-base font-semibold text-foreground">
            {COPY.successTitle}
          </p>
          <p className="text-sm text-foreground-secondary">{COPY.successBody}</p>
        </div>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
          className="flex flex-col gap-4 pb-2"
        >
          {/* Título propio: el del BottomSheet vive en el padre, que no conoce
              el estado de éxito — acá se oculta junto con el formulario. */}
          <h2 className="font-display text-xl font-bold text-foreground">
            {COPY.title}
          </h2>
          <p className="-mt-3 text-sm text-foreground-secondary">{COPY.subtitle}</p>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium text-foreground-secondary">
              {COPY.reasonLegend}
            </legend>
            {REPORT_REASONS.map((option) => {
              const selected = reason === option;
              return (
                <label
                  key={option}
                  className={cn(
                    "flex min-h-11 cursor-pointer select-none items-center gap-3 rounded-md border px-4 py-2.5 text-left text-sm font-medium",
                    "transition-colors duration-(--duration-fast)",
                    "focus-within:ring-[3px] focus-within:ring-focus-ring",
                    selected
                      ? "border-danger bg-danger-bg text-foreground"
                      : "border-border bg-surface text-foreground-secondary hover:bg-surface-subtle",
                  )}
                >
                  <input
                    type="radio"
                    name="report-sheet-reason"
                    value={option}
                    checked={selected}
                    onChange={() => setReason(option)}
                    className="size-4 shrink-0 accent-[var(--color-danger)]"
                  />
                  {option}
                </label>
              );
            })}
          </fieldset>

          <div>
            <button
              type="button"
              onClick={() => setDetailsOpen((current) => !current)}
              aria-expanded={detailsOpen}
              aria-controls="report-sheet-details"
              className="text-sm font-medium text-brand-ink underline-offset-4 hover:underline"
            >
              {detailsOpen ? COPY.detailsToggleClose : COPY.detailsToggleOpen}
            </button>
            {detailsOpen && (
              <div id="report-sheet-details" className="mt-2.5 flex flex-col gap-1.5">
                <label htmlFor="report-sheet-details-input" className="sr-only">
                  {COPY.detailsLabel}
                </label>
                <Textarea
                  id="report-sheet-details-input"
                  rows={3}
                  maxLength={500}
                  placeholder={COPY.detailsPlaceholder}
                  value={details}
                  onChange={(event) => setDetails(event.target.value)}
                  autoFocus
                />
              </div>
            )}
          </div>

          {errorMessage && (
            <p role="alert" className="text-sm font-medium text-danger">
              {errorMessage}
            </p>
          )}

          <Button type="submit" variant="danger" className="w-full" loading={isPending}>
            {COPY.submit}
          </Button>
        </form>
      )}
    </>
  );
}
