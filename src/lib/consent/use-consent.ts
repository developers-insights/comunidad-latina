"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  categoriesNeedingConsent,
  type GatedCategory,
} from "./categories";
import {
  acceptAll,
  needsDecision,
  readConsent,
  rejectAll,
  resolveGrants,
  revokeConsent,
  saveConsent,
  subscribe,
  type ConsentRecord,
} from "./store";

/**
 * Hook de consentimiento.
 *
 * `useSyncExternalStore` y no `useState`: localStorage es un sistema EXTERNO a
 * React, y esta es la forma que React manda para leerlo sin desincronizarse. El
 * snapshot del servidor es `null` a propósito — el servidor no puede saber qué
 * decidió esta persona, y fingir que sí produce un salto de hidratación.
 */

function getServerSnapshot(): ConsentRecord | null {
  return null;
}

export interface UseConsent {
  /** La decisión guardada, o `null` si todavía no decidió. */
  record: ConsentRecord | null;
  /** Permisos vigentes por categoría, con los defaults ya aplicados. */
  grants: Record<GatedCategory, boolean>;
  /** ¿Hay que mostrarle el banner? */
  mustDecide: boolean;
  /** Categorías de opt-in con trazadores vivos. Vacío ⇒ no hay nada que pedir. */
  pending: readonly GatedCategory[];
  acceptAll: () => void;
  rejectAll: () => void;
  save: (grants: Readonly<Partial<Record<GatedCategory, boolean>>>) => void;
  revoke: () => void;
}

export function useConsent(): UseConsent {
  const record = useSyncExternalStore(subscribe, readConsent, getServerSnapshot);

  return {
    record,
    grants: resolveGrants(record),
    mustDecide: needsDecision(record),
    pending: categoriesNeedingConsent(),
    acceptAll: useCallback(() => {
      acceptAll();
    }, []),
    rejectAll: useCallback(() => {
      rejectAll();
    }, []),
    save: useCallback(
      (grants: Readonly<Partial<Record<GatedCategory, boolean>>>) => {
        saveConsent(grants);
      },
      [],
    ),
    revoke: useCallback(() => {
      revokeConsent();
    }, []),
  };
}
