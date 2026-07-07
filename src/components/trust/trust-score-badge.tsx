"use client";

import { cn } from "@/lib/utils";
import { AnimatedNumber } from "@/components/motion";
import {
  levelSegments,
  TRUST_LEVELS,
  type TrustLevel,
} from "./levels";

export interface TrustScoreBadgeProps {
  /** 0–100. */
  score: number;
  level: TrustLevel;
  /** inline: junto al nombre del autor · card: bloque tocable en perfil. */
  size?: "inline" | "card";
  /** Abre el TrustScoreSheet con el desglose — el badge SIEMPRE explica. */
  onClick: () => void;
  className?: string;
}

/**
 * Gramática visual fija (§3.3): barra de 5 segmentos + número tabular +
 * nivel con ícono. Siempre clickeable — nunca un número mudo.
 */
export function TrustScoreBadge({
  score,
  level,
  size = "inline",
  onClick,
  className,
}: TrustScoreBadgeProps) {
  const config = TRUST_LEVELS[level];
  const filled = levelSegments(level);
  const isCard = size === "card";

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Trust Score ${score} de 100, nivel ${config.label}. Tocá para ver cómo se calcula.`}
      className={cn(
        "group select-none transition-transform duration-(--duration-instant) ease-(--ease-spring) active:scale-[0.97]",
        isCard
          ? "flex w-full items-center justify-between gap-3 rounded-lg border border-border-subtle bg-surface px-4 py-3 shadow-xs"
          : "touch-hitbox inline-flex items-center gap-1.5 rounded-sm",
        className,
      )}
    >
      <span
        className={cn(
          "flex items-center",
          isCard ? "gap-2.5" : "gap-1.5",
        )}
      >
        <config.Icon
          size={isCard ? 20 : 14}
          aria-hidden="true"
          className={cn("shrink-0", config.textClass)}
        />
        {/* Barra de 5 segmentos */}
        <span
          aria-hidden="true"
          className={cn("flex items-center", isCard ? "gap-1" : "gap-0.5")}
        >
          {Array.from({ length: 5 }, (_, index) => (
            <span
              key={index}
              className={cn(
                "rounded-full",
                isCard ? "h-2 w-3.5" : "h-1.5 w-2.5",
                index < filled ? config.segmentClass : "bg-border",
              )}
            />
          ))}
        </span>
        <AnimatedNumber
          value={score}
          silent
          className={cn(
            "numeric font-semibold text-foreground",
            isCard ? "text-lg" : "text-sm",
          )}
        />
        <span
          className={cn(
            "font-medium",
            config.textClass,
            isCard ? "text-sm" : "text-xs",
          )}
        >
          · {config.label}
        </span>
      </span>
      {isCard && (
        <span className="shrink-0 text-xs text-foreground-muted">
          Tocá para ver el detalle →
        </span>
      )}
    </button>
  );
}
