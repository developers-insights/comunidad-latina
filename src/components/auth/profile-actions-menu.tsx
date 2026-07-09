"use client";

import { useState, useTransition } from "react";
import { DotsThree } from "@phosphor-icons/react/dist/ssr";
import { reportProfileAction } from "@/app/(app)/perfil/actions";
import { ReportScamButton } from "@/components/trust";
import {
  BottomSheet,
  Button,
  Dialog,
  Textarea,
  useToast,
} from "@/components/ui";
import { cn } from "@/lib/utils";

const COPY = {
  menuLabel: "Más acciones",
  reportTitle: "Reportar un problema",
  reportDescription:
    "Contanos qué pasó. Tu reporte es anónimo para esta persona y lo revisa nuestro equipo.",
  reasonLegend: "¿Qué pasó?",
  detailsLabel: "Detalles (opcional)",
  detailsPlaceholder: "Ej: me pidió un depósito por Zelle antes de mostrar nada.",
  submit: "Enviar reporte",
  cancel: "Cancelar",
  sent: "Gracias por avisar. Nuestro equipo lo revisa.",
  needLogin: "Entrá a tu cuenta para poder reportar.",
} as const;

const REASONS = [
  { id: "pidio_dinero_adelantado", label: "Pidió dinero por adelantado" },
  { id: "se_hace_pasar_por_otro", label: "Se hace pasar por otra persona" },
  { id: "publicacion_falsa", label: "Publicó algo falso o engañoso" },
  { id: "otro", label: "Otra cosa" },
] as const;

type ReasonId = (typeof REASONS)[number]["id"];

/**
 * Menú "⋯" del perfil público (§4.c): ReportScamButton SIEMPRE primero —
 * la consistencia posicional es en sí misma una señal de seguridad (§3.3).
 */
export function ProfileActionsMenu({ profileId }: { profileId: string }) {
  const { toast } = useToast();
  const [menuOpen, setMenuOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reason, setReason] = useState<ReasonId>("pidio_dinero_adelantado");
  const [details, setDetails] = useState("");
  const [pending, startTransition] = useTransition();

  function submitReport() {
    startTransition(async () => {
      const result = await reportProfileAction({
        profileId,
        reason,
        details: details.trim() || undefined,
      });
      setReportOpen(false);
      if (result.ok) {
        setDetails("");
        toast({ title: COPY.sent, variant: "success" });
      } else {
        toast({
          title: result.formError ?? COPY.needLogin,
          variant: "danger",
        });
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setMenuOpen(true)}
        aria-label={COPY.menuLabel}
        aria-haspopup="dialog"
        className="flex size-11 items-center justify-center rounded-full text-foreground-secondary transition-colors duration-(--duration-fast) hover:bg-surface-subtle hover:text-foreground"
      >
        <DotsThree size={26} weight="bold" aria-hidden="true" />
      </button>

      <BottomSheet
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        ariaLabel={COPY.menuLabel}
      >
        <div className="-mx-2 flex flex-col pb-2">
          {/* Reportar SIEMPRE primero (§3.3) */}
          <ReportScamButton
            onReport={() => {
              setMenuOpen(false);
              setReportOpen(true);
            }}
          />
        </div>
      </BottomSheet>

      <Dialog
        open={reportOpen}
        onClose={() => !pending && setReportOpen(false)}
        title={COPY.reportTitle}
        description={COPY.reportDescription}
        highRisk
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setReportOpen(false)}
              disabled={pending}
            >
              {COPY.cancel}
            </Button>
            <Button variant="danger" loading={pending} onClick={submitReport}>
              {COPY.submit}
            </Button>
          </>
        }
      >
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium text-foreground">
            {COPY.reasonLegend}
          </legend>
          {REASONS.map((option) => {
            const selected = reason === option.id;
            return (
              <label
                key={option.id}
                className={cn(
                  "flex min-h-11 cursor-pointer items-center gap-3 rounded-md border px-3.5 py-2 text-sm",
                  "transition-colors duration-(--duration-fast)",
                  selected
                    ? "border-danger bg-danger-bg text-foreground"
                    : "border-border text-foreground-secondary hover:bg-surface-subtle",
                )}
              >
                <input
                  type="radio"
                  name="report-reason"
                  value={option.id}
                  checked={selected}
                  onChange={() => setReason(option.id)}
                  className="size-4 accent-[var(--color-danger)]"
                />
                {option.label}
              </label>
            );
          })}
        </fieldset>

        <div className="mt-4 flex flex-col gap-1.5">
          <label
            htmlFor="report-details"
            className="text-sm font-medium text-foreground"
          >
            {COPY.detailsLabel}
          </label>
          <Textarea
            id="report-details"
            rows={3}
            maxLength={500}
            placeholder={COPY.detailsPlaceholder}
            value={details}
            onChange={(e) => setDetails(e.target.value)}
          />
        </div>
      </Dialog>
    </>
  );
}
