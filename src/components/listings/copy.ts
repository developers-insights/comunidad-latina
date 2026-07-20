/**
 * COPY del módulo VIVIENDA — local al módulo (no toca src/lib/i18n/*).
 * Español cálido rioplatense-neutro. El copy legal del verificador (§11)
 * vive en <VerificationCard> y NO se duplica acá.
 */
export const COPY = {
  list: {
    title: "Vivienda",
    subtitleNearArea: (area: string) => `Cerca de ${area}`,
    subtitleDefault: "En tu comunidad",
    publishCta: "Publicar",
    searchPlaceholder: "Buscá por barrio, tipo de lugar…",
    searchLabel: "Buscar propiedades",
    filterPriceLabel: "Precio máx.",
    filterPriceAny: "Cualquier precio",
    filterBedroomsLabel: "Habitaciones",
    filterBedroomsAny: "Todas",
    filterZoneLabel: "Zona",
    filterZoneAny: "Todas las zonas",
    clearFilters: "Limpiar filtros",
    verifiedChip: (date: string) => `Licencia activa al ${date}`,
    externalPublisher: (name: string) => `Publicado por ${name}`,
    communityMember: "Miembro de la comunidad",
    viewDetails: "Ver detalles",
    loadMore: "Ver más propiedades",
    emptyTitle: "Todavía no hay nada por acá",
    emptyMessage:
      "No encontramos propiedades con esos filtros. Probá ampliar la búsqueda — o publicá lo que estás buscando para que la comunidad te ayude.",
    emptySearchTitle: "No encontramos nada con esas palabras",
    emptySearchMessage:
      "Probá con menos palabras o revisá los filtros. También podés publicar lo que buscás para que la comunidad lo vea.",
    emptyPublishCta: "Publicar lo que busco",
  },
  detail: {
    back: "Volver",
    share: "Compartir",
    shareCopiedTitle: "Link copiado",
    shareCopiedBody: "Compartilo con quien quieras.",
    photoCounter: (current: number, total: number) => `${current}/${total}`,
    galleryLabel: "Fotos de la propiedad",
    galleryPrev: "Foto anterior",
    galleryNext: "Foto siguiente",
    verificationBandLead: "Verificación vigente",
    verificationBandDetail: "Ver detalle",
    verificationBandHide: "Ocultar detalle",
    bedrooms: (n: number) => `${n} ${n === 1 ? "hab" : "habs"}`,
    bathrooms: (n: number) => `${n} ${n === 1 ? "baño" : "baños"}`,
    sqft: (n: number) => `${n.toLocaleString("es-US")} ft²`,
    publishedBy: "Publicado por",
    externalSourceNote: "Aviso de fuente externa (publicado con permiso)",
    descriptionTitle: "Descripción",
    locationTitle: "Ubicación aproximada",
    locationPrivacy:
      "La dirección exacta se comparte cuando el anunciante acepta tu contacto.",
    // Una sola mención de la protección, y concreta (pedido cliente
    // 2026-07-20): decirlo en el botón Y debajo sonaba a insistencia, y
    // "protegido" no dice QUÉ se protege. El dato que importa es el teléfono.
    contactCta: "Contactar",
    contactHint: "Tu teléfono no se comparte",
    contactSuccessTitle: "¡Listo! Le avisamos al anunciante",
    contactSuccessBody: "Cuando acepte tu contacto, van a poder hablar por acá.",
    // Resultados no-felices del contacto protegido. La server action mapea cada
    // código del RPC request_contact (AUTH_REQUIRED, CANNOT_CONTACT_SELF, …) a
    // uno de estos textos y define el tono (info | error) del toast. Los casos
    // "info" NO son errores: son aclaraciones amables, no van en rojo.
    contactOwnTitle: "Este aviso es tuyo",
    contactOwnBody: "No necesitás contactarte — ya sos quien lo publica.",
    contactNoAccountTitle: "El chat todavía no está disponible",
    contactNoAccountBody:
      "Quien publicó este aviso todavía no tiene cuenta en la comunidad, así que el chat no está disponible.",
    contactUnavailableTitle: "Este aviso ya no está disponible",
    contactUnavailableBody:
      "Puede que se haya pausado o dado de baja. Probá con otro aviso de la comunidad.",
    contactAuthTitle: "Entrá para poder contactar",
    contactAuthBody: "Para contactar necesitás entrar a tu cuenta.",
    // Fallback: si algo no previsto falla, dejamos claro que es una demo.
    contactDemoTitle: "Esto es una demo",
    contactDemoBody:
      "El contacto real se habilita con tu comunidad activa. Probá de nuevo más tarde.",
    seedSheetTitle: "Este aviso vino de una fuente externa",
    seedSheetBody: (name: string) =>
      `Lo publicó ${name} fuera de la app, con su permiso. El contacto se hace por los datos que esa fuente publicó — no podemos protegerlo desde acá.`,
    seedSheetReminder:
      "Recordá: nunca envíes dinero, depósito ni documentos sin ver el lugar en persona o por videollamada.",
    seedSheetClose: "Entendido",
    pendingBanner:
      "Tu aviso está en revisión — lo publicamos apenas pase el control de seguridad.",
    moreActions: "Más opciones",
  },
  report: {
    sheetTitle: "Reportar un problema",
    intro:
      "Contanos qué pasó con este aviso. Tu reporte es confidencial y ayuda a proteger a toda la comunidad.",
    reasonLabel: "¿Qué pasó?",
    reasons: [
      { value: "pide_dinero_adelantado", label: "Piden dinero por adelantado" },
      { value: "quiere_salir_de_la_app", label: "Insisten en hablar por fuera de la app" },
      { value: "datos_falsos", label: "El aviso no es lo que dice ser" },
      { value: "otro", label: "Otra cosa" },
    ],
    detailsLabel: "Contanos más (opcional)",
    detailsPlaceholder: "Todo detalle ayuda a que el equipo actúe rápido.",
    submit: "Enviar reporte",
    successTitle: "Reporte enviado",
    successBody: "Gracias por avisar. El equipo lo revisa a la brevedad.",
    errorTitle: "No se pudo enviar el reporte",
    errorBody: "Algo no cargó bien de nuestro lado — no es tu culpa. Probá de nuevo.",
    needLogin: "Entrá a tu cuenta para poder reportar.",
  },
  publish: {
    title: "Publicar un aviso",
    stepLabel: (current: number, total: number) => `Paso ${current} de ${total}`,
    needLoginTitle: "Para publicar, primero entrá",
    needLoginMessage:
      "Publicar es gratis y toma dos minutos. Necesitamos que entres a tu cuenta para proteger tu aviso y tu contacto.",
    needLoginCta: "Entrar a mi cuenta",
    steps: {
      kind: {
        title: "¿Qué querés publicar?",
        help: "Elegí el tipo de aviso. Podés publicar todos los que necesites.",
      },
      text: {
        title: "Contanos sobre tu aviso",
        titleLabel: "Título",
        titlePlaceholder: "Ej.: Habitación luminosa en Corona",
        titleHelp: "Corto y claro — es lo primero que se ve.",
        descriptionLabel: "Descripción",
        descriptionPlaceholder:
          "Contá lo importante: cómo es el lugar, qué incluye, desde cuándo está disponible…",
        descriptionHelp: "Mientras más completa, menos preguntas repetidas.",
      },
      price: {
        title: "Precio y detalles",
        priceLabel: "Precio",
        pricePlaceholder: "1350",
        periodLabel: "Frecuencia",
        bedroomsLabel: "Habitaciones",
        bathroomsLabel: "Baños",
        sqftLabel: "Superficie (ft²)",
      },
      zone: {
        title: "¿En qué zona está?",
        zoneLabel: "Barrio o zona",
        zonePlaceholder: "Ej.: Jackson Heights, Queens",
        zoneHelp:
          "Solo el barrio — nunca publicamos la dirección exacta. Así te cuidamos a vos y al lugar.",
        addressLabel: "Dirección exacta",
        addressPlaceholder: "Ej.: 37-11 82nd St, apto 2B",
        addressHelp:
          "NO se publica. Queda guardada solo para vos, y se comparte únicamente cuando vos aceptás un contacto.",
      },
      photos: {
        title: "Sumá fotos (opcional)",
        help: "Hasta 6 fotos. Los avisos con fotos reciben muchas más consultas.",
        addLabel: "Agregar fotos",
        removeLabel: "Quitar foto",
        tooMany: "Podés subir hasta 6 fotos.",
        tooBig: "Esa foto es muy pesada — probá con una de menos de 8 MB.",
        reviewNote:
          "Las fotos pasan por un control de seguridad antes de publicarse.",
      },
    },
    nav: {
      back: "Atrás",
      next: "Continuar",
      submit: "Publicar aviso",
      submitting: "Publicando…",
    },
    errors: {
      kindRequired: "Elegí un tipo de aviso para seguir.",
      titleShort: "El título necesita al menos 8 caracteres.",
      descriptionShort: "Contanos un poco más — al menos un par de frases.",
      priceRequired: "Poné un precio (puede ser aproximado).",
      zoneShort: "Decinos el barrio o la zona.",
      uploadFailed:
        "No pudimos subir las fotos — revisá tu conexión e intentá de nuevo.",
      generic:
        "Algo no cargó bien de nuestro lado — no es tu culpa. Probá de nuevo en un ratito.",
    },
    success: {
      publishedTitle: "¡Tu aviso ya está publicado!",
      publishedBody: "La comunidad ya puede verlo y contactarte de forma protegida.",
      reviewTitle: "Tu aviso está en revisión",
      reviewBody:
        "Lo publicamos apenas pase el control de seguridad. Te avisamos por acá.",
      goToListings: "Ver propiedades",
      publishAnother: "Publicar otro aviso",
    },
  },
} as const;
