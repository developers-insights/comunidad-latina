/**
 * PRESETS DE FILTRO — datos puros, sin React ni DOM (se testean sin montar
 * nada). Cada preset es un valor de `filter` de CSS: sirve TAL CUAL para la
 * vista previa instantánea (`style={{ filter: css }}`, gratis en el navegador)
 * y para el horneado en canvas (`ctx.filter = css`, ver `bake-photo.ts`) — un
 * solo valor, dos usos, cero posibilidad de que la vista previa mienta sobre
 * lo que se termina publicando.
 *
 * NOMBRES: en español, y que suenen a cómo hablaría una persona de su foto
 * ("quedó cálida", "la dejé bien nítida"), no a un panel de edición
 * profesional ("Curves", "HSL", "Clarity"). Pensados para lo que se publica en
 * esta comunidad — comida, casas, autos, gente — así que ninguno empuja tanto
 * el efecto como para verse "filtrado" en vez de "una foto linda".
 */

export interface PhotoFilter {
  id: string;
  /** Nombre visible, en español rioplatense cálido. */
  label: string;
  /** Valor de `filter` (CSS y canvas). Cadena vacía = sin filtro. */
  css: string;
}

export const PHOTO_FILTERS: readonly PhotoFilter[] = [
  { id: "original", label: "Original", css: "" },
  {
    id: "calido",
    label: "Cálido",
    css: "saturate(1.3) sepia(0.14) contrast(1.05) brightness(1.03)",
  },
  {
    id: "fresco",
    label: "Fresco",
    css: "saturate(1.12) hue-rotate(-6deg) contrast(1.05) brightness(1.04)",
  },
  {
    id: "nitido",
    label: "Nítido",
    css: "contrast(1.22) saturate(1.12) brightness(1.01)",
  },
  {
    id: "suave",
    label: "Suave",
    css: "brightness(1.06) contrast(0.92) saturate(0.92)",
  },
  {
    id: "byn",
    label: "Blanco y negro",
    css: "grayscale(1) contrast(1.1)",
  },
  {
    id: "vintage",
    label: "Vintage",
    css: "sepia(0.35) saturate(0.85) contrast(0.95) brightness(1.02)",
  },
  {
    id: "vivido",
    label: "Vívido",
    css: "saturate(1.5) contrast(1.1)",
  },
] as const;

export type PhotoFilterId = (typeof PHOTO_FILTERS)[number]["id"];

export const DEFAULT_PHOTO_FILTER_ID: PhotoFilterId = "original";

/** Busca un preset por id; si no existe (dato corrupto), cae a "Original". */
export function getPhotoFilter(id: string | undefined | null): PhotoFilter {
  return PHOTO_FILTERS.find((filter) => filter.id === id) ?? PHOTO_FILTERS[0];
}
