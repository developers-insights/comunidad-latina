"use client";

import { useState } from "react";
import Link from "next/link";
import { Flag, ScrollIcon } from "@phosphor-icons/react/dist/ssr";
import { ReportSheet } from "@/components/trust";
import { cn } from "@/lib/utils";
import { COPY } from "./copy";
import { MARKETPLACE_REPORT_REASONS } from "./report-reasons";

/**
 * REPORTAR UN PRODUCTO + acceso a la política (spec §7).
 *
 * NO es un segundo sistema de reportes: monta el `<ReportSheet>` unificado, que
 * llama a la misma `reportTargetAction` y a la misma RPC `report_scam` que el
 * resto de la app. Lo único propio es la lista de motivos: los genéricos ("me
 * trató mal", "se hace pasar por otra persona") no sirven para denunciar una
 * falsificación, y sin un motivo que encaje la gente elige "Otra cosa" y el
 * equipo de moderación pierde la señal.
 *
 * Va al pie del producto, junto al enlace a las Reglas del Marketplace: quien
 * duda de un aviso quiere las dos cosas —qué está prohibido y cómo avisar— en
 * el mismo lugar. El "⋯ → Reportar" de la barra superior sigue existiendo con
 * los motivos generales; este es el camino específico del Marketplace.
 */
export function ReportProductRow({
  productId,
  productTitle,
  className,
}: {
  productId: string;
  productTitle: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <section className={cn("rounded-lg border border-border-subtle p-4", className)}>
      <p className="text-sm font-semibold text-foreground">{COPY.report.title}</p>
      <p className="mt-1 text-sm leading-relaxed text-foreground-secondary">
        {COPY.report.body}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={cn(
            "inline-flex min-h-11 cursor-pointer items-center gap-1.5 text-sm font-semibold text-danger-ink",
            "underline decoration-danger/40 underline-offset-4 transition-colors hover:decoration-danger",
            "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
          )}
        >
          <Flag size={16} aria-hidden="true" />
          {COPY.report.cta}
        </button>

        <Link
          href="/legal/marketplace"
          className={cn(
            "inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-brand-ink",
            "underline decoration-brand-subtle underline-offset-4 transition-colors hover:decoration-brand-ink",
            "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
          )}
        >
          <ScrollIcon size={16} aria-hidden="true" />
          {COPY.report.policyPrompt}
        </Link>
      </div>

      <ReportSheet
        open={open}
        onClose={() => setOpen(false)}
        targetKind="listing"
        targetId={productId}
        contextLabel={productTitle}
        reasons={MARKETPLACE_REPORT_REASONS}
      />
    </section>
  );
}
