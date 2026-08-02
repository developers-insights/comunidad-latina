import { SHORT_VIDEO_LIMIT_MESSAGE } from "@/lib/media/video-policy";

/**
 * Copy del módulo FEED SOCIAL — español cálido, directo, sin jerga (§5 del
 * contrato). Ningún string de UI hardcodeado en JSX de páginas.
 */
export const COPY = {
  header: {
    title: "Tu comunidad",
    subtitleNearArea: (area: string) => `Lo que está pasando cerca de ${area}`,
    subtitleDefault: "Lo que está pasando en tu comunidad",
  },

  tabs: {
    paraTi: "Para ti",
    propiedades: "Propiedades",
    negocios: "Negocios",
    profesionales: "Profesionales",
    eventos: "Eventos",
    ariaLabel: "Secciones del feed",
  },

  composer: {
    addPhoto: "Agregar foto",
    addPhotos: "Agregar fotos",
    addMorePhotos: "Sumar otra foto",
    changePhoto: "Cambiar foto",
    removePhoto: "Quitar foto",
    photoTooBig: "Esa foto es muy pesada — probá con una de menos de 5 MB.",
    photoWrongType: "Solo podemos subir fotos (JPG, PNG o WebP).",
    /** Hasta 4 fotos por publicación (sprint reels 2026-07-21). */
    photoLimit: "Podés subir hasta 4 fotos por publicación.",
    // Algún medio sigue siendo obligatorio (feed visual, no periódico): si
    // aprietan Publicar sin foto NI video, este aviso cálido los lleva al
    // recuadro en vez de un botón muerto.
    photoMissingTitle: "Te falta la foto",
    photoMissingBody: "Sumá una imagen y ya podés publicar tu post.",
    mediaMissingTitle: "Te falta la foto o el video",
    mediaMissingBody: "Sumá al menos una foto o un video y ya podés publicar.",
    // Video (sprint reels): 1 por publicación, MP4/WebM, hasta 60 MB.
    addVideo: "Agregar video",
    removeVideo: "Quitar video",
    videoChip: "Video",
    videoTooBig: "Ese video es muy pesado — probá con uno de menos de 60 MB.",
    videoWrongType: "Solo podemos subir videos MP4 o WebM.",
    videoLimit: "Por ahora va un video por publicación.",
    videoUploading: (percent: number) => `Subiendo tu video… ${percent}%`,
    videoUploadErrorTitle: "No pudimos subir el video",
    videoUploadErrorBody: "Revisá tu conexión y probá de nuevo en un ratito.",
    /**
     * TOPE DE 90 s (spec nº4). El título y el cuerpo salen del módulo de
     * política: el texto es literal y tiene que ser el MISMO que devuelve el
     * servidor cuando rebota la publicación. Acá no se reescribe, se muestra.
     */
    videoTooLongTitle: "Ese video es muy largo",
    videoTooLongBody: SHORT_VIDEO_LIMIT_MESSAGE,
    /** El navegador no pudo leer la duración: sin ese dato no se publica. */
    videoUnknownDurationTitle: "No pudimos leer la duración",
    videoUnknownDurationBody:
      "Probá con otro archivo MP4 o WebM. Necesitamos saber cuánto dura para publicarlo.",
    videoMeasuring: "Revisando el video…",
    publish: "Publicar",
    publishing: "Publicando…",
    successTitle: "¡Publicado!",
    successBody: "Tu publicación ya está visible para la comunidad.",
    reviewTitle: "Tu publicación está en revisión",
    reviewBody:
      "El equipo la va a mirar en breve. Apenas esté aprobada, la va a ver toda la comunidad.",
    photoErrorTitle: "No pudimos subir la foto",
    photoErrorBody: "Probá de nuevo en un ratito con otra foto.",
    errorTitle: "No se pudo publicar",
    errorBody: "Algo no cargó bien de nuestro lado — no es tu culpa. Probá de nuevo.",
    // Tope de publicaciones por hora (`createPostAction`). NO puede caer en el
    // copy de arriba: "no es tu culpa / algo falló de nuestro lado" es falso
    // acá —no falló nada— y además no le dice a la persona qué hacer. Lo que
    // más importa es sacarle el miedo: para nuestro público, que la app frene
    // algo se lee como "me bloquearon la cuenta".
    rateLimitedTitle: "Publicaste muchas cosas seguidas",
    rateLimitedBody: "Esperá un rato y seguí publicando. Tu cuenta está bien.",
    tooShort: "Contanos un poquito más — al menos un par de palabras.",
    // Modo pregunta (menú crear-post, rediseño 2026-07-26): chip removible que
    // marca el kind='question' — el post visible en la card usa su PROPIO
    // copy (COPY.post.questionChip); esta es la del composer, antes de publicar.
    questionModeChip: "Pregunta",
    questionModeRemove: "Salir del modo pregunta",

    /**
     * PASO DE TEXTO (rediseño 2026-07-27, feedback del cliente: "no está el
     * escrito aparte y aparte la foto, sino das una foto y en la foto te da el
     * acceso [para] poner el comentario"). Elegido el medio, se abre una hoja
     * con el medio a la vista y el texto debajo — el modelo de Instagram.
     */
    compose: {
      mediaTitle: "Contá de qué se trata",
      /**
       * El texto invita a hablar de LO QUE SE VE, no de la nada: cambia según
       * lo que la persona acaba de elegir (una foto, varias, o un video).
       */
      mediaPlaceholder: (photos: number, hasVideo: boolean): string => {
        if (hasVideo && photos === 0) return "¿Qué querés contar de este video?";
        if (hasVideo) return "¿Qué querés contar de lo que subiste?";
        if (photos > 1) return "¿Qué querés contar de estas fotos?";
        return "¿Qué querés contar de esta foto?";
      },
      questionTitle: "Preguntale a tu comunidad",
      questionPlaceholder: "¿Qué querés preguntar?",
      /**
       * Modo TEXTO (2026-07-29, pedido de Manuel): una actualización simple,
       * sin la forma de pregunta ni su encuesta. Mismo patrón de vista previa
       * que la pregunta —el cuerpo ES la pieza gráfica (TextBanner)— pero con
       * su propio título y placeholder: "contale" invita a compartir, no a
       * consultar.
       */
      textTitle: "Contale algo a tu comunidad",
      textPlaceholder: "¿Qué querés compartir?",
      /** Encabeza la vista previa del banner de la pregunta o del texto. */
      previewLabel: "Así se va a ver",
      /**
       * CATEGORÍA DEL VIDEO (0046) — opcional, con default. La pregunta es "de
       * qué se trata" y no "elegí una categoría" porque lo primero es lo que la
       * persona sabe responder; y el beneficio se dice al lado (que lo
       * encuentren), que es lo que la hace valer la pena.
       */
      videoCategoryLabel: "¿De qué se trata tu video?",
      videoCategoryHint:
        "Así lo encuentran en Videos Cortos. Podés cambiarlo cuando quieras.",
      /** Encuesta Sí/No opcional (contrato 0041). */
      pollLabel: "Agregar encuesta de Sí o No",
      pollHint: "Tu comunidad responde con un toque y vas viendo los votos.",
      close: "Cerrar",
      publishQuestion: "Publicar pregunta",
      /** Cupo de fotos y video, visible mientras se arma la publicación. */
      mediaCount: (photos: number, hasVideo: boolean): string => {
        const parts: string[] = [];
        if (photos > 0) parts.push(photos === 1 ? "1 foto" : `${photos} fotos`);
        if (hasVideo) parts.push("1 video");
        return parts.join(" · ");
      },
    },

    /**
     * Menú "crear publicación" (feedback cliente 2026-07-24: "menú crear-post"
     * pendiente). Una fila-disparador abre un BottomSheet con TODOS los tipos
     * que se pueden crear desde la comunidad — no solo el post con foto/video,
     * también un acceso directo a cada módulo (vivienda, negocios, etc.).
     *
     * Rediseño 2026-07-27: ESTE es el único disparador del composer. Los dos
     * recuadros grandes de "Agregar foto / Agregar video" se fueron ("tiene
     * mucho espacio blanco esta parte tan grande de aquí"): la foto y el video
     * ahora se eligen DENTRO del flujo que abre cada opción.
     */
    createMenu: {
      rowLabel: "¿Qué querés publicar?",
      rowHint: "Foto, video, texto, pregunta y todo lo demás",
      sheetTitle: "Elegí qué publicar",
      tiles: {
        photo: {
          title: "Foto",
          description: "Compartí una o varias fotos con tu comunidad.",
        },
        video: {
          title: "Video",
          description: "Subí un video corto, hasta 60 MB.",
        },
        text: {
          title: "Texto",
          description: "Contale algo a tu comunidad, sin necesidad de foto.",
        },
        question: {
          title: "Pregunta",
          description: "Consultale algo a tu comunidad, sin necesidad de foto.",
        },
        property: {
          title: "Propiedad",
          description: "Publicá un alquiler o una venta.",
        },
        business: {
          title: "Negocio",
          description: "Sumá tu negocio al directorio de la comunidad.",
        },
        professional: {
          title: "Profesional",
          description: "Ofrecé tus servicios como profesional.",
        },
        event: {
          title: "Evento",
          description: "Invitá a tu comunidad a un evento.",
        },
        job: {
          title: "Empleo",
          description: "Publicá una búsqueda de personal.",
        },
        product: {
          title: "Producto",
          description: "Vendé un producto de tu negocio en el marketplace.",
        },
        creatorService: {
          title: "Servicio de creador",
          description: "Contratá a un creador de contenido para tu negocio.",
        },
      },
    },
  },

  inviteCard: {
    title: "Unite a la conversación",
    body: "Con tu cuenta podés publicar, preguntar y responderle a tus vecinos. Te toma un minuto.",
    cta: "Crear mi cuenta",
    secondary: "Ya tengo cuenta",
  },

  post: {
    questionChip: "Pregunta",
    // Banner de pregunta (feedback cliente 2026-07-26: "que siempre tenga un
    // banner o algo"): cuando la pregunta no entra entera en el banner del feed,
    // esta píldora avisa que hay más y que tocando se lee completa.
    questionReadFull: "Ver la pregunta completa",
    // Mismo mecanismo del TextBanner (2026-07-29), en genérico: un texto no es
    // "una pregunta", así que la píldora no puede decir "pregunta".
    textReadFull: "Ver completo",

    /**
     * ENCUESTA SÍ / NO de una pregunta (contrato 0041, feedback cliente
     * 2026-07-27: "acá viene sí o no, y viene el cuadro así para irse llenando
     * los votos… sale 30 sí, 50 no").
     *
     * Los dos botones son los MISMOS antes y después de votar: al votar se
     * llenan con la barra de resultados. Por eso no hay copy de "cambiar voto"
     * como acción aparte — tocar la otra opción ya la cambia, y el hint lo dice.
     */
    poll: {
      groupLabel: "Encuesta: sí o no",
      yes: "Sí",
      no: "No",
      voteYes: "Votar que sí",
      voteNo: "Votar que no",
      /** Resultado por opción: "30 · 37%". Compacto y con las dos cifras. */
      result: (votes: number, percent: number) => `${votes} · ${percent}%`,
      totalVotes: (votes: number) =>
        votes === 1 ? "1 voto" : `${votes} votos`,
      noVotesYet: "Todavía nadie votó",
      changeHint: "Podés cambiar tu voto",
      errorTitle: "No pudimos registrar tu voto",
      errorBody: "Puede ser un ratito de conexión floja — no es tu culpa. Probá de nuevo.",
    },
    // FTC honesto: la campaña paga se divulga, igual que el impulso de un aviso.
    // "Patrocinado" y no "Publicidad" desde el contrato del 2026-07-30 (§4): es
    // la palabra que la spec pide para el contenido pago, y tiene que ser LA
    // MISMA en el feed, en el reel, en los resultados de búsqueda y en los
    // avisos impulsados — si cada superficie usa la suya, la divulgación deja de
    // leerse como una sola cosa. Tampoco puede ser "Destacado": esa palabra es
    // el nivel máximo del Trust Score, que se gana por reputación y no se paga.
    adChip: "Patrocinado",
    /**
     * VISTA PREVIA EN LA TARJETA (spec nº3/nº6): el feed reproduce hasta 59 s;
     * el video completo se abre desde la publicación. Se dice, no se esconde —
     * si no, el corte parece un video roto.
     */
    previewChip: "Vista previa",
    previewHint: "Tocá para verlo completo",
    /** Nombre accesible del toque cuando lo que se ve es sólo un anticipo. */
    playFullVideo: "Ver el video completo",
    /** "· por {nombre}" bajo el nombre de la entidad. */
    byAuthor: (name: string) => `por ${name}`,
    /** Badge que solo ve el autor en el detalle de un post promocionado. */
    campaignActiveBadge: (date: string) => `Campaña activa hasta el ${date}`,
    communityMember: "Alguien de la comunidad",
    like: "Me gusta",
    unlike: "Quitar me gusta",
    comments: "Comentarios",
    share: "Compartir",
    shareCopiedTitle: "Link copiado",
    shareCopiedBody: "Pegalo donde quieras para compartir la publicación.",
    // Guardar (tabla saves, 0038): la publicación queda a mano para después.
    // Dos etiquetas, como en me gusta: el botón dice lo que HACE, no el estado
    // (y el botón es solo ícono, así que no hay texto visible que contradiga la
    // etiqueta accesible — WCAG 2.5.3).
    save: "Guardar",
    unsave: "Quitar de guardados",
    saveErrorTitle: "No pudimos guardarla",
    saveErrorBody: "Puede ser un ratito de conexión floja — no es tu culpa. Probá de nuevo.",
    openPost: "Ver publicación y comentarios",
    inReviewBanner:
      "Tu publicación está en revisión. Apenas esté aprobada, la va a ver toda la comunidad.",
    removedBanner:
      "Esta publicación fue retirada por el equipo de moderación de tu comunidad.",
    menuLabel: "Más opciones",
    // Foto a pantalla completa: el visor se abre al tocar la foto UNA vez (el
    // doble toque es "me gusta", como en Instagram).
    openPhoto: "Ver la foto en grande",
    // Video en el feed: arranca solo y en silencio; el sonido se activa a mano.
    playVideo: "Ver el video",
    muteVideo: "Silenciar el video",
    unmuteVideo: "Activar el sonido",
    // CTA de una campaña paga (SOLO posts promocionados) sobre la foto. El chip
    // "Publicidad" va aparte y SIEMPRE visible: eso es la divulgación honesta;
    // esto es el llamado a la acción, con el texto de lo que la campaña ofrece.
    boostCta: {
      property: "Ver propiedad",
      event: "Comprar entradas",
      business: "Ver negocio",
      professional: "Agendar cita",
      job: "Postularme",
    } as Record<string, string>,
    boostCtaFallback: "Ver más",
    // Botón extra de la campaña cuando el anunciante dejó un WhatsApp: abre el
    // chat directo. Convive con el CTA de la entidad, nunca lo reemplaza.
    boostCtaWhatsapp: "WhatsApp",
  },

  report: {
    sheetTitle: "Reportar esta publicación",
    reasonLegend: "¿Qué pasó?",
    detailsLabel: "Contanos un poco más (opcional)",
    detailsPlaceholder: "Lo que nos cuentes ayuda al equipo a revisar más rápido.",
    submit: "Enviar reporte",
    successTitle: "Reporte enviado",
    successBody: "Gracias por cuidar a tu comunidad. El equipo lo revisa en breve.",
    errorTitle: "No se pudo enviar el reporte",
    errorBody: "Probá de nuevo en unos minutos — no es tu culpa.",
    needsAuth: "Necesitás una cuenta para reportar. Entrá y volvé a intentarlo.",
    detailsRequired: "Contanos brevemente qué pasó, así el equipo puede revisarlo bien.",
  },

  comments: {
    title: "Comentarios",
    placeholder: "Escribí tu comentario…",
    send: "Comentar",
    emptyTitle: "Sé la primera persona en responder",
    emptyMessage: "Tu respuesta puede ser justo lo que este vecino necesita.",
    flaggedTitle: "No pudimos publicar tu comentario",
    flaggedBody:
      "Puede romper las reglas de la comunidad. Reformulalo con otras palabras y probá de nuevo.",
    errorTitle: "No se pudo comentar",
    errorBody: "Algo no cargó bien de nuestro lado — no es tu culpa. Probá de nuevo.",
    signInPrompt: "Entrá a tu cuenta para responder",
    // Estado de la HOJA de comentarios (feed): el hilo se trae en el cliente al
    // abrir, así que aparecen carga/vacío/error que el SSR del detalle no tiene.
    loadErrorTitle: "No pudimos cargar los comentarios",
    loadErrorBody: "Puede ser la conexión. Volvé a intentar en un momento.",
    retry: "Reintentar",
    // Comentario optimista: se ve al instante mientras viaja al servidor (que no
    // se corte la emoción — feedback del cliente). Ocupa el lugar del "hace un rato".
    sending: "Enviando…",
  },

  listing: {
    viewDetails: "Ver detalles",
    kindLabel: {
      business: "Negocio",
      professional: "Profesional",
      event: "Evento",
      job: "Empleo",
      product: "Producto",
      creator_gig: "Trabajo para creadores",
    } as Record<string, string>,
    // §11: nunca "Verificado" a secas — la afirmación es sobre la licencia,
    // igual que en el directorio y la VerificationBand del detalle.
    verifiedChip: (date: string) => `Licencia activa al ${date}`,
    externalPublisher: (name: string) => `Publicado por ${name}`,
    communityMember: "Alguien de la comunidad",
    sheetPublishedBy: "Publicado por",
    sheetDirectoryCta: "Ver el directorio de negocios",
    sheetClose: "Cerrar",
    sheetSafety:
      "Nunca envíes dinero por adelantado sin verificar en persona o por video con quién estás tratando.",
  },

  guide: {
    chip: "Guía destacada",
    read: (minutes: number | null) =>
      minutes ? `Leer (${minutes} min)` : "Leer la guía",
  },

  feed: {
    loadMore: "Ver más",
    emptyParaTiTitle: "Todavía no hay movimiento en tu zona",
    emptyParaTiMessage:
      "Sé de los primeros: contale algo a tu comunidad o publicá un aviso.",
    emptyParaTiCta: "Publicar un aviso",
    emptyListingsTitle: "Todavía no hay avisos acá",
    emptyListingsMessage:
      "Apenas alguien de tu comunidad publique en esta sección, lo vas a ver acá.",
    emptyListingsCta: "Publicar un aviso",
    // Scroll infinito (módulo FLUIDEZ): el "Ver más" de arriba sigue como
    // fallback accesible; estos cubren los estados nuevos del acumulado.
    loadingMore: "Cargando más publicaciones…",
    loadMoreErrorTitle: "No pudimos cargar más publicaciones",
    loadMoreErrorBody: "Puede ser un ratito de conexión floja — no es tu culpa.",
    retry: "Reintentar",
    // Pull-to-refresh (solo táctil, arriba del todo del feed).
    pullToRefreshHint: "Deslizá hacia abajo para actualizar",
    pullToRefreshRelease: "Soltá para actualizar",
    refreshing: "Actualizando tu feed…",
  },

  detail: {
    backToFeed: "Volver al feed",
    notFoundTitle: "No encontramos esa publicación",
    notFoundMessage:
      "Puede que se haya retirado o que el link esté incompleto. Volvé al feed para ver lo último.",
  },
} as const;
