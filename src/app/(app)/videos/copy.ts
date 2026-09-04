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
    /**
     * La salida del reel que se abre ENCIMA del feed (2026-09-03). Dice adónde
     * vuelve el toque y no sólo "Cerrar": el reel se abrió sobre el feed sin
     * navegar, así que la promesa —volvés al mismo lugar donde estabas— es
     * justamente lo que hay que nombrar.
     */
    close: "Volver al feed",
  },

  /**
   * VIDEOS LARGOS (cliente 2026-09-03, 19:40–23:44 y 1:09–1:11, pedido dos veces
   * en la misma call): "una sección de los videos largos donde la gente vaya a
   * ver su video de 5 minutos".
   *
   * El tono es el mismo del resto del módulo —cálido y directo— con una regla
   * propia: acá NO se vende. La sección va a estar vacía hasta que existan
   * publicaciones pagas con video largo, y un vacío que aproveche para ofrecer
   * un plan convierte una pantalla honesta en un aviso. Se explica quién puede
   * subirlos, y se ofrece la salida obvia: los videos cortos.
   */
  largos: {
    title: "Videos largos",
    /** Dice el límite sin sonar a advertencia: es lo que los hace distintos. */
    subtitle: "Los videos que no entran en 90 segundos",
    /** Tarjeta de entrada en el menú de Videos Cortos. */
    menuLabel: "Videos largos",
    menuHint: "Recorridas y presentaciones de más de 5 minutos",
    openSection: "Ver los videos largos",
    /** Etiqueta accesible de cada tarjeta de la lista. */
    openVideo: (title: string) => `Ver ${title}`,
    /** Fila de temas arriba de la lista. */
    filterLabel: "Temas de videos largos",
    allLabel: "Todos",
    loadMore: "Ver más videos",
    loadingMore: "Cargando más videos…",
    endOfList: "Llegaste al final de los videos largos.",
    /** Debajo del reproductor. */
    moreTitle: "Más videos largos",
    backToSection: "Volver a Videos largos",
    /** El video, ya completo: lo contrario de la vista previa del feed. */
    fullVideoLabel: (author: string) => `Video completo de ${author}`,

    emptyTitle: "Todavía no hay videos largos",
    /**
     * Quién puede subirlos, contado como una regla del producto y no como una
     * oferta. Es literal lo que dijo el cliente (21:00): los cinco minutos son
     * de una publicación paga, para recorrer una propiedad.
     */
    emptyMessage:
      "Los videos de más de 90 segundos son parte de una publicación paga: la recorrida de una casa, la presentación de un negocio. Cuando alguien publique el primero, lo vas a ver acá.",
    emptyCta: "Ver Videos Cortos",
    emptyCategoryTitle: (label: string) => `Todavía no hay videos largos de ${label}`,
    emptyCategoryMessage:
      "Probá con otro tema, o mirá todos los videos largos que hay hasta ahora.",
    emptyCategoryCta: "Ver todos los videos largos",
  },

  /** Vacío de una categoría concreta: no es "no hay videos", es "acá todavía". */
  emptyCategoryTitle: (label: string) => `Todavía no hay videos de ${label}`,
  emptyCategoryMessage:
    "Podés ser quien lo estrene: subí el tuyo desde el feed y elegí esta categoría.",
  emptyCategoryCta: "Ver todos los videos",
} as const;

/** El orden del menú es el del catálogo de la base — una sola fuente. */
export const VIDEO_CATEGORY_ORDER = VIDEO_CATEGORIES;
