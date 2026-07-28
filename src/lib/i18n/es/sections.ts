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
  searchSubtitle: "Elegí una categoría. Adentro buscás con más detalle.",
  searchCategories: "Categorías de la comunidad",

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
} as const;
