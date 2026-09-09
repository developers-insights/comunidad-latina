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
    searchPlaceholder: "Buscá por nombre o Número CL",
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

    // ── Tres pestañas: Personas · Grupos · Solicitudes ──────────────────────
    tabSolicitudes: "Solicitudes",
    solicitudesTitle: "Solicitudes",
    solicitudesIntro:
      "Gente que quiere empezar a hablar con vos. Recién cuando aceptás pueden escribirte.",
    solicitudesEmptyTitle: "No tenés solicitudes pendientes",
    solicitudesEmptyMessage:
      "Cuando alguien quiera contactarte por un aviso o por tu perfil, su pedido te espera acá.",
    solicitudesCount: (n: number) =>
      n === 1 ? "1 solicitud sin responder" : `${n} solicitudes sin responder`,
    /** Se lee al lado del nombre en la pestaña Solicitudes. */
    requestedAt: (cuando: string) => `Te escribió ${cuando}`,
    firstMessage: "Su mensaje:",
    block: "Bloquear",
    blockConfirmTitle: (nombre: string) => `¿Bloquear a ${nombre}?`,
    blockConfirmBody:
      "No va a poder escribirte ni encontrarte en la comunidad, y las conversaciones que tengan quedan cerradas. Podés desbloquear desde tu perfil.",
    blockConfirm: "Sí, bloquear",
    cancel: "Cancelar",
    blocked: "Listo, esa persona ya no puede contactarte",
    blockError: "No pudimos bloquear a esa persona. Probá de nuevo.",

    // ── Filtros rápidos de Personas ─────────────────────────────────────────
    filtersLabel: "Filtrar tus conversaciones",
    filterAll: "Todos",
    filterFriends: "Amigos",
    filterUnread: "No leídos",
    /** Bajo el chip de Amigos: la definición, dicha en una línea. */
    friendsHint: "Amigos son las personas que vos seguís y que te siguen.",
    emptyFriendsTitle: "Todavía no hablás con ningún amigo",
    emptyFriendsMessage:
      "Cuando vos y otra persona se sigan mutuamente, sus conversaciones aparecen en este filtro.",
    emptyUnreadTitle: "Estás al día",
    emptyUnreadMessage: "No te quedó ningún mensaje sin leer.",
    resetFilter: "Ver todas",

    // ── Qué pasó en la última línea de cada fila ────────────────────────────
    resumen: {
      foto: "Foto",
      video: "Video",
      audio: "Nota de voz",
      audioConDuracion: (duracion: string) => `Nota de voz · ${duracion}`,
      archivo: "Archivo",
      ubicacion: "Ubicación",
      perfil: "Perfil compartido",
      contenido: "Publicación compartida",
      /**
       * Los dos estados de PRESENCIA. "Está escribiendo…" no está acá: llega
       * por Realtime y vive en `COPY.escribiendo`, con sus variantes por
       * nombre. Escrito en los dos lugares, un cambio de redacción arreglaba
       * la mitad de las pantallas.
       */
      enLinea: "En línea",
      ultimaVez: (cuando: string) => `Última vez ${cuando}`,
    },
    unreadCount: (n: number) =>
      n === 1 ? "1 mensaje sin leer" : `${n} mensajes sin leer`,
    readByOther: "Leído",

    /**
     * Cómo se nombra una llamada en una lista. La base guarda `kind` y `status`
     * en inglés-de-esquema ("video", "perdida"); esto es lo que se lee.
     */
    llamada: {
      audio: "Llamada de voz",
      video: "Videollamada",
      perdida: (tipo: string) => `${tipo} perdida`,
      rechazada: (tipo: string) => `${tipo} rechazada`,
      enCurso: (tipo: string) => `${tipo} en curso`,
      sonando: (tipo: string) => `${tipo} sonando`,
    },

    // ── El buscador de la bandeja ───────────────────────────────────────────
    findLabel: "Buscar en tus mensajes",
    findPlaceholder: "Buscá un chat, grupo, nombre o Número CL",
    findHint: "Escribí para buscar",
    findEmpty: (termino: string) =>
      `No encontramos nada con “${termino}” en tus mensajes.`,
    findError: "No pudimos buscar en este momento. Probá de nuevo en un rato.",
    findSectionChats: "Tus conversaciones",
    findSectionGroups: "Tus grupos",
    findSectionCalls: "Llamadas",
    findSectionPeople: "Escribirle a alguien",
    findResults: (n: number) =>
      n === 1 ? "1 resultado" : `${n} resultados`,
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
    visibilityRequest: "Con solicitud de ingreso",
    visibilityRequestHelp: "Aparece en la lista y quien administra decide quién entra.",
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
    requestJoin: "Solicitar ingreso",
    requestingJoin: "Enviando…",
    requestedJoin: "Solicitud enviada",
    requestedJoinMessage: "Quien administra el grupo va a revisar tu solicitud.",
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
    onlineMembers: (n: number) => n === 1 ? "1 en línea" : `${n} en línea`,
    privateBadge: "Solo por invitación",
    requestBadge: "Ingreso con solicitud",
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
    requestsTitle: "Solicitudes de ingreso",
    requestsEmpty: "No hay solicitudes pendientes.",
    approveRequest: "Aprobar",
    rejectRequest: "Rechazar",
    requestApproved: "Listo, ya está adentro",
    requestRejected: "Solicitud rechazada",
    requestDecisionError: "No pudimos resolver la solicitud. Probá de nuevo.",
    promoteAdmin: "Hacer admin",
    demoteAdmin: "Quitar como admin",
    roleChanged: "Actualizamos quién administra el grupo",
    roleChangeError: "No pudimos cambiar ese rol. Probá de nuevo.",
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
  /**
   * "Está escribiendo…" cuando hace falta nombrar a alguien.
   *
   * En un 1-a-1 el nombre ya está arriba, en el encabezado, así que repetirlo
   * en el renglón de abajo es ruido: ahí va `solo`. En un grupo el nombre ES la
   * información, porque son veinte personas y sólo una está tecleando.
   *
   * Con tres o más se deja de nombrar en vez de encadenar nombres: "Ana, Beto y
   * 4 más están escribiendo…" no entra en 375 px y tampoco dice nada útil.
   */
  escribiendo: {
    solo: "Está escribiendo…",
    una: (nombre: string) => `${nombre} está escribiendo…`,
    dos: (uno: string, otro: string) => `${uno} y ${otro} están escribiendo…`,
    varias: "Varias personas están escribiendo…",
    /** Alguien del grupo que todavía no habló, así que no está en el mapa de nombres. */
    generico: "Alguien",
  },

  /** Lo que se compartió en un grupo: fotos, videos, archivos y enlaces. */
  galeria: {
    title: "Archivos y enlaces",
    /** Palabras del cliente, tal cual las pidió. */
    entrada: "Archivos, enlaces y documentos",
    entradaAyuda: "Todo lo que se compartió en el grupo",
    solapas: {
      multimedia: "Multimedia",
      archivos: "Archivos",
      enlaces: "Enlaces",
    },
    solapasLabel: "Qué se compartió",
    verMas: "Ver más",
    cargando: "Buscando…",
    errorMas: "No pudimos traer más. Probá de nuevo.",
    /** Nombre accesible de cada ítem: dice a dónde lleva y de quién es. */
    abrirEnConversacion: (quien: string, cuando: string) =>
      `Ver en la conversación — lo compartió ${quien}, ${cuando}`,
    noDisponible: "Ya no está disponible",
    video: "Video",
    vacio: {
      multimedia: {
        title: "Todavía no hay fotos ni videos",
        message: "Lo que se comparta en el grupo se va a juntar acá.",
      },
      archivos: {
        title: "Todavía no hay archivos",
        message: "Los PDF y documentos que se manden al grupo quedan acá a mano.",
      },
      enlaces: {
        title: "Todavía no hay enlaces",
        message: "Los links que alguien comparta en el grupo se guardan acá.",
      },
    },
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

    /** Lo que se manda que no es texto, ya en el hilo (0136 + 0140). */
    adjunto: {
      /**
       * `alt` de una foto que mandó otra persona. No se inventa qué se ve: la
       * app no sabe. Se dice de quién es y que hay que abrirla.
       */
      fotoDe: (nombre: string) => `Foto que mandó ${nombre}`,
      fotoPropia: "Foto que mandaste",
      video: "Video del mensaje",
      /** El archivo se cayó, venció la firma o quien mira ya no puede verlo. */
      noDisponible: "Este archivo ya no está disponible.",
      archivoSinNombre: "Archivo",
      /**
       * Dice ABRIR y no "descargar" porque es lo que pasa: el archivo vive en
       * otro origen (el bucket), y ahí el atributo `download` de un enlace no
       * hace nada — el navegador lo muestra en una pestaña nueva.
       */
      abrirArchivo: "Abrir",
      peso: (mb: string) => `${mb} MB`,
      ubicacionTitulo: "Ubicación",
      ubicacionAbrir: "Ver en el mapa",
    },
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

    // ── El botón +, los adjuntos y las notas de voz ─────────────────────
    /** El botón + y la hoja que abre. */
    adjuntar: {
      abrir: "Adjuntar algo",
      cerrar: "Cerrar",
      titulo: "¿Qué querés mandar?",
      opciones: {
        camara: {
          etiqueta: "Cámara",
          detalle: "Sacá una foto o grabá un video ahora",
        },
        galeria: {
          etiqueta: "Fotos y videos",
          detalle: "Elegí de tu galería",
        },
        archivo: {
          etiqueta: "Archivo",
          detalle: "Un PDF que tengas guardado",
        },
        enlace: {
          etiqueta: "Enlace",
          detalle: "Compartí una página",
        },
        ubicacion: {
          etiqueta: "Ubicación",
          detalle: "Mandá dónde estás",
        },
        perfil: {
          etiqueta: "Mi perfil",
          detalle: "Para que sepa quién sos",
        },
      },
    },

    /** Elegir fotos y videos. */
    galeria: {
      titulo: "Fotos y videos",
      tabRecientes: "Recientes",
      tabAlbumes: "Álbumes",
      vacioRecientes: "Todavía no elegiste nada en esta charla.",
      elegirDelTelefono: "Elegir del teléfono",
      soloFotos: "Solo fotos",
      soloVideos: "Solo videos",
      sacarFoto: "Sacar una foto",
      grabarVideo: "Grabar un video",
      ayudaAlbumes:
        "Tu teléfono abre su propia galería, así elegís del álbum que quieras.",
      seleccion: (cantidad: number) =>
        cantidad === 1 ? "1 archivo seleccionado" : `${cantidad} archivos seleccionados`,
      seleccionFotos: (cantidad: number) =>
        cantidad === 1 ? "1 foto seleccionada" : `${cantidad} fotos seleccionadas`,
      quitar: "Quitar",
      enviar: "Enviar",
      pie: "Escribí algo (opcional)",
      tope: (maximo: number) => `Podés mandar hasta ${maximo} por vez.`,
    },

    /** Compartir un enlace. */
    enlace: {
      titulo: "Compartir un enlace",
      ayuda: "Pegá la dirección de la página que querés mandar.",
      campo: "Dirección",
      placeholder: "ejemplo.com/lo-que-quieras",
      invalido: "Esa dirección no se entiende. Revisala y probá de nuevo.",
      enviar: "Enviar enlace",
    },

    /** Ubicación. */
    ubicacion: {
      titulo: "Mandar tu ubicación",
      ayuda:
        "Se manda el punto donde estás ahora. No queda un rastro tuyo: es un mensaje, no un seguimiento.",
      pedir: "Usar mi ubicación",
      buscando: "Buscando dónde estás…",
      listo: "Listo, encontramos dónde estás.",
      etiqueta: "Ponele un nombre (opcional)",
      etiquetaPlaceholder: "Ej.: la plaza de la esquina",
      enviar: "Mandar ubicación",
      denegado:
        "Tu navegador no nos dejó ver dónde estás. Activá la ubicación para este sitio y volvé a intentar.",
      sinSoporte: "Este navegador no puede darnos tu ubicación.",
      demoro: "Tardó demasiado. Probá de nuevo en un momento.",
      noDisponible: "No pudimos saber dónde estás. Probá de nuevo en un rato.",
    },

    /** Compartir el perfil propio. */
    perfil: {
      enviando: "Mandando tu perfil…",
      error: "No pudimos mandar tu perfil. Probá de nuevo.",
    },

    /** Notas de voz. */
    voz: {
      grabar: "Grabar una nota de voz",
      mantener: "Mantené presionado para grabar",
      tocar: "Tocá para grabar",
      detener: "Terminar la grabación",
      grabando: "Grabando",
      deslizarCancelar: "Deslizá a la izquierda para cancelar",
      soltarCancelar: "Soltá para cancelar",
      deslizarBloquear: "Subí el dedo para seguir sin sostener",
      bloqueada: "Manos libres",
      pausar: "Pausar",
      seguir: "Seguir grabando",
      eliminar: "Eliminar la grabación",
      vistaPrevia: "Escuchala antes de mandarla",
      enviar: "Enviar la nota de voz",
      cancelada: "Grabación cancelada",
      /** El grabador se corta solo al llegar al tope. */
      topeAlcanzado: "Llegaste a 5 minutos, así que cortamos ahí.",
      /**
       * Los permisos se piden EN EL GESTO, nunca al abrir la pantalla. Cuando la
       * respuesta es que no, el texto dice qué pasó y qué se puede hacer — un
       * botón que no responde es peor que un aviso.
       */
      sinPermisoTitulo: "No pudimos usar el micrófono",
      sinPermisoCuerpo:
        "Tu navegador lo tiene bloqueado para este sitio. Activalo en los permisos y probá otra vez.",
      sinSoporteTitulo: "Este navegador no graba audio",
      sinSoporteCuerpo: "Podés escribir el mensaje o mandar un archivo de audio.",
      sinMicrofono: "No encontramos ningún micrófono conectado.",
      errorTitulo: "Se cortó la grabación",
      errorCuerpo: "No pudimos guardar el audio. Probá de nuevo.",
    },

    /** Reproductor de una nota de voz. */
    reproductor: {
      reproducir: "Escuchar",
      pausar: "Pausar",
      velocidad: (etiqueta: string) => `Velocidad ${etiqueta}. Tocá para cambiarla.`,
      noDisponible: "Este audio ya no está disponible.",
    },

    /** Estados del envío: lo optimista y su vuelta atrás. */
    envio: {
      enviando: "Enviando…",
      subiendo: (pct: number) => `Subiendo ${pct}%`,
      falloTitulo: "No se pudo enviar",
      reintentar: "Reintentar",
      descartar: "Descartar",
      cancelar: "Cancelar el envío",
    },

    /** Rechazos de la puerta del navegador y de la del servidor. */
    rechazo: {
      tipo: "Ese tipo de archivo no se puede mandar por acá.",
      peso: "El archivo pesa demasiado para mandarlo por chat.",
      vacio: "Ese archivo está vacío.",
      demasiados: (maximo: number) => `Podés mandar hasta ${maximo} archivos por vez.`,
      genericoTitulo: "No pudimos mandarlo",
      genericoCuerpo: "Probá de nuevo en un momento.",
    },

    /** Emojis en la barra. */
    emoji: {
      insertado: "Emoji agregado",
    },
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
  /**
   * Acciones sobre UN mensaje: reaccionar, responder, copiar, reenviar,
   * editar, eliminar y reportar.
   */
  acciones: {
    /** Cómo se nombra a quien está mirando. Se usa en la cita y en las reacciones. */
    vos: "Vos",

    menu: {
      /** El botón de tres puntos y el gesto de mantener presionado. */
      trigger: "Opciones del mensaje",
      title: "Este mensaje",
      cancel: "Cancelar",

      responder: "Responder",
      copiar: "Copiar",
      reenviar: "Reenviar",
      editar: "Editar",
      eliminar: "Eliminar",
      reportar: "Reportar",

      /**
       * Las razones por las que una acción no está. Se dicen en la fila, en
       * chico: un botón apagado sin explicación se lee como una falla de la app.
       */
      editarVencido: "Se puede editar hasta 15 minutos después de enviarlo",
      copiarSinTexto: "Este mensaje no tiene texto",
    },

    copiar: {
      listo: "Texto copiado",
      error: "No pudimos copiar el texto. Probá seleccionarlo y copiarlo a mano.",
    },

    reacciones: {
      /** Nombre accesible de la fila de emojis. */
      barLabel: "Reaccionar",
      poner: (emoji: string) => `Reaccionar con ${emoji}`,
      quitar: (emoji: string) => `Sacar tu reacción ${emoji}`,
      verTodos: "Más emojis",
      /** Debajo de la burbuja, para un lector de pantalla. */
      resumen: (total: number) =>
        total === 1 ? "1 reacción" : `${total} reacciones`,
      quienes: (nombres: string[], total: number) => {
        if (nombres.length === 0) {
          return total === 1 ? "1 persona reaccionó" : `${total} personas reaccionaron`;
        }
        if (total <= nombres.length) return nombres.join(", ");
        return `${nombres.join(", ")} y ${total - nombres.length} más`;
      },
      error: "No pudimos guardar tu reacción. Probá de nuevo.",
      /**
       * Reaccionar tiene su propio techo. "Probá de nuevo" sería un mal consejo:
       * hasta que baje el contador va a fallar igual.
       */
      rateLimitedTitle: "Esperá un momento",
      rateLimitedBody: "Pusiste muchas reacciones seguidas. Seguí en un rato.",
    },

    responder: {
      /** Encabezado de la cita, arriba del composer. */
      respondiendoA: (nombre: string) => `Respondiendo a ${nombre}`,
      aVosMismo: "Respondiendo a tu mensaje",
      cancelar: "Cancelar la respuesta",
      /** Cuando el mensaje citado no es texto. */
      resumenFoto: "Foto",
      resumenVideo: "Video",
      resumenAudio: "Nota de voz",
      resumenArchivo: "Archivo",
      resumenUbicacion: "Ubicación",
      resumenPerfil: "Perfil",
      resumenContenido: "Publicación",
      resumenBajado: "Mensaje eliminado",
      /** La cita adentro de la burbuja enviada, para teclado y lector. */
      irAlOriginal: (nombre: string) => `Ir al mensaje de ${nombre}`,
      noEncontrado: "Ese mensaje ya no está en la conversación",
    },

    editar: {
      title: "Editar el mensaje",
      intro: "Tu corrección se ve al instante y queda marcada como editada.",
      label: "Tu mensaje",
      guardar: "Guardar",
      guardado: "Mensaje corregido",
      /** La marca discreta al lado de la hora. */
      marca: "editado",
      marcaAria: "Este mensaje fue editado",
      vacio: "Escribí algo para poder guardar.",
      vencidoTitle: "Ya pasaron los 15 minutos",
      vencidoBody:
        "Los mensajes se pueden corregir hasta 15 minutos después de enviarlos. Este ya no.",
      noAutorTitle: "Este mensaje no es tuyo",
      noAutorBody: "Sólo quien lo escribió puede corregirlo.",
      flaggedTitle: "Esa corrección no se guardó",
      flaggedBody:
        "Detectamos algo que puede lastimar a otra persona. Probá decirlo de otra forma.",
      errorTitle: "No se pudo guardar",
      errorBody: "Algo no cargó bien de nuestro lado — no es tu culpa. Probá de nuevo.",
    },

    eliminar: {
      title: "¿Eliminar este mensaje?",
      body: "Va a desaparecer para todos y no se puede recuperar. En su lugar queda un aviso de que lo eliminaste.",
      confirmar: "Sí, eliminar",
      listo: "Mensaje eliminado",
      errorTitle: "No se pudo eliminar",
      errorBody: "Algo no cargó bien de nuestro lado — no es tu culpa. Probá de nuevo.",
      /** La lápida que queda en el hilo. */
      lapida: "Se eliminó este mensaje",
      lapidaPropia: "Eliminaste este mensaje",
    },

    reenviar: {
      /**
       * Reenviar un mensaje que NO es una tarjeta compartible todavía no está
       * enchufado: `compartirEnChatAction` manda una publicación, no un texto
       * suelto (ver el informe de entrega). Se dice en la fila apagada en vez de
       * esconder el botón sin motivo. El resto del copy del panel de destinos es
       * el de `SHARE_COPY`, que ya existe.
       */
      soloContenido: "Por ahora se pueden reenviar las publicaciones compartidas",
    },

    errores: {
      generic: "Algo no cargó bien de nuestro lado — no es tu culpa. Probá de nuevo.",
      forbidden: "Esta acción ya no está disponible para este mensaje.",
      /** El mensaje se bajó mientras el menú estaba abierto. */
      yaNoEsta: "Ese mensaje ya no está en la conversación.",
    },
  },
} as const;
