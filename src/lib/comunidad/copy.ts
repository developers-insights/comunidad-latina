import type { LostFoundCategory, LostFoundType, ResourceTopic } from "./types";

/**
 * =============================================================================
 * COPY DEL MÓDULO COMUNIDAD
 * =============================================================================
 *
 * Español rioplatense neutro, voseo, frases cortas. Quien entra acá puede estar
 * asustado —alguien lo paró en la calle, no tiene seguro, no llegó a fin de
 * mes— así que el tono es el de un vecino que sabe dónde queda la oficina: ni
 * institucional ni condescendiente. La vara la fija
 * `src/lib/integrity/declarations.ts`.
 *
 * ── LA LÍNEA QUE NO SE CRUZA ────────────────────────────────────────────────
 * En este archivo NO hay una sola frase que le diga a alguien qué hacer ante
 * migración, ante un problema de salud o ante un trámite. Ni una. Todo lo que
 * suena a instrucción viene de una fuente citada y se lee EN la fuente.
 *
 * Cuando escribas copy nuevo acá, el test es simple: si la frase, leída sola,
 * pudiera entenderse como "Comunidad Latina me dijo que hiciera esto", está
 * mal. Reescribila hasta que se entienda como "esto lo dice tal organismo, acá
 * está el enlace".
 *
 * Por eso los avisos de abajo no son letra chica ni un modal de términos: son
 * texto de la pantalla, arriba, donde se lee. Un descargo que hay que ir a
 * buscar es un descargo que nadie leyó.
 */

