"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, DotsThree, ShareNetwork } from "@phosphor-icons/react/dist/ssr";
import { BottomSheet, useToast } from "@/components/ui";
import { ReportScamButton, ReportSheet } from "@/components/trust";
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
 * con "Reportar" SIEMPRE como primera opción (§3.3 — la consistencia
 * posicional es en sí misma una señal de seguridad). El reporte usa el
 * ReportSheet unificado (2 taps) contra el propio aviso.
 */
export function DetailTopBar({ title, listingId }: { title: string; listingId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [menuOpen, setMenuOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

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

      {/* Menú "⋯" — Reportar SIEMPRE primera opción (§3.3) */}
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

      <ReportSheet
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        targetKind="listing"
        targetId={listingId}
        contextLabel={title}
      />
    </div>
  );
}
