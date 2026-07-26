/**
 * Copy del módulo VIDEOS (reels vertical) — español cálido, directo, sin
 * jerga. Archivo propio del módulo: no toca el copy compartido del feed.
 */

/**
 * Vistas en formato compacto ("1,2 M" en vez de "1.200.000"): en un reel el
 * número acompaña, no protagoniza, y tiene que entrar en una píldora chica.
 * Se crea UNA vez a nivel de módulo — construir un Intl.NumberFormat por render
 * es de las llamadas más caras del runtime de i18n.
 */
const VIEWS_FORMAT = new Intl.NumberFormat("es", { notation: "compact" });

export const VIDEOS_COPY = {
  title: "Videos",
  subtitle: "Los videos de tu comunidad",

  feedLabel: "Videos de la comunidad",
  videoOf: (author: string) => `Video de ${author}`,
  byAuthor: (name: string) => `por ${name}`,
  adChip: "Publicidad",

  like: "Me gusta",
  unlike: "Quitar me gusta",
  comments: "Comentarios",
  share: "Compartir",
  save: "Guardar",
  unsave: "Quitar de guardados",
  saved: "Guardado",
  saveErrorTitle: "No se pudo guardar",
  saveErrorBody: "Algo no cargó bien de nuestro lado. Probá de nuevo en un ratito.",
  /** "1 vista" · "23 vistas" · "1,2 M vistas" — el número va compacto. */
  viewsLabel: (count: number) =>
    `${VIEWS_FORMAT.format(count)} ${count === 1 ? "vista" : "vistas"}`,
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
