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
  | "activo"
  | "confiable"
  | "verificado"
  | "destacado";

export interface TrustLevelConfig {
  label: string;
  /** Ícono de línea (Phosphor, §2.6). Es el fallback en tamaños chicos. */
  Icon: Icon;
  /**
   * Emblema 3D del nivel, para los tamaños grandes (≥ `EMBLEM_MIN_SIZE`).
   * Nunca reemplaza al `Icon`: convive con él. Ver `TrustLevelMark`.
   */
  emblem: EmblemName;
  /**
   * El nivel escrito como PALABRAS ("· Verificado", "Nivel: Destacado"). Es texto:
   * va el tono `-ink` del rol, que globals.css valida a ≥4.5:1 (WCAG 1.4.3)
   * contra las cinco superficies de cada tema. Nunca el relleno.
   */
  textClass: string;
  /**
   * Relleno de los segmentos llenos de la barra. Es un objeto gráfico, no texto:
   * se queda el tono base. La barra va `aria-hidden` y el nivel se dice al lado
   * en letras, así que no carga información por su cuenta.
   */
  segmentClass: string;
}

// Re-mapeo de niveles (spec §7): la taxonomía pasó a nuevo/activo/confiable/
// verificado/destacado. La capa VISUAL preserva el LADDER ASCENDENTE por
// posición (brote → sello azul → escudo verde → estrella dorada → cristal),
// reusando los 8 emblemas existentes: el emblema es decorativo (alt="", el
// nivel se dice al lado en letras), así que el nombre legacy del archivo
// (p. ej. nivel-verificado.webp en el peldaño "Activo") no llega al usuario.
// El orden de las claves ES el orden de segmentos de la barra (levelSegments).
export const TRUST_LEVELS: Record<TrustLevel, TrustLevelConfig> = {
  nuevo: {
    label: "Nuevo",
    Icon: Plant,
    emblem: "nivel-nuevo",
    textClass: "text-foreground-muted",
    segmentClass: "bg-foreground-muted",
  },
  activo: {
    label: "Activo",
    Icon: SealCheck,
    // Sello azul del ladder (asset nivel-verificado.webp). `info-ink` valida a
    // ≥4.5:1 (WCAG 1.4.3) contra las cinco superficies de cada tema.
    emblem: "nivel-verificado",
    textClass: "text-info-ink",
    segmentClass: "bg-info",
  },
  confiable: {
    label: "Confiable",
    Icon: ShieldCheck,
    // Mismo objeto que el hero del Escudo Anti-Estafa: un escudo verde significa
    // "protegido" en TODO el producto, no una cosa distinta por pantalla.
    emblem: "escudo-check",
    textClass: "text-success-ink",
    segmentClass: "bg-success",
  },
  verificado: {
    label: "Verificado",
    Icon: Star,
    // Estrella dorada del ladder (asset nivel-premium.webp) para el penúltimo
    // peldaño. El dorado de §2.3 (#b7791f) da 3.64:1 contra `bg-surface`:
    // alcanza para el emblema y los segmentos, no para la palabra. `gold-ink` es
    // ese mismo dorado oscurecido en OKLCH — sigue leyéndose dorado, no marrón.
    emblem: "nivel-premium",
    textClass: "text-gold-ink",
    segmentClass: "bg-gold",
  },
  destacado: {
    label: "Destacado",
    Icon: Diamond,
    // Cristal incoloro a propósito (asset nivel-diamante.webp): el tono de marca
    // varía por tenant (azul en `dominicanos`, naranja en `comunidadlatina`) y un
    // raster no puede variar.
    emblem: "nivel-diamante",
    // `text-brand` (el RELLENO de la marca) sólo se valida a ≥3:1 contra el canvas:
    // con un tenant de hue claro la palabra quedaba ilegible. `brand-ink` es el
    // único tono de marca que el pipeline valida a ≥4.5:1 para cualquier tenant.
    textClass: "text-brand-ink",
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
