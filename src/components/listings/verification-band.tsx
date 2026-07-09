"use client";

import { useId, useState } from "react";
import { CaretDown, ShieldCheck } from "@phosphor-icons/react/dist/ssr";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import { VerificationCard } from "@/components/trust";
import { COPY } from "./copy";
import type { VerificationView } from "./helpers";

export interface VerificationBandProps {
  verification: VerificationView;
  className?: string;
}

/**
 * Banda de verificación del listing (§4.d): SOLO se renderiza si existe un
 * verification_check found_active vinculado — la ausencia se resuelve con
 * ausencia, nunca con un badge negativo.
 *
 * Copy legal §11: incluso colapsada muestra descriptor literal + fecha
 * ("Licencia activa según [registro] al [fecha]") — nunca "Verificado" a secas.
 * El disclaimer completo vive en la VerificationCard expandible.
 */
export function VerificationBand({ verification, className }: VerificationBandProps) {
  const [expanded, setExpanded] = useState(false);
  const reduceMotion = useReducedMotion();
  const detailId = useId();

  const descriptor = verification.licenseNumber
    ? `Licencia #${verification.licenseNumber}`
    : "Registro consultado";

  return (
    <div className={className}>
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={detailId}
        onClick={() => setExpanded((value) => !value)}
        className={cn(
          "flex min-h-11 w-full items-start gap-3 rounded-lg bg-success-bg px-4 py-3 text-left",
          "transition-transform duration-(--duration-instant) ease-(--ease-spring) active:scale-[0.99]",
          "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
        )}
      >
        <ShieldCheck
          size={22}
          weight="fill"
          aria-hidden="true"
          className="mt-0.5 shrink-0 text-success"
        />
        <span className="min-w-0 flex-1 text-sm text-foreground">
          <span className="font-semibold">{COPY.detail.verificationBandLead}:</span>{" "}
          licencia activa según {verification.registry} al {verification.dateLabel}.
        </span>
        <span className="flex shrink-0 items-center gap-1 pt-0.5 text-xs font-semibold text-success-ink">
          {expanded ? COPY.detail.verificationBandHide : COPY.detail.verificationBandDetail}
          <CaretDown
            size={12}
            aria-hidden="true"
            className={cn(
              "transition-transform duration-(--duration-fast)",
              expanded && "rotate-180",
            )}
          />
        </span>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <m.div
            id={detailId}
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, height: 0 }}
            animate={reduceMotion ? { opacity: 1 } : { opacity: 1, height: "auto" }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, height: 0 }}
            transition={{ duration: 0.25, ease: [0.32, 0.72, 0, 1] }}
            className="overflow-hidden"
          >
            <VerificationCard
              status="found_active"
              descriptor={descriptor}
              registry={verification.registry}
              date={verification.dateLabel}
              className="mt-3"
            />
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
}
