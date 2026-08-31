/**
 * COPY DE LOS EMOJIS DE LA COMUNIDAD.
 *
 * Español neutro latino: se lee igual en Santo Domingo, en Bogotá y en Buenos
 * Aires. Nada de jerga de producto ("catálogo", "assets", "cargando recursos")
 * ni de imperativos secos. Vive aparte del componente por la misma razón que
 * `music-copy.ts`: el texto se revisa leyéndolo de corrido, no salteando JSX.
 */
export const EMOJI_COPY = {
  /* --- El botón que abre el picker ------------------------------------- */
  open: "Emojis",
  openAria: "Abrir los emojis",
  closeAria: "Cerrar los emojis",

  /* --- El panel --------------------------------------------------------- */
  panelLabel: "Emojis",
  tabsLabel: "Tipos de emoji",
  /** Pestaña de los emojis de siempre, los del teclado. */
  classicTab: "Clásicos",

  /* --- Buscador --------------------------------------------------------- */
  searchLabel: "Buscar un emoji",
  searchPlaceholder: "Buscá por nombre",
  noResults: (query: string) => `No encontramos ningún emoji para “${query}”.`,
  noResultsHint: "Probá con otra palabra o mirá las pestañas.",

  /* --- Estados ---------------------------------------------------------- */
  loading: "Buscando los emojis…",
  /** Vacío CON los clásicos al lado: hay algo que ofrecer igual. */
  emptyTitle: "Todavía no tenemos los emojis nuestros",
  emptyBody: "Mientras tanto podés usar los clásicos. Los de la comunidad llegan pronto.",
  /** Vacío SIN nada más que ofrecer. */
  emptyBodyAlone: "Van a aparecer acá apenas estén listos.",

  errorTitle: "No pudimos traer los emojis",
  errorBody: "Puede ser la conexión. Probá de nuevo en un momento.",
  signedOut: "Entrá a tu cuenta para usar los emojis de la comunidad.",
  retry: "Reintentar",

  /* --- Cada dibujo ------------------------------------------------------ */
  /**
   * Nombre accesible del botón de cada emoji. Lleva el NOMBRE y la
   * DESCRIPCIÓN: "KLK" solo no le dice nada a quien no ve el dibujo, y la
   * descripción sola no deja pedirlo por su nombre.
   */
  add: (label: string, alt: string) => `Agregar ${label}: ${alt}`,
  /**
   * El mismo botón, pero en el editor de fotos, donde la acción es otra: el
   * dibujo se PEGA sobre la foto y después se arrastra. Espeja a
   * `COPY.composer.photoEditor.addSticker`, que es lo que dice el botón de un
   * emoji clásico ahí mismo — dos botones vecinos que hacen lo mismo no pueden
   * anunciarse distinto.
   */
  addToPhoto: (label: string, alt: string) => `Poner ${label} sobre la foto: ${alt}`,
  /** El mismo emoji, ya insertado en un texto. */
  inText: (alt: string) => alt,
} as const;
