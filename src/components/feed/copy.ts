import { SHORT_VIDEO_LIMIT_MESSAGE } from "@/lib/media/video-policy";
import { MAX_PHOTOS } from "@/lib/media/post-media-limits";

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

  /**
   * FILA DE MÓDULOS que encabeza el feed (pedido del cliente 2026-08-12: los
   * tabs de texto pasaron a ser círculos con el ícono del módulo y el nombre
   * debajo). Los nombres de cada círculo NO viven acá: salen del registro de
   * módulos (shell/modules.ts), que es el mismo que nombra el menú y /buscar —
   * si "Vivienda" cambiara de nombre, tiene que cambiar en los tres lugares a
   * la vez o deja de ser el mismo lugar.
   *
   * Lo que sí vive acá son los nombres de la NAVEGACIÓN en sí, que sólo existen
   * en esta pantalla.
   */
  modules: {
    ariaLabel: "Módulos de tu comunidad",
    /**
     * Los dos grupos de la fila. Es la diferencia que el hairline dibuja para
     * quien ve, dicha en palabras para quien escucha: los primeros círculos
     * cambian lo que se ve ACÁ; los de después te llevan a otra sección.
     */
    filtersLabel: "Filtrar el feed",
    sectionsLabel: "Otras secciones",
    /**
     * El feed sin filtrar.
     *
     * Se llamó "Comunidad" un rato, por la palabra que el cliente anotó en la
     * captura — hasta que "Comunidad" pasó a ser un MÓDULO propio (perdido y
     * encontrado, clínicas, consulados). Dos círculos vecinos con el mismo
     * nombre y destinos distintos es peor que un nombre imperfecto: quien
     * busque el consulado va a tocar el que filtra el feed y no va a entender
     * por qué no encuentra nada.
     *
     * "Todo" nombra exactamente lo que hace —el feed SIN filtrar, al lado de
     * "Vivienda" y "Eventos", que sí filtran— y no compite con ningún módulo.
     */
    paraTi: "Todo",
  },

  composer: {
    addPhoto: "Agregar foto",
    addPhotos: "Agregar fotos",
    addMorePhotos: "Sumar otra foto",
    /** Tile "+" de la grilla (composer premium 2026-08-11): mismo cupo, ahora visible. */
    addPhotoTile: "Agregar foto",
    changePhoto: "Cambiar foto",
    removePhoto: "Quitar foto",
    /** Botón sobre la miniatura: abre el editor de filtro y texto de esa foto. */
    editPhoto: "Editar foto",
    photoTooBig: "Esa foto es muy pesada — probá con una de menos de 5 MB.",
    photoWrongType: "Solo podemos subir fotos (JPG, PNG o WebP).",
    /**
     * Cupo por publicación. El número sale de `MAX_PHOTOS` y no de la mano: el
     * aviso y el tope real no pueden decir cosas distintas.
     */
    photoLimit: `Podés subir hasta ${MAX_PHOTOS} fotos por publicación.`,
    /** Contador discreto bajo la grilla: "3 de 10 fotos". */
    photoCount: (count: number, max: number): string => `${count} de ${max} fotos`,
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
    /**
     * HORNEADO (composer premium 2026-08-11): recomprimir + quemar filtro y
     * texto pasa SIEMPRE que se publica una foto, la haya tocado alguien en
     * el editor o no — es lo que mantiene liviana una publicación de 10.
     * `done` empieza en 0 y sube: no es una espera muda, se ve avanzar.
     */
    bakingPhotos: (done: number, total: number): string =>
      `Preparando tus fotos… ${done} de ${total}`,
    /**
     * DEMASIADO PARA UNA SOLA PUBLICACIÓN. Con 10 fotos permitidas, un conjunto
     * puede pasarse de lo que entra en un envío — y si no lo avisamos ANTES, el
     * servidor corta el request y no se ve nada, o se ve un error que no
     * significa nada. Se dice en el idioma de la persona: "pesan mucho juntas"
     * y "sacá algunas", nunca megabytes ni límites de nada. El segundo renglón
     * existe para que no sienta que pierde las fotos que sacó.
     */
    photosTooHeavyTitle: "Estas fotos pesan mucho juntas",
    photosTooHeavyBody:
      "Sacá algunas y publicá de nuevo. Las que saques las podés compartir en otra publicación.",
    /**
     * UNA foto que no se pudo aliviar (el navegador no pudo procesarla y quedó
     * tal cual salió de la cámara). Es un problema de ESA foto, así que el
     * mensaje no puede decir "sacá algunas": lo que hay que hacer es cambiarla.
     */
    photoCantShrinkTitle: "Hay una foto que no pudimos preparar",
    photoCantShrinkBody:
      "Tu navegador no pudo achicarla. Quitala de la publicación o probá con otra foto.",
    /** El filtro/texto no se pudo aplicar en este navegador: se publicó igual, sin avisar con silencio. */
    bakeFallbackTitle: "Alguna foto se publicó sin editar",
    bakeFallbackBody:
      "No pudimos aplicarle el filtro o el texto en este navegador, así que salió tal cual — igual se publicó bien.",
    /**
     * PASOS POSTERIORES A LA PUBLICACIÓN. Las etiquetas y la música necesitan
     * el id del post, así que se guardan DESPUÉS de que ya salió. Estas dos
     * líneas existen para que ese tramo no se sienta como un botón colgado: no
     * son un "cargando" genérico, dicen exactamente qué se está guardando.
     */
    savingTags: "Guardando las etiquetas…",
    savingMusic: "Guardando la música…",
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
       *
       * "si querés" NO es un adorno (feedback cliente 2026-08-05: "si la
       * persona no quiere subir ningún texto relacionado, que le deje
       * publicar"): con foto o video el pie es OPCIONAL, y el campo tiene que
       * decirlo antes de que alguien se quede esperando el botón. Se dice como
       * habla una persona, no con un "(opcional)" de formulario. Este mismo
       * texto es el <label> del campo, así que tiene que leerse bien también
       * anunciado por un lector de pantalla.
       */
      mediaPlaceholder: (photos: number, hasVideo: boolean): string => {
        if (hasVideo && photos === 0) return "Contá algo de este video, si querés";
        if (hasVideo) return "Contá algo de lo que subiste, si querés";
        if (photos > 1) return "Contá algo de estas fotos, si querés";
        return "Contá algo de esta foto, si querés";
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
      /**
       * Cupo de fotos y video, visible mientras se arma la publicación.
       * `maxPhotos` viaja para que el "3 de 10" no quede huérfano del tope
       * real (composer premium 2026-08-11, `MAX_PHOTOS` subió a 10).
       */
      mediaCount: (photos: number, hasVideo: boolean, maxPhotos: number): string => {
        const parts: string[] = [];
        if (photos > 0) parts.push(`${photos} de ${maxPhotos} fotos`);
        if (hasVideo) parts.push("1 video");
        return parts.join(" · ");
      },

      /**
       * DECLARACIÓN DE ORIGINALIDAD Y LICENCIAS, plegada (requisito del pliego).
       *
       * El encabezado nombra LO QUE LA PERSONA ACABA DE SUBIR, no "el material":
       * en un composer donde la foto está a diez píxeles de distancia, decirle
       * "material" a esa foto la vuelve un trámite ajeno. Mismo criterio que
       * `mediaPlaceholder`, que ya cambia según lo elegido.
       *
       * La línea de abajo dice DOS cosas y en este orden: que es opcional
       * (primero, porque es lo que decide si vale la pena abrirlo) y para qué
       * sirve. Sin eso, un renglón nuevo entre la foto y Publicar se lee como un
       * requisito más, y la respuesta a un requisito que no se entiende es
       * marcarlo sin leer — que es exactamente lo que hace que una declaración
       * no valga nada.
       */
      declaration: {
        title: (photos: number, hasVideo: boolean): string => {
          if (hasVideo && photos > 0) return "Sobre lo que subiste";
          if (hasVideo) return "Sobre este video";
          if (photos > 1) return "Sobre estas fotos";
          return "Sobre esta foto";
        },
        /** Cerrado y sin declarar: por qué abrirlo, y que se puede no abrirlo. */
        hint: "Opcional. Nos ayuda a resolver rápido si alguien lo reclama como suyo.",
        /** Abierto: la salida digna se dice adentro, no solo en el selector. */
        intro: "Nada de esto es obligatorio: podés publicar igual.",
      },
    },

    /**
     * EDITOR DE FOTO (composer premium 2026-08-11, pedido de Manuel: filtros
     * + "algún subtítulo a la imagen o algo así como un título"). Se abre al
     * tocar una miniatura ya elegida — filtro y texto se quedan quemados en
     * la foto recién al publicar (`bake-photo.ts`); acá sólo se eligen.
     */
    photoEditor: {
      title: "Editar foto",
      filtersLabel: "Filtros",
      /**
       * Control de cuánto se aplica el filtro elegido. "Intensidad" y no
       * "opacidad" ni "fuerza del efecto": es la palabra que ya usa cualquiera
       * que tocó un filtro en el teléfono.
       */
      intensityLabel: "Intensidad",
      intensityValue: (percent: number) => `${percent}%`,
      /** Botón que abre el panel de texto (todavía sin nada escrito). */
      textButton: "Texto",
      /** Mismo botón, una vez que ya hay una frase cargada. */
      textButtonActive: "Editar texto",
      textareaLabel: "Escribí algo sobre la foto",
      textareaPlaceholder: "Un título corto, si querés",
      positionLabel: "Dónde va",
      positionTop: "Arriba",
      positionCenter: "Centro",
      positionBottom: "Abajo",
      backgroundLabel: "Fondo del texto",
      backgroundSolid: "Con fondo",
      backgroundNone: "Sin fondo",
      removeText: "Quitar texto",
      cancel: "Cancelar",
      done: "Listo",
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
    body: "Con tu cuenta podés publicar, preguntar y responderle a tus vecinos.",
    // El alta de cuentas está en pausa (todavía nadie puede crear una): queda
    // un solo botón, el de entrar con una cuenta que ya existe.
    cta: "Entrá a tu cuenta",
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

  /**
   * MENÚ ⋯ DE UNA PUBLICACIÓN (migración 0097, pedido del cliente con Facebook
   * de referencia: fijar, ocultar, desactivar comentarios, abrir en otra
   * pestaña). "Guardar" no está acá: ya vive como marcador en la fila de
   * acciones de la tarjeta y duplicarlo daría dos botones con el mismo nombre y
   * dos estados que se pueden desincronizar.
   *
   * Todos los rótulos dicen lo que la acción HACE, nunca el estado en el que
   * está: "Fijar publicación" y "Dejar de fijar" son dos textos distintos, como
   * "Me gusta" / "Quitar me gusta". Un botón que dice el estado obliga a
   * adivinar si al tocarlo lo prende o lo apaga.
   */
  postMenu: {
    pin: "Fijar publicación",
    unpin: "Dejar de fijar",
    pinnedTitle: "Publicación fijada",
    /** Se dice DÓNDE se ve el resultado: fijar sin ver el efecto parece que no hizo nada. */
    pinnedBody: "Va a aparecer primero en tu perfil. Podés fijar otra cuando quieras.",
    unpinnedTitle: "Ya no está fijada",
    unpinnedBody: "Vuelve a su lugar por fecha en tu perfil.",

    /**
     * "Ocultar del feed" y no "del timeline": nadie de esta comunidad dice
     * timeline. El cuerpo del aviso aclara las dos cosas que la gente asume mal
     * —que se borró y que se pierden los comentarios— antes de que las asuma.
     */
    hide: "Ocultar del feed",
    unhide: "Volver a mostrar",
    hiddenTitle: "Ya no aparece en el feed",
    hiddenBody:
      "Sigue siendo tuya: la ves en tu perfil, los comentarios y los me gusta quedan, y quien tenga el link la puede abrir. Volvé a mostrarla cuando quieras.",
    shownTitle: "Volvió al feed",
    shownBody: "Tu comunidad la puede ver de nuevo.",

    lockComments: "Desactivar comentarios",
    unlockComments: "Activar comentarios",
    commentsLockedTitle: "Comentarios desactivados",
    /** Se aclara que lo escrito no se borra: es el miedo real al tocar esto. */
    commentsLockedBody:
      "Nadie puede comentar por ahora, ni vos. Los comentarios que ya están siguen a la vista.",
    commentsUnlockedTitle: "Comentarios activados",
    commentsUnlockedBody: "Tu comunidad ya puede responder.",
    /** Cartel en el lugar del campo de escribir, para quien entra al hilo. */
    commentsClosedNotice: "Quien publicó desactivó los comentarios.",

    openInNewTab: "Abrir en otra pestaña",

    /** Un mensaje por motivo. Ninguno culpa a la persona ni usa jerga. */
    denial: {
      "no-disponible":
        "Solo quien publicó puede hacer esto, y desde su comunidad.",
      "no-publicada":
        "Tu publicación está en revisión. Vas a poder hacerlo apenas el equipo la mire.",
      "esta-oculta":
        "Está oculta del feed. Volvé a mostrarla y después fijala.",
      "no-esta": "Esa foto ya no está en la publicación.",
      "es-video":
        "El video no se puede quitar. Si querés cambiarlo, publicá de nuevo.",
      "es-la-unica":
        "Es la única foto de la publicación. Si la sacás no queda nada para ver — mejor publicá de nuevo.",
    },
    errorTitle: "No pudimos hacer ese cambio",
    errorBody: "Algo no cargó bien de nuestro lado — no es tu culpa. Probá de nuevo.",
    needsAuth: "Entrá a tu cuenta para administrar tus publicaciones.",
    rateLimited: "Hiciste muchos cambios seguidos. Esperá un ratito — tu cuenta está bien.",
  },

  /**
   * QUITAR UNA FOTO de una publicación ya publicada (0097). Vive en la hoja de
   * edición, sobre cada miniatura.
   *
   * El diálogo dice las dos cosas que no se pueden deshacer —la foto no vuelve y
   * la publicación queda marcada como editada— ANTES de confirmar. Enterarse
   * después es enterarse tarde (mismo criterio que el aviso de edición).
   */
  removePhoto: {
    trigger: "Quitar esta foto",
    /** Encabeza la tira de miniaturas dentro de la hoja de edición. */
    sectionLabel: "Fotos de la publicación",
    /** Nombre accesible del botón de cada miniatura ("Quitar la foto 2 de 5"). */
    triggerFor: (index: number, total: number) =>
      `Quitar la foto ${index} de ${total}`,
    dialogTitle: "¿Quitar esta foto?",
    dialogBody:
      "Deja de verse en la publicación y no se puede deshacer. Las demás fotos quedan como están, y la publicación va a figurar como editada.",
    confirm: "Sí, quitarla",
    confirming: "Quitando…",
    cancel: "No, dejarla",
    successTitle: "Foto quitada",
    successBody: "Tu publicación ya se ve sin ella.",
    /** Con una sola foto no se ofrece el botón: se dice por qué, no se esconde. */
    onlyOneHint:
      "Podés quitar fotos cuando hay más de una. Para cambiarlas o sumar otras, publicá de nuevo.",
  },

  /**
   * MENÚ DE UN COMENTARIO (0097). Hoy tiene una sola opción —eliminar— y aun así
   * es un menú y no una cruz suelta: una acción irreversible a un toque de
   * distancia del texto se toca sin querer mientras se scrollea.
   */
  commentMenu: {
    menuLabel: "Opciones del comentario",
    delete: "Eliminar comentario",
    dialogTitle: "¿Eliminar este comentario?",
    /**
     * Dos cuerpos, porque son dos situaciones distintas. Borrar el propio es un
     * arrepentimiento; borrar el de otra persona es un acto de moderación sobre
     * algo que alguien escribió, y el texto tiene que nombrarlo así en vez de
     * hacerlo sentir un trámite.
     */
    dialogBodyOwn: "Va a desaparecer del hilo y no se puede deshacer.",
    dialogBodyOther: (name: string) =>
      `Lo escribió ${name}. Va a desaparecer del hilo, no se le avisa, y no se puede deshacer.`,
    confirm: "Sí, eliminarlo",
    confirming: "Eliminando…",
    cancel: "No, dejarlo",
    successTitle: "Comentario eliminado",
    successBody: "Ya no aparece en el hilo.",
    errorTitle: "No pudimos eliminarlo",
    errorBody: "Algo no cargó bien de nuestro lado — no es tu culpa. Probá de nuevo.",
    /** La RLS lo rechazó: no es de la persona ni la publicación es suya. */
    forbidden:
      "Solo quien lo escribió o quien publicó pueden eliminar este comentario.",
  },
} as const;

/**
 * COPY QUE SE AGREGÓ DESPUÉS, EN BLOQUES PROPIOS.
 *
 * Van fuera de `COPY` a propósito y no es una preferencia de estilo: este
 * archivo lo están editando varios frentes a la vez, y meter una clave en el
 * medio de un objeto de 600 líneas es la forma más segura de perder trabajo
 * ajeno en un merge. Cuando el archivo esté quieto, entran donde corresponde
 * (`COPY.post` y `COPY.composer`) y estos dos exports desaparecen.
 */

/** Marcas que la TARJETA muestra sobre el estado de una publicación (0097). */
export const POST_CARD_COPY = {
  /**
   * Publicación fijada. Se nombra igual que el aviso que aparece al fijarla
   * (`COPY.postMenu.pinnedTitle`): quien acaba de tocar "Fijar" tiene que
   * reconocer en la tarjeta la misma palabra que leyó en el aviso.
   *
   * Fijar ordena el PERFIL de quien publicó, no el feed — acá la marca no
   * promete que esté primero, sólo cuenta que está fijada.
   */
  pinnedLabel: "Publicación fijada",
} as const;

/**
 * FILTROS SOBRE UN VIDEO (0104). Mismo carrusel y mismo catálogo de 16 que las
 * fotos; lo único distinto es lo que hay que contar: en la foto el filtro se
 * quema en el archivo y en el video se aplica al reproducirlo.
 */
export const VIDEO_EDITOR_COPY = {
  /** Título de la hoja mientras se elige el filtro de un video. */
  title: "Filtros del video",
  /** Botón/miniatura que abre esa hoja. */
  openLabel: "Elegir filtro del video",
  /**
   * Por qué es instantáneo y por qué no hay que esperar nada. Se dice en
   * positivo —"se sube tal cual lo grabaste"— y no en técnico: nadie tiene que
   * enterarse de qué es re-codificar para entender que su video no se va a
   * arruinar.
   */
  hint: "Tu video se sube tal cual lo grabaste. El filtro se aplica al reproducirlo.",
} as const;
