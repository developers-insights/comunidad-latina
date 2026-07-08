"use client";

import Link from "next/link";
import { CheckCircle, Circle } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { TrustLevelMark } from "./trust-level-mark";
import {
  levelSegments,
  TRUST_LEVELS,
  type TrustLevel,
} from "./levels";

export interface TrustSignal {
  /** Ej. "Identidad verificada (documento)" / "Verificar su dirección". */
  label: string;
  achieved: boolean;
}

export interface TrustScoreSheetProps {
  open: boolean;
  onClose: () => void;
  /** Nombre de pila de la persona (ej. "Rosa"). */
  name: string;
  score: number;
  level: TrustLevel;
  signals: TrustSignal[];
  /** Destino de "Leer cómo funciona el Trust Score". */
  learnMoreHref?: string;
}

/**
 * Desglose del Trust Score (§3.3/§4.c): el "por qué" detrás del número.
 * Señales pendientes en gris con "todavía no" — nunca en negativo.
 */
export function TrustScoreSheet({
  open,
  onClose,
  name,
  score,
  level,
  signals,
  learnMoreHref = "/escudo/trust-score",
}: TrustScoreSheetProps) {
  const config = TRUST_LEVELS[level];
  const filled = levelSegments(level);

  return (
    <BottomSheet open={open} onClose={onClose} title={`Trust Score de ${name}`}>
      <div className="flex flex-col items-center gap-2 py-4">
        {/* El momento "level-up": acá el nivel es el protagonista, no un adorno
            junto al número. Emblema 3D grande; la hoja abre por tap, así que
            nunca compite con el LCP de la pantalla. */}
        <TrustLevelMark level={level} size={72} className="mb-1" />
        <span
          aria-hidden="true"
          className="flex items-center gap-1.5"
        >
          {Array.from({ length: 5 }, (_, index) => (
            <span
              key={index}
              className={cn(
                "h-2.5 w-5 rounded-full",
                index < filled ? config.segmentClass : "bg-border",
              )}
            />
          ))}
        </span>
        <p className="numeric font-display text-4xl font-bold text-foreground">
          {score}
        </p>
        <p
          className={cn(
            "flex items-center gap-1.5 text-sm font-semibold",
            config.textClass,
          )}
        >
          {/* Ícono de línea a escala de texto (§2.6) — el emblema ya está arriba. */}
          <config.Icon size={16} aria-hidden="true" />
          Nivel: {config.label}
        </p>
      </div>

      <h3 className="mt-2 text-sm font-semibold text-foreground">
        Cómo se calcula:
      </h3>
      <ul className="mt-3 flex flex-col gap-3">
        {signals.map((signal) => (
          <li key={signal.label} className="flex items-start gap-2.5 text-sm">
            {signal.achieved ? (
              <CheckCircle
                size={20}
                weight="fill"
                aria-hidden="true"
                className="mt-0.5 shrink-0 text-success"
              />
            ) : (
              <Circle
                size={20}
                aria-hidden="true"
                className="mt-0.5 shrink-0 text-foreground-muted"
              />
            )}
            <span
              className={
                signal.achieved
                  ? "text-foreground"
                  : "text-foreground-muted"
              }
            >
              {signal.label}
              {!signal.achieved && (
                <span className="ml-1.5 text-xs">· todavía no</span>
              )}
            </span>
          </li>
        ))}
      </ul>

      <Link
        href={learnMoreHref}
        className="mt-6 mb-2 inline-block text-sm font-semibold text-brand underline-offset-4 hover:underline"
      >
        Leer cómo funciona el Trust Score
      </Link>
    </BottomSheet>
  );
}