export const COMUNIDAD_COPY = {
  // -------------------------------------------------------------------------
  // Índice del módulo
  // -------------------------------------------------------------------------
  index: {
    title: "Comunidad",
    subtitle: "Información útil y una mano cuando hace falta.",
    intro:
      "Acá reunimos lo que la comunidad necesita tener a mano: adónde pedir ayuda, comida o trámites, quién perdió o encontró algo cerca tuyo, y dónde sumarte si te sobra una mano para dar.",
    /**
     * Grilla de categorías (rediseño 2026-08-13, pedido textual del cliente:
     * «mantener los cuadrados iguales en la parte de búsqueda, pero en la
     * sección de comunidad»). Cada `title` es lo único que se LEE en el
     * cuadrado —mismo trato que "Vivienda" o "Marketplace" en /buscar, un
     * sustantivo corto bajo un ícono— así que acá viven acortados; el nombre
     * largo de cada sección sigue intacto como título de SU propia pantalla
     * (`recursos.title`, `guias.title`, `perdidos.title` más abajo).
     *
     * `hint` NO se ve: entra como texto accesible extra del link (screen
     * reader), porque "Guías" o "Voluntarios" solos no siempre alcanzan para
     * decidir si tocar sin abrir la pantalla — se pierde ESE contexto, no la
     * lectura visual, que tiene que quedar igual de limpia que la de /buscar.
     */
    cards: {
      recursos: {
        title: "Pedir ayuda",
        hint: "Clínicas sin seguro, consulados y oficinas de ayuda, con teléfono y dirección.",
      },
      guias: {
        title: "Guías",
        hint: "Trámites explicados paso a paso, con el enlace a la fuente oficial.",
      },
      perdidos: {
        title: "Perdido y encontrado",
        hint: "Buscá por zona lo que se te perdió, o avisá si encontraste algo.",
      },
      comida: {
        title: "Bancos de comida",
        hint: "Comedores y despensas gratuitas o a bajo costo cerca tuyo.",
      },
      voluntarios: {
        title: "Voluntarios",
        hint: "Organizaciones que reciben manos voluntarias para su trabajo comunitario.",
      },
      acopio: {
        title: "Centro de acopio",
        hint: "Dejá tu donación de ropa, comida o insumos de emergencia: no es para recibir comida, es para darla.",
      },
    },
  },

  /**
   * El aviso de procedencia. Va en el índice, arriba de los recursos y arriba
   * de las guías: las tres pantallas donde alguien podría confundir "lo leí en
   * la app" con "me lo dijo la app".
   */
  disclaimer: {
    title: "De dónde sale esta información",
    body:
      "Todo lo que ves acá lo publican organismos oficiales y organizaciones que ayudan a la comunidad. Nosotros lo reunimos en un solo lugar, te decimos quién lo dice y cuándo lo revisamos por última vez.",
    notAdvice:
      "Comunidad Latina no presta estos servicios ni da asesoramiento legal o médico. Antes de moverte, confirmá con la fuente: los horarios, los requisitos y los teléfonos cambian.",
    /** Específico de migración: el tema donde el error se paga más caro. */
    migration:
      "Sobre migración no vas a leer consejos nuestros. Vas a encontrar el enlace a quien tiene la información de primera mano, para que leas ahí lo que corresponde a tu caso.",
  },

  // -------------------------------------------------------------------------
  // Recursos
  // -------------------------------------------------------------------------
  recursos: {
    title: "Dónde pedir ayuda",
    subtitle: "Organizado por tema, con la fuente de cada dato.",
    sourceLabel: "Lo publica",
    checkedLabel: (fecha: string) => `Lo revisamos el ${fecha}`,
    openSource: "Ver la publicación original",
    contact: {
      call: "Llamar",
      website: "Sitio web",
      directions: "Cómo llegar",
      hours: "Horarios",
      cost: "Costo",
      requirements: "Qué piden",
      languages: "Atienden en",
    },
    emptyTitle: "Todavía no hay recursos cargados",
    emptyMessage:
      "Estamos armando el directorio de tu comunidad. Mientras tanto, las guías tienen los enlaces oficiales de cada trámite.",
    emptyAction: "Ver las guías",
    /**
     * Vacío de UN tema filtrado (`?tema=`, ver recursos/page.tsx) — distinto
     * del vacío de arriba, que es "no hay nada en todo el directorio". Acá
     * puede haber decenas de fichas en otros temas y cero en éste, así que el
     * mensaje no puede sonar a que la sección entera está vacía. Sólo los
     * tres temas con entrada propia en la grilla (comida, voluntariado,
     * acopio) necesitan el suyo: el resto de los temas se navegan desde la
     * lista completa, que ya resuelve su propio vacío con
     * `emptyTitle`/`emptyMessage`.
     */
    emptyTopic: {
      comida: {
        title: "Todavía no hay bancos de comida cargados",
        message:
          "Estamos sumando comedores y despensas de tu comunidad. Mientras tanto, mirá el resto de la ayuda disponible.",
      },
      voluntariado: {
        title: "Todavía no hay grupos de voluntarios cargados",
        message:
          "Estamos armando este directorio. Mientras tanto, mirá el resto de la ayuda disponible.",
      },
      acopio: {
        title: "Todavía no hay centros de acopio cargados",
        message:
          "Estamos sumando puntos de acopio de tu comunidad. Mientras tanto, mirá el resto de la ayuda disponible.",
      },
    },
    /** Vuelve a la lista completa — visible con y sin resultados en el tema. */
    allTopicsCta: "Ver toda la ayuda disponible",
  },

  // -------------------------------------------------------------------------
  // Guías (contenido de `public.guides`, leído desde acá)
  // -------------------------------------------------------------------------
  guias: {
    title: "Guías para los trámites",
    subtitle: "Escritas para leer tranquilo, con las fuentes citadas.",
    readingTime: (minutos: number) => `${minutos} min de lectura`,
    sourcesTitle: "Fuentes oficiales",
    checked: (fecha: string) => `consultada el ${fecha}`,
    updated: (fecha: string) => `Actualizada el ${fecha}`,
    back: "Volver a las guías",
    emptyTitle: "Todavía no hay guías publicadas",
    emptyMessage:
      "Cuando publiquemos la primera, la vas a ver acá. Si hay un trámite que te está costando, contanos en el feed y la escribimos.",
  },

  // -------------------------------------------------------------------------
  // Perdido y encontrado
  // -------------------------------------------------------------------------
  perdidos: {
    title: "Perdido y encontrado",
    subtitle: "Se busca y se avisa por zona.",
    publishTitle: "Publicá tu caso",
    publishHint: "Perdiste algo o encontraste algo: contalo acá y que lo vea el barrio.",
    filters: {
      areaLabel: "Zona",
      areaPlaceholder: "Ej.: Jackson Heights, Queens",
      areaHelp: "Escribí el barrio o la parada donde creés que pasó.",
      typeLabel: "Qué estás mirando",
      all: "Todo",
      lost: "Se perdió",
      found: "Se encontró",
      categoryLabel: "Tipo de cosa",
      allCategories: "Todas",
      apply: "Buscar",
      clear: "Limpiar filtros",
    },
    card: {
      lostBadge: "Se perdió",
      foundBadge: "Se encontró",
      resolvedBadge: "Ya apareció",
      happenedOn: (fecha: string) => `Pasó el ${fecha}`,
      noArea: "Sin zona indicada",
      openCase: "Ver el caso",
    },
    detail: {
      contactTitle: "¿Es tuyo? ¿Lo viste?",
      contactHint:
        "Escribile por mensaje privado a quien publicó. No pongas tus datos en un comentario público.",
      contactCta: "Enviar un mensaje",
      resolvedTitle: "Este caso ya se resolvió",
      resolvedBody: "Quien lo publicó avisó que apareció. Lo dejamos visible para que nadie siga buscando.",
      photosLabel: "Fotos del caso",
      reportHint: "¿Algo no cierra? Reportalo y lo miramos.",
    },
    resolve: {
      markCta: "Ya apareció",
      markHint: "Cuando lo marques, dejamos de mostrarlo como caso abierto.",
      undoCta: "Volver a abrir el caso",
      markedOk: "Listo, lo marcamos como resuelto.",
      reopenedOk: "Listo, el caso vuelve a estar abierto.",
      failed: "No pudimos marcarlo. Probá de nuevo en un momento.",
    },
    empty: {
      title: "Todavía no hay casos por acá",
      message:
        "Nadie publicó nada en esta zona. Si perdiste o encontraste algo, publicalo vos: así arranca.",
      filteredTitle: "No encontramos casos con esos filtros",
      filteredMessage:
        "Probá con una zona más amplia o sacá alguno de los filtros. A veces se publica con el nombre del barrio de al lado.",
      cta: "Publicar un caso",
    },
    /** Aviso de privacidad del propio módulo, no del contenido de terceros. */
    privacyNote:
      "Publicá lo justo para reconocer la cosa: sin número de documento, sin dirección exacta, sin datos que sirvan para hacerse pasar por vos.",
  },

  // -------------------------------------------------------------------------
  // Publicar un caso
  // -------------------------------------------------------------------------
  publicar: {
    title: "Publicá tu caso",
    subtitle: "Son tres pasos y toma un minuto.",
    steps: {
      what: {
        title: "¿Qué pasó?",
        typeLabel: "Elegí una",
        lost: "Perdí algo",
        found: "Encontré algo",
        categoryLabel: "¿Qué es?",
        titleLabel: "Contalo en una línea",
        titlePlaceholder: "Ej.: Mochila azul con cuadernos",
        titleHelp: "Lo que se lee primero en la lista.",
        descriptionLabel: "Los detalles",
        descriptionPlaceholderLost:
          "¿Cómo es? ¿Tiene alguna marca o algo adentro que lo distinga? ¿En qué momento del día fue?",
        descriptionPlaceholderFound:
          "¿Cómo es? ¿Dónde lo tenés guardado ahora? Guardate un detalle sin contar, así podés confirmar que es de quien dice.",
        descriptionHelp:
          "Si encontraste algo, no cuentes todo: guardarte un detalle es lo que te deja confirmar que sos el dueño.",
      },
      where: {
        title: "¿Dónde y cuándo?",
        areaLabel: "Zona",
        areaPlaceholder: "Ej.: Jackson Heights, Queens",
        areaHelp: "Un barrio o una parada alcanza. Nunca pongas tu dirección.",
        dateLabel: "¿Qué día fue?",
        dateHelp: "Si no te acordás exacto, poné el más cercano.",
      },
      photos: {
        title: "Una foto ayuda muchísimo",
        hint: "Podés subir hasta 4. Si encontraste algo, mostralo sin que se lean los datos personales que tenga.",
        add: "Agregar foto",
        remove: "Sacar esta foto",
        tooBig: "Esa foto es muy pesada. Probá con otra o sacale una nueva.",
      },
    },
    submit: "Publicar el caso",
    submitting: "Publicando…",
    back: "Atrás",
    next: "Seguir",
    donePublished: {
      title: "Listo, ya está publicado",
      body: "Tu caso ya se ve en la sección. Cuando aparezca, marcalo como resuelto para que nadie siga buscando.",
    },
    donePending: {
      title: "Lo estamos revisando",
      body: "Es un paso normal y suele ser rápido. Apenas pase la revisión, aparece en la sección.",
    },
    seeSection: "Ir a Perdido y encontrado",
    publishAnother: "Publicar otro caso",
    needLogin: "Entrá a tu cuenta para publicar",
    errors: {
      generic: "No pudimos publicarlo. Revisá los datos y probá de nuevo.",
      title: "Contanos en una línea qué pasó (al menos 6 letras).",
      description: "Escribí un poco más de detalle: con 20 letras alcanza para empezar.",
      area: "Necesitamos la zona, aunque sea el barrio.",
      date: "Esa fecha no nos cierra. Poné un día de los últimos dos años.",
      upload: "No pudimos subir la foto. Probá de nuevo o publicá sin foto.",
      auth: "Se cerró tu sesión. Entrá de nuevo y no perdés lo que escribiste.",
    },
  },
} as const;

