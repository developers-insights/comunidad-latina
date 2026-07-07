"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DotsThree } from "@phosphor-icons/react/dist/ssr";
import { BottomSheet, Button, Textarea, useToast } from "@/components/ui";
import { ReportScamButton } from "@/components/trust";
import { REPORT_REASONS, type ReportReasonValue } from "@/components/escudo/report-reasons";
import { cn } from "@/lib/utils";
import { reportPostAction } from "@/app/(app)/feed/actions";
import { COPY } from "./copy";

export interface PostMenuProps {
  postId: string;
  /** null si el viewer es anónimo — reportar pide cuenta. */
  viewerId: string | null;
}

/**
 * Menú ⋯ del detalle de post. "Reportar como estafa" es SIEMPRE la primera
 * opción (§3.3) y abre el flujo de razones canónicas del Escudo — el reporte
 * viaja por la RPC report_scam contra el perfil del autor.
 */
export function PostMenu({ postId, viewerId }: PostMenuProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [menuOpen, setMenuOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reason, setReason] = useState<ReportReasonValue | null>(null);
  const [details, setDetails] = useState("");
  const [isPending, startTransition] = useTransition();

  function openReport() {
    setMenuOpen(false);
    if (!viewerId) {
      toast({ title: COPY.report.needsAuth, variant: "info" });
      router.push(`/entrar?next=${encodeURIComponent(`/feed/${postId}`)}`);
      return;
    }
    setReportOpen(true);
  }

  function submitReport() {
    if (!reason || isPending) return;
    if (reason === "Otro" && details.trim().length === 0) {
      toast({ title: COPY.report.detailsRequired, variant: "warning" });
      return;
    }

    startTransition(async () => {
      const result = await reportPostAction({
        postId,
        reason,
        details: details.trim() || undefined,
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
        return;
      }
      if (result.code === "unauthenticated") {
        router.push(`/entrar?next=${encodeURIComponent(`/feed/${postId}`)}`);
        return;
      }
      toast({
        title: COPY.report.errorTitle,
        description: COPY.report.errorBody,
        variant: "danger",
      });
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setMenuOpen(true)}
        aria-label={COPY.post.menuLabel}
        aria-haspopup="dialog"
        className={cn(
          "flex size-11 shrink-0 items-center justify-center rounded-md text-foreground-secondary",
          "transition-[transform,background-color] duration-(--duration-fast) ease-(--ease-spring)",
          "hover:bg-surface-subtle active:scale-[0.94]",
          "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-brand-200)]",
        )}
      >
        <DotsThree size={22} weight="bold" aria-hidden="true" />
      </button>

      {/* Menú de acciones — Reportar es la primera (y única) opción */}
      <BottomSheet
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        ariaLabel={COPY.post.menuLabel}
      >
        <div className="flex flex-col pb-4">
          <ReportScamButton variant="menu-item" onReport={openReport} />
        </div>
      </BottomSheet>

      {/* Razones canónicas del Escudo */}
      <BottomSheet
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        title={COPY.report.sheetTitle}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submitReport();
          }}
          className="flex flex-col gap-4 pb-4"
        >
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium text-foreground-secondary">
              {COPY.report.reasonLegend}
            </legend>
            {REPORT_REASONS.map((option) => {
              const selected = reason === option.value;
              return (
                <label
                  key={option.key}
                  className={cn(
                    "flex min-h-11 cursor-pointer items-center gap-3 rounded-md border px-4 py-2.5 text-sm",
                    "transition-colors duration-(--duration-fast)",
                    selected
                      ? "border-brand-200 bg-brand-50 font-medium text-brand-800"
                      : "border-border bg-surface text-foreground hover:bg-surface-subtle",
                  )}
                >
                  <input
                    type="radio"
                    name="report-reason"
                    value={option.value}
                    checked={selected}
                    onChange={() => setReason(option.value)}
                    className="size-4 accent-[var(--color-brand)]"
                  />
                  {option.value}
                </label>
              );
            })}
          </fieldset>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="report-details"
              className="text-sm font-medium text-foreground-secondary"
            >
              {COPY.report.detailsLabel}
            </label>
            <Textarea
              id="report-details"
              rows={3}
              maxLength={500}
              value={details}
              placeholder={COPY.report.detailsPlaceholder}
              onChange={(event) => setDetails(event.target.value)}
            />
          </div>

          <Button
            type="submit"
            variant="danger"
            className="w-full"
            disabled={!reason}
            loading={isPending}
          >
            {COPY.report.submit}
          </Button>
        </form>
      </BottomSheet>
    </>
  );
}
