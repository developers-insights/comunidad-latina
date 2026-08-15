/**
 * Copy del CARRUSEL de medios de la card (media-carousel.tsx) — español cálido,
 * sin jerga. Archivo propio, igual que viewer-copy.ts: la sección compartida de
 * copy.ts la editan otros módulos en paralelo y acá no hay conflicto posible.
 *
 * El vocabulario se espeja con el del visor a pantalla completa (VIEWER_COPY):
 * un "medio" es una foto O un video, y el conteo dice "1 de 3" — la misma frase
 * que después escucha quien abre el visor desde acá.
 */
export const CAROUSEL_COPY = {
  /** aria-roledescription del riel: cómo se llama esto para un lector de pantalla. */
  roleDescription: "carrusel",
  /** aria-roledescription de cada diapositiva — mismo término que usa el visor. */
  slideRole: "medio",
  /** aria-label del riel completo. */
  groupLabel: (author: string) => `Fotos y videos de ${author}`,
  groupLabelAnonymous: "Fotos y videos de la publicación",
  /** Etiqueta de una diapositiva de foto: "Foto 2 de 3". */
  photoAt: (current: number, total: number) => `Foto ${current} de ${total}`,
  /** Etiqueta de una diapositiva de video: "Video 1 de 3". */
  videoAt: (current: number, total: number) => `Video ${current} de ${total}`,
  /**
   * `alt` de la FOTO en sí para quien usa lector de pantalla (auditoría
   * accesibilidad 2026-08): acá la foto es la pieza protagonista del post, no
   * una miniatura de listado con título al lado, así que no puede quedar en
   * blanco. Con una sola foto no hay "de cuántas" que contar — "Foto de la
   * publicación" es más natural que "Foto 1 de 1". Con varias, se reusa la
   * misma cuenta que ya lee el aria-label de la diapositiva y la región
   * aria-live: una sola frase para las tres señales.
   */
  photoAlt: (current: number, total: number) =>
    total > 1 ? `Foto ${current} de ${total}` : "Foto de la publicación",
  prev: "Ver el medio anterior",
  next: "Ver el siguiente medio",
  /** Contador numérico cuando hay demasiados medios para puntitos legibles. */
  counter: (current: number, total: number) => `${current}/${total}`,
} as const;
