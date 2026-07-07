"use client";

import { useState } from "react";
import {
  TrustScoreBadge,
  TrustScoreSheet,
  type TrustSignal,
} from "@/components/trust";
import type { TrustLevel } from "@/components/trust";

export interface OwnerTrust {
  /** Nombre de pila / display name del dueño del negocio. */
  name: string;
  score: number;
  level: TrustLevel;
  signals: TrustSignal[];
}

/**
 * Badge de Trust Score del dueño en la card del directorio de negocios.
 * Gramática fija (§3.3): el badge SIEMPRE es clickeable y abre el desglose.
 */
export function BusinessTrustBadge({ trust }: { trust: OwnerTrust }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <TrustScoreBadge
        score={trust.score}
        level={trust.level}
        size="inline"
        onClick={() => setOpen(true)}
      />
      <TrustScoreSheet
        open={open}
        onClose={() => setOpen(false)}
        name={trust.name}
        score={trust.score}
        level={trust.level}
        signals={trust.signals}
      />
    </>
  );
}
