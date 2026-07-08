"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, DotsThree, ShareNetwork } from "@phosphor-icons/react/dist/ssr";
import { BottomSheet, Button, Textarea, useToast } from "@/components/ui";
import { ReportScamButton } from "@/components/trust";
import { reportScamAction } from "@/app/(app)/mensajes/actions";
import { cn } from "@/lib/utils";
import { COPY } from "./copy";

const iconButtonClass = cn(
  "flex size-11 items-center justify-center rounded-full text-foreground-secondary",
  "transition-[background-color,transform] duration-(--duration-fast) ease-(--ease-spring)",
  "hover:bg-surface-subtle active:scale-[0.94]",
  "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
);

/**
 * Barra superior del detalle (§4.d): volver + guardar + compartir + menú "⋯"
 * con "Reportar como estafa" SIEMPRE como primera opción (§3.3 — la
 * consistencia posicional es en sí misma una señal de seguridad).
 */
export function DetailTopBar({ title, listingId }: { title: string; listingId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [menuOpen, setMenuOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const [details, setDetails] = useState("");
  const [isPending, startTransition] = useTransition();

  async function handleShare() {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      toast({
        title: COPY.detail.shareCopiedTitle,
        description: COPY.detail.shareCopiedBody,
        variant: "success",
      });
    } catch {
      // El usuario canceló el share nativo — no es un error.
    }
  }

  function submitReport() {
    if (!reason || isPending) return;
    startTransition(async () => {
      const result = await reportScamAction({
        targetKind: "listing",
        targetId: listingId,
        reason,
        ...(details.trim() ? { details: details.trim() } : {}),
      });
      if (result.ok) {
        setReportOpen(false);
        setReason(null);
        setDetails("");
        toast({
          title: COPY.report.successTitle,
          description: COPY.report.successBody,
          variant: "success",
        });
      } else {
        toast({
          title: COPY.report.errorTitle,
          description:
            result.code === "unauthenticated"
              ? COPY.report.needLogin
              : COPY.report.errorBody,
          variant: "danger",
        });
      }
    });
  }

  return (
    <div className="mb-3 flex items-center justify-between">
      <button
        type="button"
        aria-label={COPY.detail.back}
        onClick={() => router.back()}
        className={iconButtonClass}
      >
        <ArrowLeft size={22} aria-hidden="true" />
      </button>
      <div className="flex items-center gap-1">
        {/* "Guardar" se resuelve con ausencia hasta que la feature exista
            (§4.d: ausencia, no un botón que confiese estar sin terminar). */}
        <button
          type="button"
          aria-label={COPY.detail.share}
          onClick={handleShare}
          className={iconButtonClass}
        >
          <ShareNetwork size={22} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label={COPY.detail.moreActions}
          aria-haspopup="dialog"
          onClick={() => setMenuOpen(true)}
          className={iconButtonClass}
        >
          <DotsThree size={26} weight="bold" aria-hidden="true" />
        </button>
      </div>

      {/* Menú "⋯" — Reportar estafa SIEMPRE primera opción (§3.3) */}
      <BottomSheet
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        ariaLabel={COPY.detail.moreActions}
      >
        <div className="-mx-4 pb-2">
          <ReportScamButton
            variant="menu-item"
            onReport={() => {
              setMenuOpen(false);
              setReportOpen(true);
            }}
          />
        </div>
      </BottomSheet>

      {/* Flujo de reporte: motivo (radios nativos) + detalles opcionales */}
      <BottomSheet
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        title={COPY.report.sheetTitle}
      >
        <p className="text-sm text-foreground-secondary">{COPY.report.intro}</p>

        <fieldset className="mt-4">
          <legend className="text-sm font-semibold text-foreground">
            {COPY.report.reasonLabel}
          </legend>
          <div className="mt-2.5 flex flex-col gap-2">
            {COPY.report.reasons.map((option) => {
              const selected = reason === option.value;
              return (
                <label
                  key={option.value}
                  className={cn(
                    "flex min-h-11 w-full cursor-pointer select-none items-center gap-3 rounded-md border px-4 py-2.5 text-left text-sm font-medium",
                    "transition-[background-color,border-color] duration-(--duration-fast)",
                    "focus-within:ring-[3px] focus-within:ring-focus-ring",
                    selected
                      ? "border-brand bg-brand-tint text-brand-ink"
                      : "border-border bg-surface text-foreground hover:bg-surface-subtle",
                  )}
                >
                  <input
                    type="radio"
                    name="listing-report-reason"
                    value={option.value}
                    checked={selected}
                    onChange={() => setReason(option.value)}
                    className="size-4 accent-[var(--color-brand)]"
                  />
                  {option.label}
                </label>
              );
            })}
          </div>
        </fieldset>

        <div className="mt-4">
          <label
            htmlFor="listing-report-details"
            className="text-sm font-semibold text-foreground"
          >
            {COPY.report.detailsLabel}
          </label>
          <Textarea
            id="listing-report-details"
            rows={3}
            maxLength={1000}
            value={details}
            placeholder={COPY.report.detailsPlaceholder}
            onChange={(event) => setDetails(event.target.value)}
            className="mt-2"
          />
        </div>

        <Button
          variant="danger"
          className="mb-2 mt-5 w-full"
          disabled={!reason}
          loading={isPending}
          onClick={submitReport}
        >
          {COPY.report.submit}
        </Button>
      </BottomSheet>
    </div>
  );
}
