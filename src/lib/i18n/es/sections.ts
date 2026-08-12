/**
 * Copy del "chrome" de sección: la pantalla Buscar y la burbuja "Publicá tu…"
 * que encabeza cada listado (feedback cliente 2026-07-27).
 *
 * Vive acá y no en el copy.ts de cada módulo a propósito: son siete variantes
 * de la MISMA frase y la única forma de que no se desincronicen es tenerlas
 * juntas, una debajo de la otra, donde se leen como una familia.
 *
 * Regla de escritura: el título es la ACCIÓN (verbo primero, en voseo, como el
 * resto de la app) y la pista es el MOTIVO, en una línea corta. Nada de
 * "Publicar" a secas — el público mayor tiene que entender de un vistazo qué
 * pasa si toca.
 */
export const sections = {
  // ── Buscar (pestaña del bottom nav) ──────────────────────────────────────
  searchTitle: "¿Qué estás buscando?",
  searchSubtitle: "Escribí lo que buscás, o elegí una categoría.",
  searchCategories: "Categorías de la comunidad",
  // Encabezado de la grilla, ahora que arriba hay una barra: nombra la segunda
  // opción sin sugerir que la primera falló.
  searchBrowseTitle: "Explorá por categoría",

  // ── Barra de búsqueda global ─────────────────────────────────────────────
  // El placeholder es TEXTUAL del contrato (spec nº1): enumera las entidades
  // porque su trabajo es responder "¿qué puedo buscar acá?" antes de que
  // alguien tenga que probar.
  searchBarPlaceholder: "Buscar personas, negocios, propiedades, eventos y más…",
  searchBarLabel: "Buscar en la comunidad",
  searchBarClear: "Borrar la búsqueda",
  searchResultsLabel: "Resultados",

  // ── Historial (barra vacía) ──────────────────────────────────────────────
  searchHistoryTitle: "Tus últimas búsquedas",
  searchHistoryClear: "Borrar todo",
  // {term} entra crudo: es lo que la persona escribió, y el aria-label tiene
  // que decir exactamente qué fila se borra.
  searchHistoryRemove: "Quitar {term} de tus búsquedas",
  searchHistoryEmpty: "Acá van a quedar tus últimas búsquedas, para volver a ellas en un toque.",

  // ── Sugerencias mientras se escribe ──────────────────────────────────────
  searchSuggestionsTitle: "Quizás buscabas",

  // ── Sin resultados ───────────────────────────────────────────────────────
  // Nunca un "no hay nada" seco: se dice qué probar, con acciones concretas.
  searchNoResultsTitle: "No encontramos nada con eso",
  searchNoResultsMessage:
    "Probá con una palabra sola, revisá cómo se escribe, o buscá por el nombre de la zona.",

  // ── Error ────────────────────────────────────────────────────────────────
  // Cálido y sin culpar a nadie (§5 del design system).
  searchErrorTitle: "La búsqueda no cargó",
  searchErrorMessage: "Fue algo de nuestro lado, no tuyo. Probá de nuevo en un momento.",
  searchErrorRetry: "Reintentar",

  // ── Marca de publicidad en resultados de video (§4 del contrato) ─────────
  searchSponsored: "Patrocinado",

  // Buscar sin ninguna categoría abierta (el admin las apagó todas). Nunca una
  // grilla vacía y muda: se explica qué pasa y se promete qué viene.
  searchEmptyTitle: "Estamos preparando las categorías",
  searchEmptyMessage:
    "Muy pronto vas a encontrar acá todo lo que ofrece la comunidad: vivienda, negocios, empleos y más.",

  // ── Módulo apagado en "Muy pronto" (pantalla completa) ───────────────────
  // El cliente lo pidió con estas palabras: «cuando le dan al Creator
  // Marketplace, dice: viene muy pronto». Tono de promesa, no de error: nadie
  // hizo nada mal, la sección todavía no abrió.
  soonMessage:
    "Todavía no abrimos esta sección. La estamos preparando y, apenas esté lista, la vas a encontrar acá.",
  soonAction: "Ver las otras categorías",

  // ── Burbuja "Publicá tu…" por sección ────────────────────────────────────
  publishPropertyTitle: "Publicá tu propiedad",
  publishPropertyHint: "Un cuarto, un apartamento o una casa entera.",

  publishEventTitle: "Publicá tu evento",
  publishEventHint: "Contale a la comunidad dónde y cuándo.",

  publishBusinessTitle: "Publicá tu negocio",
  publishBusinessHint: "Que tu gente sepa dónde encontrarte.",

  publishProfessionalTitle: "Ofrecé tu oficio",
  publishProfessionalHint: "Contá qué sabés hacer y te encuentran.",

  publishJobTitle: "Publicá tu empleo",
  publishJobHint: "Buscá gente de la comunidad para tu equipo.",

  publishProductTitle: "Vendé lo tuyo",
  publishProductHint: "Subí un producto al mercado de la comunidad.",

  publishGigTitle: "Publicá tu trabajo",
  publishGigHint: "Contá qué necesitás y los creadores te proponen.",

  // ── Buscador propio de cada listado ──────────────────────────────────────
  // Los placeholders nombran lo que se busca EN ESE listado. El de /buscar
  // enumera módulos porque busca en todos; acá ya estás adentro de uno, y
  // repetir la lista larga sólo haría dudar de dónde está parada la persona.
  moduleSearchSubmit: "Buscar",
  moduleSearchClear: "Borrar la búsqueda",
  moduleFiltersLabel: "Filtros",

  searchEventsLabel: "Buscar eventos",
  searchEventsPlaceholder: "Buscar un evento, un lugar…",
  searchBusinessLabel: "Buscar negocios",
  searchBusinessPlaceholder: "Buscar un negocio o un rubro…",
  searchJobsLabel: "Buscar empleos",
  searchJobsPlaceholder: "Buscar un puesto, un rubro…",
  searchGigsLabel: "Buscar trabajos para creadores",
  searchGigsPlaceholder: "Buscar un trabajo…",

  // Filtros de Eventos
  eventsWhenLabel: "Cuándo",
  eventsWhenUpcoming: "Próximos",
  eventsWhenMonth: "Este mes",
  eventsWhenPast: "Ya pasaron",
  eventsPriceLabel: "Entrada",
  eventsPriceAny: "Todos",
  eventsPriceFree: "Gratis",
  eventsPricePaid: "Con entrada",
  eventsCityLabel: "Ciudad",
  eventsCityAny: "Todas las ciudades",

  // Filtros de Negocios
  businessCategoryLabel: "Rubro",
  businessCategoryAny: "Todos los rubros",
  businessVerifiedFilter: "Verificados",

  // Estado vacío compartido de "busqué y no hay"
  moduleNoMatchTitle: "No encontramos nada con eso",
  moduleNoMatchMessage: "Probá con otra palabra o sacá alguno de los filtros.",
  moduleClearFilters: "Ver todo de nuevo",
} as const;
