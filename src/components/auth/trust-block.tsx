"use client";

import { useState } from "react";
import {
  TrustScoreBadge,
  TrustScoreSheet,
  type TrustLevel,
  type TrustSignal,
} from "@/components/trust";

export interface TrustBlockProps {
  /** Nombre de pila para el título del sheet ("Trust Score de Rosa"). */
  firstName: string;
  score: number;
  level: TrustLevel;
  signals: TrustSignal[];
}

/** Badge (card) + sheet con el desglose — el score SIEMPRE explica (§3.3). */
export function TrustBlock({ firstName, score, level, signals }: TrustBlockProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <TrustScoreBadge
        score={score}
        level={level}
        size="card"
        onClick={() => setOpen(true)}
      />
      <TrustScoreSheet
        open={open}
        onClose={() => setOpen(false)}
        name={firstName}
        score={score}
        level={level}
        signals={signals}
      />
    </>
  );
}
