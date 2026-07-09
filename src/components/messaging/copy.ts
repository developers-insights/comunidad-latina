/**
 * COPY del módulo MENSAJES — contacto protegido (§9.2).
 * Local al módulo por contrato: src/lib/i18n/* es compartido y no se toca.
 * Tono: español cálido rioplatense-neutro, cero jerga técnica.
 */
export const COPY = {
  inbox: {
    title: "Mensajes",
    emptyTitle: "Tus conversaciones van a aparecer acá",
    emptyMessage:
      "Cuando alguien te escriba por un aviso, o vos pidas contacto, la conversación vive acá adentro — protegida.",
    emptyAction: "Buscar propiedades",
    wantsToContact: (listingTitle: string | null) =>
      listingTitle
        ? `Quiere contactarte por “${listingTitle}”`
        : "Quiere contactarte",
    waitingReply: "Esperando respuesta",
    accept: "Aceptar",
    ignore: "Ignorar",
    accepted: "Listo, ya pueden hablar",
    ignored: "Conversación ignorada",
    noMessagesYet: "Todavía no hay mensajes",
    aboutListing: (listingTitle: string) => `Sobre: ${listingTitle}`,
    you: "Vos:",
  },
  thread: {
    safetyBanner:
      "Por tu seguridad, mantené la conversación acá adentro. Nunca envíes dinero por adelantado.",
    ttlNote: "Los mensajes se borran automáticamente a los 90 días",
    viewListing: "Ver aviso",
    moreActions: "Más opciones",
    pendingAsCounterpartTitle: "Te quiere contactar",
    pendingAsCounterpart: (name: string, listingTitle: string | null) =>
      listingTitle
        ? `${name} quiere hablar con vos por “${listingTitle}”. Si aceptás, pueden escribirse acá adentro.`
        : `${name} quiere hablar con vos. Si aceptás, pueden escribirse acá adentro.`,
    pendingAsCreator:
      "Tu solicitud ya llegó. Cuando la otra persona acepte, vas a poder escribirle acá.",
    blockedNotice: "Esta conversación está cerrada.",
    emptyThread: "Cuando empiecen a hablar, los mensajes aparecen acá.",
    accept: "Aceptar",
    accepted: "Listo, ya pueden hablar",
  },
  composer: {
    placeholder: "Escribí tu mensaje…",
    send: "Enviar mensaje",
    flaggedTitle: "Ese mensaje no se envió",
    flaggedBody:
      "Detectamos algo que puede lastimar a otra persona, así que lo mandamos a revisión. Probá decirlo de otra forma.",
    errorTitle: "No se pudo enviar",
    errorBody: "Algo no cargó bien de nuestro lado — no es tu culpa. Probá de nuevo.",
  },
  report: {
    sheetTitle: "Reportar un problema",
    intro:
      "Contanos qué pasó. Tu reporte es confidencial y ayuda a proteger a toda la comunidad.",
    reasonLabel: "¿Qué pasó?",
    reasons: [
      { value: "pide_dinero_adelantado", label: "Me pide dinero por adelantado" },
      { value: "quiere_salir_de_la_app", label: "Insiste en hablar por fuera de la app" },
      { value: "datos_falsos", label: "El aviso o la persona no son lo que dicen ser" },
      { value: "otro", label: "Otra cosa" },
    ],
    detailsLabel: "Contanos más (opcional)",
    detailsPlaceholder: "Todo detalle ayuda a que el equipo actúe rápido.",
    submit: "Enviar reporte",
    successTitle: "Reporte enviado",
    successBody: "Gracias por avisar. El equipo lo revisa a la brevedad.",
    errorTitle: "No se pudo enviar el reporte",
    errorBody: "Algo no cargó bien de nuestro lado — no es tu culpa. Probá de nuevo.",
  },
  errors: {
    generic: "Algo no cargó bien de nuestro lado — no es tu culpa. Probá de nuevo.",
  },
} as const;
