import type { Icon } from "@phosphor-icons/react";
import {
  Diamond,
  Handshake,
  Plant,
  Star,
  TrendUp,
} from "@phosphor-icons/react/dist/ssr";
import type { EmblemName } from "@/components/ui/emblem";

/**
 * Gramática visual FIJA del Trust Score (§3.3 del design brief):
 * 5 niveles con nombre + color + ícono. NO configurable por tenant.
 *
 * =============================================================================
 * POR QUÉ ACÁ NO HAY NI UN ESCUDO NI UN SELLO
 * =============================================================================
 *
 * En la app conviven tres marcas que la gente lee como "verificado", y cada una
 * tiene su FORMA reservada — no sólo su color, porque hay daltonismo y porque
 * el color solo no se lee al sol ni a 14px:
 *
 *   · ESCUDO verde (`ShieldCheck`) — un HECHO comprobado sobre la persona o la
 *     ficha: identidad con documento (`IdentityBadge`, `SellerIdentityBadge`),
 *     gratis. La credencial contra registro oficial usa `Certificate` para
 *     distinguirse del escudo dentro de la misma tarjeta.
 *   · SELLO azul (`SealCheck`) — un PLAN CONTRATADO: el check azul (0101) y la
 *     Presencia Verificada de negocios. Se compra.
 *   · Este ladder — REPUTACIÓN GANADA. No verifica nada y no se puede comprar.
 *
 * Hasta este cambio el peldaño "Activo" (30–49 puntos, el segundo más bajo)
 * dibujaba un `SealCheck` azul: exactamente el tilde que el resto de internet
 * lee como "cuenta verificada" y exactamente la marca del plan pago. Un score
 * de 30 mostraba la misma insignia que una suscripción al día. Y "Confiable"
 * dibujaba el `ShieldCheck` verde de la identidad con documento, así que en la
 * MISMA card (avatar con `IdentityBadge` + badge del publicador) podían
 * aparecer dos escudos verdes idénticos significando cosas distintas.
 *
 * Por eso el ladder pasó a una familia propia —crecimiento y rango: brote,
 * subida, apretón de manos, estrella, cristal—. Ninguna de esas formas se usa
 * para verificar nada en ningún otro lugar del producto.
 *
 * ⚠️ PENDIENTE FUERA DE ESTE ARCHIVO: los emblemas 3D de los peldaños 2 y 3
 * (`nivel-verificado.webp` = sello azul, `escudo-check.webp` = escudo verde)
 * siguen siendo esas dos formas reservadas. El catálogo vive en
 * `components/ui/emblem.tsx` y los assets en `public/brand/emblems/`: hacen
 * falta dos rasters nuevos con metáfora de rango para cerrar el círculo. Hasta
 * entonces la colisión sobrevive SÓLO en tamaños ≥ `EMBLEM_MIN_SIZE` (28px),
 * donde el nivel siempre va escrito en letras al lado ("Nivel: Activo").
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
// verificado/destacado, y las CLAVES son los valores que guarda
// `trust_scores.level` — no se tocan sin migración. Lo que sí se toca sin
// migración es lo que se ve, y de eso hay dos capas:
//
//   · ÍCONO de línea (Phosphor, el que se usa a escala de texto y es el que la
//     gente ve en el feed): brote → subida → apretón de manos → estrella →
//     cristal. Familia de crecimiento y rango, sin un solo escudo ni sello.
//   · EMBLEMA 3D (≥28px): todavía reusa los 8 rasters existentes, dos de los
//     cuales SON el escudo y el sello reservados. Ver el ⚠️ de la cabecera.
//
// El emblema es decorativo (alt="", el nivel se dice al lado en letras), así
// que el nombre legacy del archivo (nivel-verificado.webp en el peldaño
// "Activo") no llega al usuario — pero su FORMA sí, y por eso está anotado.
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
    // `TrendUp` y NO `SealCheck`: el sello azul es la marca del plan pago. Un
    // peldaño que se gana participando no puede dibujar la insignia que se
    // compra. Una flecha que sube dice lo que este nivel realmente es.
    Icon: TrendUp,
    // El asset todavía es el sello azul — ver el ⚠️ de la cabecera.
    emblem: "nivel-verificado",
    // `info-ink` valida a ≥4.5:1 (WCAG 1.4.3) contra las cinco superficies de
    // cada tema. El azul se queda: lo que colisionaba era la FORMA.
    textClass: "text-info-ink",
    segmentClass: "bg-info",
  },
  confiable: {
    label: "Confiable",
    // `Handshake` y NO `ShieldCheck`: el escudo verde es la identidad con
    // documento, y las dos marcas se cruzan en la misma card (el avatar lleva
    // `IdentityBadge` y al lado va el badge del publicador). Un apretón de
    // manos dice "la comunidad ya trató con esta persona", que es el hecho.
    Icon: Handshake,
    // El asset todavía es el escudo verde — ver el ⚠️ de la cabecera.
    emblem: "escudo-check",
    textClass: "text-success-ink",
    segmentClass: "bg-success",
  },
  verificado: {
    // El ID del nivel es `verificado` porque así lo guarda `trust_scores.level`
    // (spec §7) y renombrar la columna es una migración. Lo que se lee NO puede
    // ser "Verificado" a secas: §11 del repo lo prohíbe, y con razón — este
    // peldaño se alcanza con 70 puntos de antigüedad, transacciones y avales,
    // SIN haber verificado nada. Alguien sin documento validado mostraba
    // "Nivel: Verificado". "Reconocido" dice lo mismo que el número dice: que
    // la comunidad ya lo conoce.
    label: "Reconocido",
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
