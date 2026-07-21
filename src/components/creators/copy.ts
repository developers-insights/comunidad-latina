import type { ContractAction, ContractStatus } from "./contract-machine";

/**
 * Copy del Creator Marketplace. Español cálido y claro, sin jerga: jamás
 * "escrow" a secas — decimos "pago en garantía". Fuente única de textos del
 * módulo para que negocios y creadores lean siempre lo mismo.
 */

const GENERIC_ERROR =
  "Algo no cargó bien de nuestro lado — no es tu culpa. Probá de nuevo en un ratito.";

export const COPY = {
  // -------------------------------------------------------------------------
  nav: {
    gigs: "Trabajos",
    creators: "Creadores",
    contracts: "Contratos",
  },

  // -------------------------------------------------------------------------
  feed: {
    title: "Creadores",
    subtitle: "Trabajos para creadores de contenido en tu comunidad.",
    publishCta: "Publicar trabajo",
    urgentChip: "Urgente",
    budgetPrefix: "Presupuesto",
    viewGig: "Ver trabajo",
    emptyTitle: "Todavía no hay trabajos publicados",
    emptyMessage:
      "Cuando un negocio busque un creador, su aviso aparece acá. Si tenés un negocio, publicá el primero.",
    emptyCta: "Publicar un trabajo",
    proposalsCount: (n: number) => (n === 1 ? "1 propuesta" : `${n} propuestas`),
  },

  // -------------------------------------------------------------------------
  gig: {
    backToFeed: "Volver a los trabajos",
    aboutBudget: "Presupuesto ofrecido",
    deliverablesTitle: "Qué se busca",
    deadlineLabel: (days: number) => (days === 1 ? "Para entregar en 1 día" : `Para entregar en ${days} días`),
    aboutBusiness: "Sobre el negocio",
    applyCta: "Aplicar a este trabajo",
    pendingReviewOwner:
      "Tu aviso está en revisión. Apenas lo apruebe el equipo de tu comunidad, va a aparecer en Trabajos y los creadores van a poder aplicar.",
    ownerHint: "Sos el dueño de este aviso. Acá ves quién aplicó.",
    alreadyApplied: "Ya aplicaste a este trabajo",
    alreadyAppliedBody: "El negocio está viendo tu propuesta. Te avisamos si te elige.",
    applicationWithdrawn: "Retiraste tu propuesta para este trabajo.",
  },

  // -------------------------------------------------------------------------
  apply: {
    title: "Aplicar a este trabajo",
    intro: "Contale al negocio por qué sos la persona indicada. Sé concreto y cálido.",
    messageLabel: "Tu propuesta",
    messagePlaceholder:
      "Ej.: Hago reels para gastronomía hace 3 años. Te puedo entregar 3 videos verticales listos para publicar…",
    messageHelp: "Entre 20 y 1000 caracteres.",
    amountLabel: "Cuánto cobrarías",
    amountHelp: "Opcional. Podés proponer tu propio precio en dólares; el monto final se acuerda en el contrato.",
    amountPlaceholder: "Ej.: 800",
    submit: "Enviar propuesta",
    submitting: "Enviando…",
    successTitle: "¡Propuesta enviada!",
    successBody: "El negocio ya puede ver tu perfil y tu propuesta. Te avisamos si te elige.",
    needProfileTitle: "Primero, tu perfil de creador",
    needProfileBody:
      "Para aplicar necesitás un perfil de creador: es lo que ve el negocio (tu portfolio, tus reseñas y tu score). Se arma en un minuto.",
    needProfileCta: "Crear mi perfil de creador",
    needLogin: "Para aplicar necesitás entrar a tu cuenta.",
    errors: {
      messageShort: "Escribí un poco más — contale al negocio qué le ofrecés.",
      generic: GENERIC_ERROR,
    },
  },

  // -------------------------------------------------------------------------
  applications: {
    title: "Propuestas recibidas",
    empty: "Todavía nadie aplicó a este trabajo. Compartilo para que llegue a más creadores.",
    proposedAmount: "Propone",
    completedJobs: (n: number) => (n === 1 ? "1 trabajo completado" : `${n} trabajos completados`),
    noReviews: "Sin reseñas todavía",
    accept: "Aceptar",
    decline: "Rechazar",
    withdraw: "Retirar mi propuesta",
    createContract: "Crear contrato",
    accepted: "Aceptada",
    declined: "Rechazada",
    withdrawn: "Retirada",
    submitted: "En revisión",
    viewProfile: "Ver perfil",
    statusUpdated: "Listo, actualizamos la propuesta.",
    errors: { generic: GENERIC_ERROR },
  },

  // -------------------------------------------------------------------------
  publish: {
    title: "Publicar un trabajo",
    subtitle: "Contá qué necesitás y cuánto pagás. Los creadores de tu comunidad te van a proponer su trabajo.",
    needLoginTitle: "Entrá para publicar un trabajo",
    needLoginBody: "Con tu cuenta podés publicar avisos y contratar creadores con pago en garantía.",
    needLoginCta: "Entrar",
    steps: {
      what: {
        title: "¿Qué necesitás?",
        categoryLabel: "Tipo de trabajo",
        titleLabel: "Título del trabajo",
        titlePlaceholder: "Ej.: Busco creador para 3 reels de mi restaurante",
        titleHelp: "Claro y directo, como lo buscarías vos.",
        descriptionLabel: "Detalles",
        descriptionPlaceholder:
          "Contá qué querés lograr, el estilo, dónde se va a publicar, fechas importantes…",
        descriptionHelp: "Mientras más claro, mejores propuestas vas a recibir.",
        deliverablesLabel: "Qué se entrega",
        deliverablesPlaceholder: "Ej.: 3 videos verticales de 30s + 5 fotos editadas",
        deliverablesHelp: "Opcional. La lista concreta de entregables.",
      },
      budget: {
        title: "Presupuesto y tiempo",
        amountLabel: "Presupuesto (USD)",
        amountPlaceholder: "Ej.: 800",
        amountHelp: "Lo que estás dispuesto a pagar. El monto final se cierra en el contrato.",
        deadlineLabel: "Días para entregar",
        deadlinePlaceholder: "Ej.: 7",
        urgentLabel: "Es urgente",
        urgentHelp: "Marcá esto si necesitás el trabajo pronto — tu aviso se destaca.",
      },
      where: {
        title: "¿Dónde?",
        areaLabel: "Zona",
        areaPlaceholder: "Ej.: Washington Heights, NYC",
        areaHelp: "La zona donde se hace el trabajo (o 'Remoto' si es a distancia).",
      },
      photos: {
        title: "Fotos de referencia",
        help: "Sumá hasta 6 fotos que muestren el estilo o el lugar. Opcional, pero ayudan muchísimo.",
        add: "Agregar",
        remove: "Quitar foto",
        tooMany: "Podés subir hasta 6 fotos.",
        tooBig: "Esa foto pesa demasiado (máximo 40 MB).",
      },
    },
    nav: { back: "Atrás", next: "Siguiente", submit: "Publicar trabajo", submitting: "Publicando…" },
    successPublishedTitle: "¡Trabajo publicado!",
    successPublishedBody: "Tu aviso ya aparece en Trabajos. Te avisamos cuando alguien aplique.",
    successReviewTitle: "Tu trabajo quedó en revisión",
    successReviewBody:
      "El equipo de tu comunidad lo revisa para cuidar la calidad. Apenas se apruebe, aparece en Trabajos.",
    goToFeed: "Ver los trabajos",
    publishAnother: "Publicar otro",
    errors: {
      categoryRequired: "Elegí el tipo de trabajo.",
      titleShort: "El título necesita al menos 8 caracteres.",
      descriptionShort: "Contanos un poco más — al menos 30 caracteres.",
      amountRequired: "Poné el presupuesto que ofrecés.",
      areaShort: "Decinos la zona (al menos 3 caracteres).",
      uploadFailed: "No pudimos subir una de las fotos. Probá de nuevo.",
      generic: GENERIC_ERROR,
    },
  },

  // -------------------------------------------------------------------------
  directory: {
    title: "Creadores",
    subtitle: "Fotógrafos, videomakers y creadores de contenido de tu comunidad.",
    createProfileCta: "Crear mi perfil",
    editProfileCta: "Editar mi perfil",
    available: "Disponible",
    unavailable: "Ocupado",
    completedJobs: (n: number) => (n === 1 ? "1 trabajo" : `${n} trabajos`),
    ratingCount: (n: number) => (n === 1 ? "1 reseña" : `${n} reseñas`),
    noRating: "Nuevo",
    viewProfile: "Ver perfil",
    emptyTitle: "Todavía no hay creadores",
    emptyMessage:
      "Sé el primero en ofrecer tu trabajo como creador de contenido. Armás tu perfil en un minuto.",
    emptyCta: "Crear mi perfil de creador",
  },

  // -------------------------------------------------------------------------
  profile: {
    // Perfil público de un creador
    portfolioTitle: "Portfolio",
    skillsTitle: "Lo que hago",
    reviewsTitle: "Reseñas",
    noReviews: "Todavía no tiene reseñas. Las reseñas aparecen cuando cierra un trabajo.",
    reputationTitle: "Reputación",
    proposeCta: "Proponer un trabajo",
    hireHint: "Le proponés un contrato directo con pago en garantía.",
    notFoundTitle: "Este creador no tiene perfil",
    notFoundBody: "Puede que todavía no haya armado su perfil de creador.",
    // Mi perfil (crear/editar)
    myTitle: "Mi perfil de creador",
    mySubtitle: "Así te ven los negocios cuando buscan a alguien para su contenido.",
    form: {
      headlineLabel: "Titular",
      headlinePlaceholder: "Ej.: Fotógrafa gastronómica y creadora de reels",
      headlineHelp: "Una línea que diga a qué te dedicás.",
      bioLabel: "Sobre vos",
      bioPlaceholder: "Contá tu experiencia, tu estilo y con qué negocios trabajaste…",
      bioHelp: "Opcional, pero suma mucho.",
      skillsLabel: "Habilidades",
      skillsPlaceholder: "Ej.: Reels, Fotografía, Edición",
      skillsHelp: "Separá con comas. Hasta 12.",
      rateHintLabel: "Precio orientativo",
      rateHintPlaceholder: "Ej.: Desde $150 por reel",
      rateHintHelp: "Opcional. Una referencia; el precio real se pacta en cada contrato.",
      availableLabel: "Estoy disponible para nuevos trabajos",
      portfolioLabel: "Portfolio",
      portfolioHelp: "Subí hasta 6 fotos de tus mejores trabajos.",
    },
    save: "Guardar mi perfil",
    saving: "Guardando…",
    savedTitle: "¡Perfil guardado!",
    savedBody: "Ya apareces en Creadores. Los negocios pueden ver tu portfolio y proponerte trabajos.",
    viewPublic: "Ver mi perfil público",
    needLoginTitle: "Entrá para crear tu perfil",
    needLoginBody: "Con tu perfil de creador, los negocios de tu comunidad te encuentran y te contratan.",
    needLoginCta: "Entrar",
    errors: {
      headlineShort: "Escribí un titular (al menos 6 caracteres).",
      uploadFailed: "No pudimos subir una de las fotos. Probá de nuevo.",
      generic: GENERIC_ERROR,
    },
  },

  // -------------------------------------------------------------------------
  contract: {
    // Formulario de propuesta de contrato
    proposeTitle: "Proponer contrato",
    proposeIntro: "Definí qué se entrega, en cuánto tiempo y por cuánto. El creador lo revisa y vos depositás en garantía.",
    titleLabel: "Título del trabajo",
    titlePlaceholder: "Ej.: 3 reels para el restaurante",
    scopeLabel: "Qué se entrega",
    scopePlaceholder: "Ej.: 3 videos verticales de 30s, editados y con música, listos para publicar.",
    deliveryLabel: "Días para entregar",
    amountLabel: "Monto acordado (USD)",
    amountHelp: "Sobre este monto se calcula el 20% de la plataforma.",
    withCreator: "Contrato con",
    create: "Crear contrato",
    creating: "Creando…",
    createdTitle: "¡Contrato creado!",
    createdBody: "El creador ya lo puede ver. Para arrancar, depositá el pago en garantía.",
    goToContract: "Ver el contrato",
    // Detalle
    detailBack: "Volver a mis contratos",
    codeLabel: "Código de trabajo",
    scopeTitle: "Qué se entrega",
    timelineTitle: "Historial",
    role: { client: "Vos contratás", creator: "Vos creás" },
    counterpartClient: "Negocio",
    counterpartCreator: "Creador",
    // Desglose
    breakdownTitle: "Pago en garantía",
    breakdownAmount: "Monto acordado",
    breakdownFee: (pct: number) => `Comisión de la plataforma (${pct}%)`,
    breakdownNet: "Lo que recibe el creador",
    // Sello demo
    demoSeal: "Modo demostración",
    demoNote:
      "Pagos en garantía: modo demostración — Stripe Connect se activa próximamente. Los montos y el flujo son reales; todavía no se mueve dinero.",
    // Timeline de fechas
    timeline: {
      created: "Contrato creado",
      accepted: "Propuesta aceptada",
      funded: "Pago depositado en garantía",
      delivered: "Trabajo entregado",
      released: "Pago liberado al creador",
      canceled: "Contrato cancelado",
      rejected: "Propuesta rechazada",
    },
    errors: {
      amountRequired: "Poné el monto acordado.",
      scopeShort: "Describí qué se entrega (al menos 10 caracteres).",
      titleShort: "El título necesita al menos 6 caracteres.",
      notAllowed: "Esa acción no está disponible en este momento.",
      generic: GENERIC_ERROR,
    },
  },

  // -------------------------------------------------------------------------
  // Estados del contrato — etiqueta corta para stepper/badges
  status: {
    proposed: "Propuesto",
    accepted: "Aceptado",
    funded: "En garantía",
    delivered: "Entregado",
    released: "Liberado",
    canceled: "Cancelado",
    disputed: "En disputa",
    rejected: "Rechazado",
  } satisfies Record<ContractStatus, string>,

  // Frase de estado por rol (qué ve cada parte / qué sigue)
  statusHint: {
    proposedClient: "Le propusiste el contrato al creador. Cuando lo acepte, vas a poder depositar el pago en garantía.",
    proposedCreator: "Te propusieron un trabajo. Revisá los detalles y aceptá o rechazá la propuesta.",
    acceptedClient: "El creador aceptó la propuesta. Depositá el pago en garantía para que arranque.",
    acceptedCreator: "Aceptaste la propuesta. Ahora falta que el negocio deposite el pago en garantía; te avisamos cuando lo haga.",
    fundedClient: "El pago está en garantía. El creador ya puede empezar; te avisamos cuando entregue.",
    fundedCreator: "El pago está en garantía: podés empezar. Cuando termines, marcá el trabajo como entregado.",
    deliveredClient: "El creador entregó. Revisá el trabajo y, si está todo bien, aprobá y liberá el pago.",
    deliveredCreator: "Entregaste el trabajo. El negocio lo está revisando; cuando apruebe, se libera tu pago.",
    releasedClient: "Liberaste el pago. ¡Gracias! Dejale una reseña al creador.",
    releasedCreator: "El negocio liberó tu pago. ¡Felicitaciones! Dejale una reseña.",
    canceled: "Este contrato se canceló. En modo demostración no se movió ningún dinero.",
    disputed: "Este contrato está en disputa. El equipo de tu comunidad lo va a revisar y resolver.",
    rejected: "La propuesta fue rechazada, así que el contrato no siguió adelante. En modo demostración no se movió ningún dinero.",
  },

  // -------------------------------------------------------------------------
  // Botones de transición (por acción)
  action: {
    accept: "Aceptar",
    reject: "Rechazar",
    fund: "Depositar en garantía",
    deliver: "Entregar trabajo",
    release: "Aprobar y liberar pago",
    cancel: "Cancelar",
    dispute: "Reportar un problema",
  } satisfies Record<ContractAction, string>,

  // Acciones que piden confirmación (las positivas —aceptar, entregar— van
  // directo). El rechazo es terminal, así que se confirma como la cancelación.
  actionConfirm: {
    reject: "Vas a rechazar esta propuesta. El contrato se cierra y no se puede reabrir.",
    fund: "Vas a depositar el monto acordado en garantía (modo demostración). El creador podrá empezar.",
    release: "Vas a liberar el pago al creador. Confirmá solo si el trabajo entregado está bien.",
    cancel: "Vas a cancelar este contrato. En modo demostración no se mueve dinero.",
    dispute: "Vamos a marcar el contrato en disputa para que el equipo lo revise. Contanos qué pasó por Mensajes.",
  } satisfies Record<Exclude<ContractAction, "deliver" | "accept">, string>,

  actionDone: {
    accept: "¡Aceptaste la propuesta! Ahora el negocio deposita el pago en garantía.",
    reject: "Rechazaste la propuesta.",
    fund: "Listo, el pago quedó en garantía.",
    deliver: "¡Entregado! El negocio ya puede revisarlo.",
    release: "¡Pago liberado! Gracias por usar el pago en garantía.",
    cancel: "Contrato cancelado.",
    dispute: "Marcamos el contrato en disputa.",
  } satisfies Record<ContractAction, string>,

  // -------------------------------------------------------------------------
  contractsList: {
    title: "Mis contratos",
    subtitle: "Los trabajos que contrataste y los que estás creando.",
    asClient: "Como negocio",
    asCreator: "Como creador",
    emptyTitle: "Todavía no tenés contratos",
    emptyMessage:
      "Cuando acuerdes un trabajo con un creador (o con un negocio), el contrato con pago en garantía aparece acá.",
    exploreGigs: "Ver trabajos",
    exploreCreators: "Ver creadores",
  },

  // -------------------------------------------------------------------------
  reviews: {
    title: "Reseñas del trabajo",
    intro: "Al cerrar el trabajo, las dos partes se dejan una reseña. Solo ustedes pueden reseñar este contrato.",
    yourReview: "Tu reseña",
    theirReview: "Su reseña",
    rateLabel: "¿Cómo estuvo?",
    bodyLabel: "Contá tu experiencia",
    bodyPlaceholder: "Ej.: Súper profesional, entregó antes de tiempo y el material quedó buenísimo.",
    submit: "Dejar reseña",
    submitting: "Enviando…",
    done: "¡Gracias por tu reseña!",
    alreadyLeft: "Ya dejaste tu reseña.",
    waitingOther: "Esperando la reseña de la otra parte.",
    starLabel: (n: number) => (n === 1 ? "1 estrella" : `${n} estrellas`),
    errors: {
      ratingRequired: "Elegí de 1 a 5 estrellas.",
      generic: GENERIC_ERROR,
    },
  },
} as const;
