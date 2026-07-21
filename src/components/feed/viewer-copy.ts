/**
 * Copy del VISOR de medios a pantalla completa — español cálido, sin jerga.
 * Archivo propio del visor (media-viewer.tsx): la sección compartida de
 * copy.ts la editan otros módulos en paralelo, acá no hay conflicto posible.
 */
export const VIEWER_COPY = {
  /** aria-label del dialog: "Fotos y videos de {autor}". */
  dialogLabel: (author: string) => `Fotos y videos de ${author}`,
  dialogLabelAnonymous: "Fotos y videos de la publicación",
  close: "Cerrar",
  /** Contador visible "2/4" ya lo arma el componente; esto es para lectores. */
  counterLabel: (current: number, total: number) => `Medio ${current} de ${total}`,
  photoAlt: (author: string) => `Foto de ${author}`,
  videoLabel: (author: string) => `Video de ${author}`,
  play: "Reproducir",
  pause: "Pausar",
  mute: "Silenciar",
  unmute: "Activar sonido",
  prev: "Anterior",
  next: "Siguiente",
} as const;
