"use client";

import { useState } from "react";
import { CheckCircle, Info } from "@phosphor-icons/react/dist/ssr";
import { m, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import { BezelCard, Chip } from "@/components/ui";
import { AnimatedNumber } from "@/components/motion";
import { clampScore } from "@/lib/trust/levels";
import { TrustLevelMark } from "./trust-level-mark";
import { TrustScoreSheet, type TrustSignal } from "./trust-score-sheet";
import { TRUST_LEVELS, type TrustLevel } from "./levels";

const COPY = {
  howItWorks: "¿Cómo funciona?",
  level: (label: string) => `Nivel ${label}`,
  /** aria del resumen: el número visible es decorativo, el SR lee esto. */
  summary: (heading: string, score: number, label: string) =>
    `${heading}: ${score} de 100. Nivel ${label}.`,
} as const;

/** Cuántas señales logradas mostramos como chips (el resto vive en la hoja). */
const MAX_CHIPS = 3;

export interface TrustScoreCardProps {
  /** Nombre de pila para el título de la hoja ("Trust Score de Rosa"). */
  firstName: string;
  score: number;
  level: TrustLevel;
  signals: TrustSignal[];
  /** Rótulo de la tarjeta: "Tu Trust Score" (propio) / "Trust Score de Rosa". */
  heading: string;
  className?: string;
}

/**
 * Tarjeta ESPECIAL del Trust Score (feedback cliente 21/7: "darle mayor
 * importancia visual"). Número grande NN/100, barra de progreso animada cuyo
 * color mejora con el nivel (gramática fija de `levels.ts`, nunca inventada),
 * emblema del nivel, señales logradas como chips y CTA que abre el desglose
 * completo. Va en AMBOS perfiles — la confianza se ve al mirar a cualquiera.
 *
 * La barra es `aria-hidden`: no carga información por su cuenta (color no es el
 * único canal). El número y el nivel se dicen en palabras en un resumen sr-only.
 */
export function TrustScoreCard({
  firstName,
  score,
  level,
  signals,
  heading,
  className,
}: TrustScoreCardProps) {
  const [open, setOpen] = useState(false);
  const reduce = useReducedMotion();
  const config = TRUST_LEVELS[level];
  const pct = clampScore(score); // 0–100 → ancho de la barra en %
  const achieved = signals.filter((signal) => signal.achieved).slice(0, MAX_CHIPS);

  return (
    <div className={className}>
      <BezelCard
        variant="featured"
        coreClassName="flex flex-col gap-4 p-5"
        role="group"
        aria-label={COPY.summary(heading, score, config.label)}
      >
        <p className="sr-only">{COPY.summary(heading, score, config.label)}</p>

        {/* Cabecera: emblema del nivel + rótulo/nivel a la izquierda, número
            grande a la derecha (el protagonista visual). */}
        <div className="flex items-center gap-3">
          <TrustLevelMark level={level} size={44} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold uppercase tracking-wide text-foreground-muted">
              {heading}
            </p>
            <p
              className={cn(
                "mt-0.5 flex items-center gap-1 text-sm font-semibold",
                config.textClass,
              )}
            >
              <config.Icon size={15} weight="fill" aria-hidden="true" />
              {COPY.level(config.label)}
            </p>
          </div>
          <p className="flex shrink-0 items-baseline gap-0.5" aria-hidden="true">
            <AnimatedNumber
              value={score}
              silent
              className="numeric font-display text-5xl font-bold leading-none text-foreground"
            />
            <span className="numeric text-lg font-semibold text-foreground-muted">
              /100
            </span>
          </p>
        </div>

        {/* Barra de progreso: color por nivel (segmentClass de levels.ts).
            Anima el ancho una vez; con reduced-motion aparece ya llena. */}
        <div
          aria-hidden="true"
          className="h-2.5 w-full overflow-hidden rounded-full bg-border"
        >
          <m.div
            className={cn("h-full rounded-full", config.segmentClass)}
            initial={{ width: reduce ? `${pct}%` : "0%" }}
            animate={{ width: `${pct}%` }}
            transition={{
              duration: reduce ? 0 : 0.9,
              ease: [0.32, 0.72, 0, 1],
            }}
          />
        </div>

        {/* Señales logradas como chips (patrón §4.c) — refuerzo positivo. */}
        {achieved.length > 0 && (
          <ul className="flex flex-wrap gap-1.5">
            {achieved.map((signal) => (
              <li key={signal.label}>
                <Chip
                  variant="neutral"
                  size="sm"
                  icon={<CheckCircle weight="fill" className="text-success" />}
                >
                  {signal.label}
                </Chip>
              </li>
            ))}
          </ul>
        )}

        {/* CTA: abre la hoja con el desglose completo ("Cómo se calcula"). */}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={cn(
            "inline-flex min-h-11 w-fit items-center gap-1.5 self-start rounded-lg text-sm font-semibold text-brand-ink",
            "transition-transform duration-(--duration-instant) ease-(--ease-spring) active:scale-[0.98]",
            "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
          )}
        >
          <Info size={18} aria-hidden="true" />
          {COPY.howItWorks}
        </button>
      </BezelCard>

      <TrustScoreSheet
        open={open}
        onClose={() => setOpen(false)}
        name={firstName}
        score={score}
        level={level}
        signals={signals}
      />
    </div>
  );
}
