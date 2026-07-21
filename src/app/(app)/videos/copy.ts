/**
 * Copy del módulo VIDEOS (reels vertical) — español cálido, directo, sin
 * jerga. Archivo propio del módulo: no toca el copy compartido del feed.
 */
export const VIDEOS_COPY = {
  title: "Videos",
  subtitle: "Los videos de tu comunidad",

  scopes: {
    ariaLabel: "Filtrar videos por sección",
    "para-ti": "Para ti",
    propiedades: "Propiedades",
    negocios: "Negocios",
    profesionales: "Profesionales",
    eventos: "Eventos",
  } as Record<string, string>,

  feedLabel: "Videos de la comunidad",
  videoOf: (author: string) => `Video de ${author}`,
  byAuthor: (name: string) => `por ${name}`,
  adChip: "Publicidad",

  like: "Me gusta",
  unlike: "Quitar me gusta",
  comments: "Comentarios",
  share: "Compartir",
  shareCopiedTitle: "Link copiado",
  shareCopiedBody: "Pegalo donde quieras para compartir el video.",
  mute: "Silenciar",
  unmute: "Activar sonido",
  play: "Reproducir",
  pause: "Pausar",

  loadingMore: "Cargando más videos…",
  endOfFeed: "Viste todos los videos por ahora. Volvé más tarde 🎬",

  emptyTitle: "Todavía no hay videos por acá",
  emptyMessage:
    "Sé de los primeros: subí un video desde el feed y contale a tu comunidad qué está pasando.",
  emptyCta: "Ir al feed a publicar",
} as const;
