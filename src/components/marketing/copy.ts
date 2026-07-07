/**
 * COPY del módulo marketing (landing pública + guías SEO).
 * Local al módulo por contrato (ARQUITECTURA §8) — NO toca src/lib/i18n/*.
 * Tono: español cálido rioplatense-neutro, cero jerga técnica.
 * Copy legal §11: descriptor literal + fecha + disclaimer, SIEMPRE.
 */

/** Gentilicio plural por tenant para el H1 emocional. Fallback cálido y neutro. */
const GENTILICIOS: Record<string, string> = {
  dominicanos: "los dominicanos",
  comunidadlatina: "los latinos",
};

export function gentilicioDe(slug: string): string {
  return GENTILICIOS[slug] ?? "los nuestros";
}

export const COPY = {
  hero: {
    badge: "Comunidad con verificación anti-estafa",
    h1: (gentilicio: string) =>
      `El lugar donde ${gentilicio} que llegan encuentran a su gente y resuelven su vida — sin caer en estafas.`,
    subhead:
      "Vivienda revisada, guías paso a paso para tus trámites y un escudo que revisa registros oficiales antes de que entregues un peso. Estamos empezando por lo más urgente: que consigas dónde vivir sin que te roben el depósito.",
    ctaPrimary: "Sumate a tu comunidad",
    ctaSecondary: "Explorar sin cuenta",
  },

  pillars: {
    title: "Resolvé tu llegada",
    subtitle: "Esto es lo que ya funciona hoy. Lo demás lo vamos abriendo con la comunidad — sin promesas vacías.",
    items: [
      {
        key: "vivienda",
        title: "Vivienda sin estafas",
        body: "Habitaciones y apartamentos publicados con datos claros: precio, zona y quién publica. Sin dirección exacta hasta que haya contacto real.",
        href: "/propiedades",
        cta: "Ver propiedades",
      },
      {
        key: "escudo",
        title: "Escudo Anti-Estafa",
        body: "Consultamos registros públicos y te mostramos exactamente qué dicen y a qué fecha. Si algo huele mal, lo reportás con un toque.",
        href: "/escudo",
        cta: "Conocer el escudo",
      },
      {
        key: "guias",
        title: "Guías para tu llegada",
        body: "ITIN, licencia de conducir, tus derechos: paso a paso en tu idioma, con las fuentes oficiales citadas y a la vista.",
        href: "/guias",
        cta: "Leer las guías",
      },
    ],
  },

  verification: {
    title: "La confianza acá se muestra, no se promete",
    subtitle: "Así funciona la verificación, sin letra chica:",
    steps: [
      {
        title: "Consultamos el registro oficial",
        body: "Licencias, matrículas y registros públicos del estado — la misma fuente que consultaría un abogado.",
      },
      {
        title: "Te mostramos lo que encontramos, textual y con fecha",
        body: "Nada de sellos mágicos: leés el dato literal del registro y el día exacto en que lo consultamos.",
      },
      {
        title: "Vos decidís, con la información a la vista",
        body: "Una verificación nunca garantiza la conducta de nadie. Por eso la regla de oro: nunca envíes dinero por adelantado.",
      },
    ],
    exampleLabel: "Así se ve en un aviso:",
    exampleDescriptor:
      "Licencia activa según el Registro de Notarios Públicos — NY Department of State al 6 de julio de 2026.",
    exampleDisclaimer:
      "Esto NO garantiza conducta — nunca envíes dinero por adelantado.",
  },

  guides: {
    title: "Guías para resolver tu llegada",
    subtitle: "Escritas en tu idioma, con cada fuente oficial citada y fechada.",
    allLink: "Ver todas las guías",
    readingTime: (min: number) => `${min} min de lectura`,
  },

  listings: {
    title: "Publicado hace poco en tu comunidad",
    subtitle: "Avisos reales, con zona aproximada y quién publica siempre a la vista.",
    allLink: "Ver todas las propiedades",
    perMonth: "/mes",
    noPhoto: "Foto pendiente",
  },

  business: {
    title: "¿Tenés un negocio?",
    body: "Presencia verificada para tu comunidad: que te encuentren los tuyos, con tus datos revisados contra registros públicos.",
    cta: "Conocer la presencia verificada",
  },

  footer: {
    tagline: "Hecho para la comunidad, con la comunidad.",
    exploreTitle: "Explorar",
    explore: [
      { label: "Propiedades", href: "/propiedades" },
      { label: "Guías", href: "/guias" },
      { label: "Escudo Anti-Estafa", href: "/escudo" },
    ],
    communityTitle: "Comunidad",
    community: [
      { label: "Sumate", href: "/registro" },
      { label: "Para negocios", href: "/negocios/presencia" },
    ],
    legalTitle: "Legal",
    legalPlaceholders: ["Términos de uso", "Privacidad", "Normas de la comunidad"],
    soon: "Pronto",
    disclaimer:
      "Las verificaciones de esta comunidad describen lo que dice un registro público a una fecha exacta — por ejemplo: “Licencia activa según el registro al 6 de julio de 2026”. Esto NO garantiza la conducta de ninguna persona o negocio. Nunca envíes dinero por adelantado.",
  },

  guidesIndex: {
    title: "Guías para tu llegada",
    subtitle:
      "Trámites explicados paso a paso, en tu idioma y con las fuentes oficiales citadas. Verificá siempre en la fuente: los trámites cambian.",
    searchPlaceholder: "Buscar por tema: ITIN, licencia, derechos…",
    allTopics: "Todas",
    results: (n: number) => (n === 1 ? "1 guía" : `${n} guías`),
    emptyTitle: "No encontramos guías con esa búsqueda",
    emptyMessage: "Probá con otra palabra — o contanos qué trámite necesitás resolver y lo sumamos.",
    emptyAction: "Limpiar búsqueda",
  },

  guideDetail: {
    updated: (date: string) => `Actualizada el ${date}`,
    sourcesTitle: "Fuentes oficiales",
    sourcesChecked: (date: string) => `Consultada el ${date}`,
    sourcesDisclaimer:
      "Verificá siempre en la fuente oficial — los trámites y requisitos cambian.",
    saveOffline: "Guardar para leer sin conexión",
    savedOffline: "Guardada en este dispositivo",
    savedToast: "Guardada — disponible sin conexión en este dispositivo",
    removedToast: "La sacamos de tus guías guardadas",
    saveError: "No pudimos guardarla en este dispositivo — probá de nuevo.",
    ctaTitle: "¿Te sirvió esta guía?",
    ctaBody:
      "En la comunidad hay gente que ya pasó por esto y puede darte una mano — y avisos de vivienda con datos verificados.",
    ctaButton: "Sumate a tu comunidad",
    backToGuides: "Todas las guías",
  },

  language: {
    label: "Idioma",
    enSoonTitle: "English is coming",
    enSoonBody: "Estamos traduciendo la comunidad. Por ahora, todo en español.",
  },
} as const;

/** Rótulo humano de quién publica un aviso (publisher_kind del seed). */
export const PUBLISHER_LABELS: Record<string, string> = {
  particular: "Particular",
  inmobiliaria: "Inmobiliaria",
  negocio: "Negocio",
  organizacion: "Organización",
};

/** Covers editoriales conocidos por slug (assets premium en /public/images). */
export const GUIDE_COVERS: Record<string, string> = {
  "como-sacar-itin-sin-ssn": "/images/guia-cover-itin.png",
};
