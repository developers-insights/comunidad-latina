import type { Icon } from "@phosphor-icons/react";
import {
  Diamond,
  Plant,
  SealCheck,
  ShieldCheck,
  Star,
} from "@phosphor-icons/react/dist/ssr";
import type { EmblemName } from "@/components/ui/emblem";

/**
 * Gramática visual FIJA del Trust Score (§3.3 del design brief):
 * 5 niveles con nombre + color + ícono. NO configurable por tenant.
 */
export type TrustLevel =
  | "nuevo"
  | "verificado"
  | "confiable"
  | "premium"
  | "diamante";

export interface TrustLevelConfig {
  label: string;
  /** Ícono de línea (Phosphor, §2.6). Es el fallback en tamaños chicos. */
  Icon: Icon;
  /**
   * Emblema 3D del nivel, para los tamaños grandes (≥ `EMBLEM_MIN_SIZE`).
   * Nunca reemplaza al `Icon`: convive con él. Ver `TrustLevelMark`.
   */
  emblem: EmblemName;
  /** Color del texto/ícono del nivel. */
  textClass: string;
  /** Color de los segmentos llenos de la barra. */
  segmentClass: string;
}

export const TRUST_LEVELS: Record<TrustLevel, TrustLevelConfig> = {
  nuevo: {
    label: "Nuevo",
    Icon: Plant,
    emblem: "nivel-nuevo",
    textClass: "text-foreground-muted",
    segmentClass: "bg-foreground-muted",
  },
  verificado: {
    label: "Verificado",
    Icon: SealCheck,
    emblem: "nivel-verificado",
    textClass: "text-info",
    segmentClass: "bg-info",
  },
  confiable: {
    label: "Confiable",
    Icon: ShieldCheck,
    // Mismo objeto que el hero del Escudo Anti-Estafa: un escudo verde significa
    // "protegido" en TODO el producto, no una cosa distinta por pantalla.
    emblem: "escudo-check",
    textClass: "text-success",
    segmentClass: "bg-success",
  },
  premium: {
    label: "Premium",
    Icon: Star,
    emblem: "nivel-premium",
    textClass: "text-gold",
    segmentClass: "bg-gold",
  },
  diamante: {
    label: "Diamante",
    Icon: Diamond,
    // Cristal incoloro a propósito: `text-brand` varía por tenant (azul en
    // `dominicanos`, naranja en `comunidadlatina`) y un raster no puede variar.
    emblem: "nivel-diamante",
    textClass: "text-brand",
    segmentClass: "bg-brand",
  },
};

/** Orden canónico de los niveles (uno por segmento de la barra). */
const TRUST_LEVEL_ORDER = Object.keys(TRUST_LEVELS) as TrustLevel[];

/**
 * Segmentos llenos (1–5) de la barra: se derivan del NIVEL canónico, no del
 * score crudo, para que la barra nunca contradiga la etiqueta (§3.3 — la
 * confianza es un sistema visual consistente). Cada nivel nombrado mapea a
 * exactamente un segmento.
 */
export function levelSegments(level: TrustLevel): number {
  return TRUST_LEVEL_ORDER.indexOf(level) + 1;
}
