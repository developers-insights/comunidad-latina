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
    placeholder: "¿Qué está pasando en tu comunidad?",
    questionToggle: "Pregunta",
    questionHint: "Marcala como pregunta para que los vecinos te respondan.",
    addPhoto: "Agregar foto",
    changePhoto: "Cambiar foto",
    removePhoto: "Quitar foto",
    photoTooBig: "Esa foto es muy pesada — probá con una de menos de 5 MB.",
    photoWrongType: "Solo podemos subir fotos (JPG, PNG o WebP).",
    // Foto obligatoria en posts (no en preguntas): feed visual, no periódico.
    photoRequiredHint: "Tu post necesita una foto — así el feed se mantiene lindo de mirar.",
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
    // "Publicar como": Yo (personal) o una de mis entidades (listing propio).
    publishAsLabel: "Publicar como",
    publishAsYou: "Yo",
    publishAsHint: "Elegí si publicás vos o una de tus páginas.",
    entityFollowersNote:
      "Lo van a ver tus seguidores. Para llegar a todos, promocionalo después de publicar.",
    entitySuccessTitle: "¡Publicado!",
    entitySuccessBody: "Ya lo ven tus seguidores. ¿Querés que llegue a toda la comunidad?",
    promoteCta: "Promocionar",
    promoteDismiss: "Ahora no",
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
    openPost: "Ver publicación y comentarios",
    inReviewBanner:
      "Tu publicación está en revisión. Apenas esté aprobada, la va a ver toda la comunidad.",
    removedBanner:
      "Esta publicación fue retirada por el equipo de moderación de tu comunidad.",
    menuLabel: "Más opciones",
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
  },

  detail: {
    backToFeed: "Volver al feed",
    notFoundTitle: "No encontramos esa publicación",
    notFoundMessage:
      "Puede que se haya retirado o que el link esté incompleto. Volvé al feed para ver lo último.",
  },
} as const;
