"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DotsThree } from "@phosphor-icons/react/dist/ssr";
import { BottomSheet, useToast } from "@/components/ui";
import { ReportScamButton, ReportSheet } from "@/components/trust";
import { cn } from "@/lib/utils";
import { COPY } from "./copy";

export interface PostMenuProps {
  postId: string;
  /** null si la cuenta del autor ya no existe — no hay a quién reportar. */
  authorId: string | null;
  /** null si el viewer es anónimo — reportar pide cuenta. */
  viewerId: string | null;
}

/**
 * Menú ⋯ del detalle de post. "Reportar" es SIEMPRE la primera opción (§3.3)
 * y abre el ReportSheet unificado (2 taps) — el reporte viaja contra el
 * PERFIL del autor (no contra el post en sí), vía la RPC report_scam.
 */
export function PostMenu({ postId, authorId, viewerId }: PostMenuProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [menuOpen, setMenuOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  function openReport() {
    setMenuOpen(false);
    if (!viewerId) {
      toast({ title: COPY.report.needsAuth, variant: "info" });
      router.push(`/entrar?next=${encodeURIComponent(`/feed/${postId}`)}`);
      return;
    }
    // Autor eliminado: no hay perfil contra el cual reportar (caso borde).
    if (!authorId) return;
    setReportOpen(true);
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
          "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
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

      {authorId && (
        <ReportSheet
          open={reportOpen}
          onClose={() => setReportOpen(false)}
          targetKind="profile"
          targetId={authorId}
          contextLabel={`Publicación /feed/${postId}`}
        />
      )}
    </>
  );
}
