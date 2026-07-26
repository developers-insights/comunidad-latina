"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowLeft,
  BookmarkSimple,
  DotsThree,
  ShareNetwork,
} from "@phosphor-icons/react/dist/ssr";
import { BottomSheet, useToast } from "@/components/ui";
import { ReportScamButton, ReportSheet } from "@/components/trust";
import { cn } from "@/lib/utils";
import { toggleSaveAction } from "@/app/(app)/feed/engagement-actions";
import { COPY } from "./copy";

const iconButtonClass = cn(
  "flex size-11 items-center justify-center rounded-full text-foreground-secondary",
  "transition-[background-color,transform] duration-(--duration-fast) ease-(--ease-spring)",
  "hover:bg-surface-subtle active:scale-[0.94]",
  "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
);

export interface DetailTopBarProps {
  title: string;
  listingId: string;
  /**
   * Estado inicial de "Guardar" (tabla `saves`, 0038), resuelto por la página.
   *
   * OPCIONAL a propósito: si el caller todavía no lo consulta, el botón NO se
   * muestra — preferimos la ausencia antes que un marcador que arranca siempre
   * vacío y le miente al usuario sobre lo que ya tenía guardado. Cada detalle lo
   * habilita cuando pasa este dato.
   */
  initialSaved?: boolean;
}

/**
 * Barra superior del detalle (§4.d): volver + guardar + compartir + menú "⋯"
 * con "Reportar" SIEMPRE como primera opción (§3.3 — la consistencia
 * posicional es en sí misma una señal de seguridad). El reporte usa el
 * ReportSheet unificado (2 taps) contra el propio aviso.
 *
 * "Guardar" es optimista con la misma tolerancia a errores que el del feed: se
 * pinta al instante y se revierte si el server dice que no.
 */
export function DetailTopBar({ title, listingId, initialSaved }: DetailTopBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { toast } = useToast();
  const [menuOpen, setMenuOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [saved, setSaved] = useState(initialSaved ?? false);
  const [, startSaveTransition] = useTransition();

  function toggleSave() {
    const next = !saved;
    setSaved(next);
    try {
      navigator.vibrate?.(10);
    } catch {
      // sin soporte háptico: nada que hacer
    }

    startSaveTransition(async () => {
      const result = await toggleSaveAction({
        subjectKind: "listing",
        subjectId: listingId,
        save: next,
      });
      if (result.ok) {
        setSaved(result.saved);
        return;
      }
      setSaved(!next); // revertimos: la UI no puede mentir sobre lo guardado
      if (result.code === "unauthenticated") {
        router.push(`/entrar?next=${encodeURIComponent(pathname || "/")}`);
        return;
      }
      toast({
        title: COPY.detail.saveErrorTitle,
        description: COPY.detail.saveErrorBody,
        variant: "danger",
      });
    });
  }

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
        {initialSaved !== undefined && (
          <button
            type="button"
            aria-label={saved ? COPY.detail.unsave : COPY.detail.save}
            aria-pressed={saved}
            onClick={toggleSave}
            className={cn(iconButtonClass, saved && "text-brand")}
          >
            <BookmarkSimple
              size={22}
              weight={saved ? "fill" : "regular"}
              aria-hidden="true"
            />
          </button>
        )}
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
