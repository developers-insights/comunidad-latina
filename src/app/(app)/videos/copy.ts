import { VIDEO_CATEGORIES, type VideoCategory } from "@/lib/media/video-policy";

/**
 * Copy del módulo VIDEOS CORTOS (menú de categorías + reel vertical) — español
 * cálido, directo, sin jerga. Archivo propio del módulo: no toca el copy
 * compartido del feed.
 *
 * El módulo pasó a llamarse "Videos Cortos" (contrato 2026-07-30 §4). El nombre
 * de la PESTAÑA y del menú lateral no vive acá sino en `src/lib/i18n/es/nav.ts`,
 * que es de donde lo lee el shell.
 */

/**
 * Vistas en formato compacto ("1,2 M" en vez de "1.200.000"): en un reel el
 * número acompaña, no protagoniza, y tiene que entrar en una píldora chica.
 * Se crea UNA vez a nivel de módulo — construir un Intl.NumberFormat por render
 * es de las llamadas más caras del runtime de i18n.
 */
const VIEWS_FORMAT = new Intl.NumberFormat("es", { notation: "compact" });

/**
 * Etiquetas del catálogo cerrado de `posts.video_category`. El objeto está
 * tipado contra el catálogo: agregar un valor en la base y olvidarse de su
 * etiqueta acá no compila.
 */
export const VIDEO_CATEGORY_LABELS: Record<VideoCategory, string> = {
  comida: "Comida",
  musica: "Música",
  eventos: "Eventos",
  propiedades: "Propiedades",
  negocios: "Negocios",
  humor: "Humor",
  deportes: "Deportes",
  comunidad: "Comunidad",
  otros: "Otros",
};

/** Una línea por categoría: qué se va a encontrar adentro. */
export const VIDEO_CATEGORY_HINTS: Record<VideoCategory, string> = {
  comida: "Recetas, cocina y los sabores de casa",
  musica: "Música, baile y lo que suena en el barrio",
  eventos: "Fiestas, ferias y encuentros de la comunidad",
  propiedades: "Recorridas de casas, cuartos y apartamentos",
  negocios: "Lo que ofrecen los negocios de tu zona",
  humor: "Para reírse un rato",
  deportes: "Partidos, torneos y equipos de la comunidad",
  comunidad: "Historias, consejos y vida de todos los días",
  otros: "Todo lo demás que vale la pena ver",
};

export const VIDEOS_COPY = {
  title: "Videos Cortos",
  subtitle: "Los videos de tu comunidad",

  feedLabel: "Videos Cortos de la comunidad",
  videoOf: (author: string) => `Video de ${author}`,
  // Acá vivía `byAuthor: (name) => "por {name}"`, que el reel pintaba debajo del
  // nombre del negocio cuando el video salía firmado por una ficha. Se borró con
  // la línea que lo usaba (2026-08-26): publicar como negocio y que abajo
  // apareciera el nombre personal de quien subió el video era una fuga de
  // privacidad. El motivo completo está en `video-reels.tsx`, junto al lugar
  // donde estaba.
  // Misma palabra que el feed (COPY.post.adChip): la divulgación de contenido
  // pago se lee igual en todas las superficies o deja de leerse.
  adChip: "Patrocinado",

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

  /**
   * MENÚ DE ENTRADA (pedido de la call, 1:20: "cuando haces clic a videos, sale
   * un menú y tú escoges los videos que quieres"). Antes se entraba
   * reproduciendo de una; ahora se elige primero.
   */
  menu: {
    eyebrow: "Videos Cortos",
    title: "¿Qué querés ver?",
    subtitle: "Elegí un tema y arrancá. Podés volver acá cuando quieras.",
    allLabel: "Todos los videos",
    allHint: "Todo lo que está pasando en tu comunidad, mezclado",
    listLabel: "Categorías de videos",
    /** Etiqueta accesible de cada tarjeta: dice a qué lleva el toque. */
    openCategory: (label: string) => `Ver videos de ${label}`,
    openAll: "Ver todos los videos",
    /** Aclara el tope del módulo sin que parezca una advertencia. */
    footnote: "Videos de hasta 90 segundos, hechos por la comunidad.",
  },

  /** Cabecera del reel: qué se está viendo y cómo volver a elegir. */
  reel: {
    backToMenu: "Cambiar de categoría",
    activeCategory: (label: string) => `Viendo: ${label}`,
    allLabel: "Todos",
  },

  /** Vacío de una categoría concreta: no es "no hay videos", es "acá todavía". */
  emptyCategoryTitle: (label: string) => `Todavía no hay videos de ${label}`,
  emptyCategoryMessage:
    "Podés ser quien lo estrene: subí el tuyo desde el feed y elegí esta categoría.",
  emptyCategoryCta: "Ver todos los videos",
} as const;

/** El orden del menú es el del catálogo de la base — una sola fuente. */
export const VIDEO_CATEGORY_ORDER = VIDEO_CATEGORIES;
