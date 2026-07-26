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
    // Simplificado en el rediseño 2026-07-26: el saludo por franja ya no vive
    // SOLO en el placeholder — ahora es una línea visible propia (ver
    // `greetingByHour` abajo), así que el placeholder vuelve a ser neutro.
    placeholder: "Contale algo a tu comunidad…",
    /**
     * Saludo visible bajo el input (rediseño 2026-07-26, antes vivía solo como
     * placeholder — pedido cliente 2026-07-21 original): CUATRO franjas —
     * madrugada, mañana, tarde, noche —, cada una cálida y con nombre de pila
     * cuando el perfil lo tiene (firstNameOf sobre viewerName). Se resuelve en
     * el cliente tras montar (la hora es del USUARIO, no existe en el server)
     * — antes de eso el composer no muestra esta línea (evita mismatch de
     * hidratación, mismo criterio que el resto del proyecto).
     */
    greetingByHour: (hour: number, firstName?: string | null): string => {
      const name = firstName?.trim() || "";
      if (hour >= 5 && hour < 12) {
        return name
          ? `Buenos días, ${name} ☀️ ¿Qué se cuenta hoy?`
          : "Buenos días ☀️ ¿Qué se cuenta hoy en tu comunidad?";
      }
      if (hour >= 12 && hour < 19) {
        return name
          ? `Buenas tardes, ${name} 🌤️ ¿Qué anda pasando por el barrio?`
          : "Buenas tardes 🌤️ ¿Qué anda pasando por el barrio?";
      }
      if (hour >= 19) {
        return name
          ? `Buenas noches, ${name} 🌙 Contale a tu comunidad cómo te fue hoy.`
          : "Buenas noches 🌙 Contale a tu comunidad cómo te fue hoy.";
      }
      // Madrugada (0–4): mismo saludo que la noche —en español no hay uno
      // propio para esta franja—, pero con un guiño a quien sigue despierto.
      return name
        ? `Buenas noches, ${name} 🌙 Si seguís despierto, contanos qué se te cruza por la cabeza.`
        : "Buenas noches 🌙 Si seguís despierto, contanos qué se te cruza por la cabeza.";
    },
    addPhoto: "Agregar foto",
    addPhotos: "Agregar fotos",
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
    tooShort: "Contanos un poquito más — al menos un par de palabras.",
    // Modo pregunta (menú crear-post, rediseño 2026-07-26): chip removible que
    // marca el kind='question' — el post visible en la card usa su PROPIO
    // copy (COPY.post.questionChip); esta es la del composer, antes de publicar.
    questionModeChip: "Pregunta",
    questionModeRemove: "Salir del modo pregunta",
    /**
     * Menú "crear publicación" (feedback cliente 2026-07-24: "menú crear-post"
     * pendiente). Una fila-disparador abre un BottomSheet con TODOS los tipos
     * que se pueden crear desde la comunidad — no solo el post con foto/video,
     * también un acceso directo a cada módulo (vivienda, negocios, etc.).
     */
    createMenu: {
      rowLabel: "¿Qué querés publicar?",
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
    // FTC honesto: la campaña paga se divulga (igual que "Destacado" de boosts).
    adChip: "Publicidad",
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