// ---------------------------------------------------------------------------
// Etiquetas de los valores cerrados
// ---------------------------------------------------------------------------

/** Los diez temas del directorio, en voz de quien busca. */
export const RESOURCE_TOPIC_LABEL: Record<ResourceTopic, string> = {
  emergencias: "Emergencias",
  migracion: "Migración y trámites",
  salud: "Salud sin seguro",
  comida: "Comida y alimentos",
  consulados: "Consulados",
  legal: "Ayuda legal",
  vivienda: "Vivienda y refugio",
  educacion: "Educación e idioma",
  voluntariado: "Grupos de voluntarios",
  acopio: "Centro de acopio",
};

/** Una línea por tema: qué vas a encontrar ahí adentro. */
export const RESOURCE_TOPIC_HINT: Record<ResourceTopic, string> = {
  emergencias: "Líneas que atienden a cualquier hora.",
  migracion: "Oficinas y organizaciones que informan sobre trámites.",
  salud: "Clínicas y centros que atienden sin seguro.",
  comida: "Despensas y comedores comunitarios.",
  consulados: "Consulados y sus servicios para connacionales.",
  legal: "Organizaciones con asistencia legal gratuita o a bajo costo.",
  vivienda: "Refugios y programas de ayuda con la vivienda.",
  educacion: "Clases de inglés, terminar la secundaria, formación.",
  voluntariado: "Organizaciones que suman voluntarios para comedores, refugios y otras tareas del barrio.",
  acopio: "Adónde llevar ropa, comida o insumos para donar, y qué hace falta en cada lugar ahora mismo.",
};

export const LOST_FOUND_TYPE_LABEL: Record<LostFoundType, string> = {
  lost: "Se perdió",
  found: "Se encontró",
};

export const LOST_FOUND_CATEGORY_LABEL: Record<LostFoundCategory, string> = {
  documentos: "Documentos",
  llaves: "Llaves",
  telefono: "Teléfono",
  billetera: "Billetera o cartera",
  mochila: "Mochila o bolso",
  mascota: "Mascota",
  otro: "Otra cosa",
};
