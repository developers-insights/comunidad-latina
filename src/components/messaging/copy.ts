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
      "Cuando alguien te escriba por un aviso, o vos pidas contacto, la conversación se abre acá.",
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

    // ── Bandeja agrupada por persona (0134) ─────────────────────────────────
    tabPersonas: "Personas",
    tabGrupos: "Grupos",
    tabsLabel: "Tus mensajes",
    /**
     * La línea de contexto cuando hay varias charlas con la misma persona.
     * Antes cada aviso era una FILA; ahora es esto. Se nombra el aviso más
     * reciente y se cuenta el resto, porque tres títulos completos no entran
     * en 375px sin truncarse los tres.
     */
    alsoAbout: (primerAviso: string, restantes: number) =>
      restantes > 0
        ? `${primerAviso} y ${restantes} ${restantes === 1 ? "aviso más" : "avisos más"}`
        : primerAviso,

    // ── Buscador de personas ────────────────────────────────────────────────
    searchLabel: "Buscar a alguien de la comunidad",
    searchPlaceholder: "Buscá a quién querés escribirle",
    searchHint: "Escribí un nombre para empezar",
    searchEmpty: (termino: string) =>
      `No encontramos a nadie con “${termino}” en la comunidad.`,
    searchError: "No pudimos buscar en este momento. Probá de nuevo en un rato.",
    searchClear: "Borrar la búsqueda",
    openChat: "Escribirle",
    opening: "Abriendo…",
    // El contacto directo nace pendiente, igual que desde un aviso: se dice
    // antes de que la persona se pregunte por qué no puede escribir todavía.
    directPending: "Le mandamos tu solicitud. Cuando acepte, van a poder hablar.",
    directBlocked: "El contacto con esta persona no está disponible.",
    directError: "No pudimos abrir la conversación. Probá de nuevo.",
  },

  /**
   * GRUPOS DE CHAT (0133). Pedido del cliente: «grupos para que la gente se
   * junte — ir en bici, esquiar, real estate, emprendedores», «como hace
   * WhatsApp al momento de crear un grupo».
   */
  groups: {
    title: "Grupos",
    mine: "Tus grupos",
    discover: "Para sumarte",
    create: "Crear un grupo",
    createTitle: "Crear un grupo",
    createIntro:
      "Armá un lugar para juntarte con gente de la comunidad: salir en bici, emprender, hablar de bienes raíces, lo que sea.",
    emptyMineTitle: "Todavía no estás en ningún grupo",
    emptyMineMessage:
      "Sumate a uno de la comunidad o creá el tuyo: elegís de qué se trata y quién puede entrar.",
    emptyDiscoverTitle: "Por ahora no hay grupos abiertos",
    emptyDiscoverMessage:
      "Podés crear el primero. Los grupos públicos aparecen acá para que cualquiera de la comunidad se sume.",
    allCategories: "Todos",
    filterLabel: "Filtrar los grupos por tema",

    // Formulario
    nameLabel: "¿Cómo se llama el grupo?",
    namePlaceholder: "Ciclistas de Corona",
    nameHelp: "Entre 3 y 60 caracteres. Es lo que va a ver la gente al buscarlo.",
    descriptionLabel: "¿De qué se trata?",
    descriptionPlaceholder:
      "Salimos a andar los domingos temprano por Flushing Meadows. Todos los niveles.",
    descriptionHelp:
      "Contá qué van a encontrar adentro: ayuda a que se sume la gente indicada.",
    categoryLabel: "Tema",
    categoryHelp: "Con esto la gente encuentra tu grupo cuando busca por tema.",
    visibilityLabel: "¿Quién puede entrar?",
    visibilityPublic: "Cualquiera de la comunidad",
    visibilityPublicHelp: "Aparece en la lista y se suman con un toque.",
    visibilityPrivate: "Solo por invitación",
    visibilityPrivateHelp: "No aparece en ninguna lista. Vos elegís a quién sumar.",
    photoLabel: "Foto del grupo",
    submit: "Crear el grupo",
    submitting: "Creando…",
    created: "Listo, tu grupo ya está en pie",

    // Errores del alta
    nameTaken: "Ya hay un grupo con ese nombre en la comunidad. Probá con otro.",
    nameTooShort: "El nombre necesita al menos 3 caracteres.",
    nameTooLong: "El nombre no puede pasar de 60 caracteres.",
    descriptionTooLong: "La descripción no puede pasar de 300 caracteres.",
    createError: "No pudimos crear el grupo. Probá de nuevo.",

    // Membresía
    join: "Unirme",
    joining: "Entrando…",
    joined: "Ya estás adentro",
    joinError: "No pudimos sumarte al grupo. Probá de nuevo.",
    leave: "Salir del grupo",
    leaveConfirmTitle: "¿Salir del grupo?",
    leaveConfirmBody:
      "Vas a dejar de recibir sus mensajes. Si es público, podés volver cuando quieras.",
    leaveConfirm: "Sí, salir",
    left: "Saliste del grupo",
    leaveError: "No pudimos sacarte del grupo. Probá de nuevo.",
    ownerCannotLeave:
      "Creaste este grupo, así que no podés salir. Si ya no va más, cerralo.",

    // Adentro
    membersTitle: "Miembros",
    infoTitle: "Info del grupo",
    infoLink: "Ver info del grupo",
    you: "Vos",
    roleOwner: "Creó el grupo",
    roleAdmin: "Administra",
    privateBadge: "Solo por invitación",
    closedBanner: "Este grupo está cerrado. Podés leer lo que se dijo, pero ya no se escribe.",
    notMemberTitle: "Todavía no estás en este grupo",
    notMemberMessage: "Sumate para leer lo que se está hablando y escribir.",
    emptyThreadTitle: "Acá arranca la conversación",
    emptyThreadMessage:
      "Contá de qué se trata o saludá: el primer mensaje es el que rompe el hielo.",
    composerPlaceholder: "Escribí al grupo…",
    ttlNote: "Los mensajes del grupo se borran automáticamente a los 90 días",

    // Administración
    manage: "Administrar",
    invite: "Invitar gente",
    inviteHelp: "Buscá a alguien de la comunidad para sumarlo al grupo.",
    invited: (name: string) => `${name} ya está adentro`,
    inviteError: "No pudimos sumar a esa persona. Probá de nuevo.",
    alreadyMember: "Esa persona ya está en el grupo.",
    remove: "Sacar del grupo",
    removeConfirmTitle: (name: string) => `¿Sacar a ${name}?`,
    removeConfirmBody:
      "No va a poder leer ni escribir más. Si el grupo es público, puede volver a entrar.",
    removeConfirm: "Sí, sacarlo",
    removed: "Listo, esa persona ya no está en el grupo",
    removeError: "No pudimos sacar a esa persona. Probá de nuevo.",
    edit: "Editar el grupo",
    save: "Guardar cambios",
    saved: "Guardamos los cambios",
    saveError: "No pudimos guardar los cambios. Probá de nuevo.",
    close: "Cerrar el grupo",
    closeConfirmTitle: "¿Cerrar el grupo?",
    closeConfirmBody:
      "Nadie va a poder escribir más. Lo conversado queda para leer hasta que se borre solo.",
    closeConfirm: "Sí, cerrarlo",
    closed: "El grupo quedó cerrado",
    closeError: "No pudimos cerrar el grupo. Probá de nuevo.",

    // Moderación
    report: "Reportar este mensaje",
    reported: "Gracias por avisar. El equipo lo revisa a la brevedad.",
    deleteMessage: "Borrar el mensaje",
    messageDeleted: "Mensaje borrado",
    deleteMessageError: "No pudimos borrar el mensaje. Probá de nuevo.",

    // Errores generales
    notFoundTitle: "No encontramos este grupo",
    notFoundMessage: "Puede que lo hayan cerrado o que sea privado.",
    rateLimited: "Mandaste varios mensajes seguidos. Probá de nuevo en un rato.",
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
    // `rate-limited` NO es una falla nuestra y "probá de nuevo" sería un mal
    // consejo: hasta que baje el contador va a fallar igual. Nombramos la causa
    // y damos la única acción que sirve.
    rateLimitedTitle: "Esperá un momento",
    rateLimitedBody: "Mandaste varios mensajes seguidos. Probá de nuevo en un rato.",
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
    // Mismo criterio que en el composer: el tope de reportes es diario y de la
    // persona, no de la pantalla. Reintentar no lo destraba.
    rateLimitedTitle: "Esperá un momento",
    rateLimitedBody: "Enviaste varios reportes seguidos. Probá de nuevo en un rato.",
  },
  errors: {
    generic: "Algo no cargó bien de nuestro lado — no es tu culpa. Probá de nuevo.",
  },
} as const;
