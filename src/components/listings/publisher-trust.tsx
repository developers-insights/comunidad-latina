"use client";

import { useState } from "react";
import {
  TrustScoreBadge,
  TrustScoreSheet,
  type TrustLevel,
  type TrustSignal,
} from "@/components/trust";

export interface PublisherTrustProps {
  /** Nombre completo — el sheet usa el nombre de pila. */
  displayName: string;
  firstName: string;
  score: number;
  level: TrustLevel;
  signals: TrustSignal[];
  size?: "inline" | "card";
  className?: string;
}

/**
 * TrustScoreBadge del publicador + su desglose (TrustScoreSheet).
 * El badge SIEMPRE explica — nunca un número mudo (§3.3).
 */
export function PublisherTrust({
  firstName,
  score,
  level,
  signals,
  size = "inline",
  className,
}: PublisherTrustProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <TrustScoreBadge
        score={score}
        level={level}
        size={size}
        onClick={() => setOpen(true)}
        className={className}
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
