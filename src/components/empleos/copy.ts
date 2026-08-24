import type { JobPayPeriod } from "./helpers";

/**
 * Copy del módulo EMPLEOS COMUNITARIOS (niñera, mesera, construcción, limpieza).
 * Español rioplatense/caribeño CÁLIDO y sin jerga: quien publica puede ser una
 * señora que nunca cargó un aviso en su vida, y quien se postula está buscando
 * trabajo — nada de "payload", "opción múltiple" a secas ni tono de formulario.
 *
 * ── ARCHIVO COMPARTIDO ENTRE AGENTES ──────────────────────────────────────
 * Está partido en REGIONES de primer nivel, una por flujo. Cada región tiene un
 * dueño distinto y se edita QUIRÚRGICAMENTE (nunca se reescribe el archivo):
 *   · publish  → /empleos/publicar (este agente)
 *   · list / detail / apply → /empleos y /empleos/[id] (agente de sección)
 * Para sumar una región nueva, agregá SOLO su clave dentro de `COPY`.
 */

/** Etiquetas del período de pago — el orden de JOB_PAY_PERIODS manda en el <select>. */
const PAY_PERIOD_LABEL = {
  hour: "Por hora",
  day: "Por día",
  week: "Por semana",
  month: "Por mes",
} satisfies Record<JobPayPeriod, string>;

export const COPY = {
  // ===========================================================================
  // REGIÓN publish — wizard de /empleos/publicar
  // ===========================================================================
  publish: {
    title: "Publicar un empleo",
    subtitle:
      "Contá qué necesitás, cuánto pagás y qué querés saber de quien se postule. Son cuatro pasos cortos.",

    needLoginTitle: "Entrá para publicar tu empleo",
    needLoginBody:
      "Con tu cuenta publicás el aviso y recibís todas las postulaciones ordenadas en un solo lugar.",
    needLoginCta: "Entrar",

    /** Cintillo del paso actual, arriba del título. */
    stepEyebrow: (current: number, total: number) => `Paso ${current} de ${total}`,

    payPeriodLabel: PAY_PERIOD_LABEL,

    steps: {
      // ---------------------------------------------------------------- 1/4
      role: {
        title: "¿Qué puesto ofrecés?",
        intro: "Escribilo como se lo contarías a una vecina.",
        titleLabel: "Puesto",
        titlePlaceholder: "Ej.: Niñera para 2 nenes, tardes de lunes a viernes",
        titleHelp: "Decí el puesto y, si podés, el horario o la zona.",
        descriptionLabel: "Detalles del trabajo",
        descriptionPlaceholder:
          "Ej.: Busco niñera para dos nenes de 4 y 7 años. De lunes a viernes, de 3 a 7 de la tarde: los retirás del colegio, merienda y tarea. Se paga por hora, en efectivo o Zelle.",
        descriptionHelp:
          "Horarios, tareas y todo lo que ayude a saber si el trabajo le sirve. Mientras más claro, mejor gente se postula.",
      },

      // ---------------------------------------------------------------- 2/4
      pay: {
        title: "Salario y modalidad",
        intro:
          "Acá el pago no es opcional: los avisos que dicen cuánto pagan reciben muchas más postulaciones.",
        amountLabel: "Desde",
        amountPlaceholder: "18",
        amountHelp: "Solo el número.",
        /**
         * "Hasta" y no "Máximo": el que publica está diciendo hasta cuánto
         * puede pagar, no poniendo un techo a la persona. Y queda al lado de
         * "Desde", que se lee de corrido como el rango que es.
         */
        amountMaxLabel: "Hasta",
        amountMaxPlaceholder: "22",
        amountMaxHelp: "Si pagás un monto fijo, dejalo vacío.",
        periodLabel: "Cada cuánto",
        periodHelp: "Cómo se calcula ese pago.",
        previewLabel: "Así se va a ver en tu aviso",
        typeLegend: "Dedicación",
        typeHelp: "Elegí lo que más se parezca a la carga horaria.",
        modeLegend: "Dónde se trabaja",
        modeHelp: "Si es a distancia, después no hace falta poner una zona.",

        // ---- Bloque plegado: la ficha del puesto -------------------------
        // Seis campos que hoy se preguntan por chat. Van PLEGADOS a propósito:
        // son útiles, no obligatorios, y desplegados convertirían un paso de
        // tres controles en una planilla que nadie termina en un teléfono.
        moreTitle: "Más detalles del puesto",
        moreHint: "Opcional — ayuda a que se postule la gente correcta",
        daysLabel: "Días",
        daysHelp: "Tocá los días que se trabaja.",
        scheduleLabel: "Horario",
        schedulePlaceholder: "Ej.: de 9 a 17, con una hora de almuerzo",
        experienceLabel: "Experiencia que pedís",
        experiencePlaceholder: "Sin preferencia",
        languagesLabel: "Idiomas necesarios",
        languagesHelp: "Marcá todos los que hagan falta para el puesto.",
        startsOnLabel: "Cuándo empieza",
        applyByLabel: "Hasta cuándo se puede postular",
      },

      // ---------------------------------------------------------------- 3/4
      questions: {
        title: "Preguntas al postulante",
        intro:
          "Hasta 5 preguntas para saber lo esencial de entrada, sin tener que escribirle a cada persona.",
        counter: (used: number, max: number) => `${used} de ${max}`,
        addTitle: "Agregar una pregunta",
        addYesNo: "Sí o no",
        addYesNoHint: "Se responde con un toque",
        addChoice: "Opción múltiple",
        addChoiceHint: "Vos armás las opciones",
        typeYesNo: "Sí o no",
        typeChoice: "Opción múltiple",
        questionTitle: (n: number) => `Pregunta ${n}`,
        labelLabel: "La pregunta",
        labelPlaceholderYesNo: "Ej.: ¿Tenés experiencia cuidando niños?",
        labelPlaceholderChoice: "Ej.: ¿Qué días podés trabajar?",
        optionsLabel: "Opciones para elegir",
        optionPlaceholder: (n: number) => `Opción ${n}`,
        /** Nombre accesible único: puede haber 5 preguntas con "Opción 1" en pantalla. */
        optionAriaLabel: (question: number, option: number) =>
          `Pregunta ${question} · opción ${option}`,
        addOption: "Agregar opción",
        removeOption: "Quitar opción",
        removeQuestion: "Quitar pregunta",
        answerPreview: "Va a responder:",
        yes: "Sí",
        no: "No",
        maxReached: "Llegaste a las 5 preguntas: es el máximo para no cansar a quien se postula.",
        emptyTitle: "Todavía no agregaste preguntas",
        emptyBody:
          "Podés publicar el aviso así nomás. Si querés filtrar, una o dos preguntas alcanzan.",
        suggestionsTitle: "Ideas para empezar",
        /** Cada idea agrega una pregunta de sí/no ya escrita (se puede editar). */
        suggestions: [
          "¿Tenés experiencia en un trabajo parecido?",
          "¿Podés empezar esta semana?",
          "¿Vivís cerca de la zona?",
        ],
      },

      // ---------------------------------------------------------------- 4/4
      where: {
        title: "Zona y fotos",
        intro: "Último paso: dónde se trabaja y, si querés, una foto del lugar.",
        areaLabel: "Zona",
        areaPlaceholder: "Ej.: Washington Heights, NYC",
        /**
         * Ya NO dice «si es a distancia, poné "Remoto"»: eso lo declara ahora la
         * modalidad del paso anterior, y pedir que además se escriba a mano era
         * exactamente el texto libre que la 0087 vino a reemplazar. Con
         * modalidad "a distancia" este campo directamente no se muestra.
         */
        areaHelp: "El barrio o la ciudad donde se trabaja.",
        areaRemoteTitle: "Este trabajo es a distancia",
        areaRemoteBody:
          "Como se hace desde donde esté la persona, no hace falta poner una zona.",

        // ---- Negocio vinculado (listings.business_listing_id, 0107) -------
        businessLabel: "Publicar como negocio",
        businessHelp:
          "El aviso va a mostrar tu ficha, y el puesto aparece también en la página del negocio.",
        businessPersonal: "A nombre personal",
        photosTitle: "Fotos del lugar",
        photosHelp:
          "Opcional: hasta 4 fotos. Un aviso sin fotos se publica igual, no pasa nada.",
        addPhoto: "Agregar",
        removePhoto: "Quitar foto",
        photoAlt: (n: number) => `Foto ${n}`,
        tooManyPhotos: "Podés subir hasta 4 fotos.",
        tooBigPhoto: "Esa foto pesa demasiado. Probá con otra.",
        reviewNote: "Revisamos las fotos después de publicar, para cuidar la comunidad.",
      },
    },

    nav: {
      back: "Atrás",
      next: "Siguiente",
      submit: "Publicar empleo",
      submitting: "Publicando…",
    },

    successPublishedTitle: "¡Tu empleo ya está publicado!",
    successPublishedBody:
      "Aparece en Empleos y te avisamos apenas alguien se postule.",
    successReviewTitle: "Tu aviso está en revisión",
    successReviewBody:
      "El equipo de tu comunidad lo mira para cuidar la calidad. Apenas se apruebe, aparece en Empleos y vas a poder recibir postulaciones.",
    goToJobs: "Ver los empleos",
    publishAnother: "Publicar otro",

    errors: {
      titleShort: "Escribí el puesto con un poco más de detalle (al menos 8 caracteres).",
      descriptionShort: "Contanos un poco más del trabajo — al menos 30 caracteres.",
      salaryRequired: "Poné cuánto pagás. Es lo primero que mira la gente.",
      salaryRangeInvalid: "El máximo no puede ser menor que el mínimo. Revisá los dos montos.",
      areaShort: "Decinos la zona (al menos 3 caracteres).",
      applyByAfterStart:
        "La fecha límite para postularse tiene que ser antes de que empiece el trabajo.",
      businessLinkInvalid:
        "No pudimos vincular el aviso a ese negocio. Elegí uno tuyo o publicalo a nombre personal.",
      questionLabelShort: "Escribí la pregunta completa.",
      questionOptionsShort: "Una pregunta de opción múltiple necesita al menos 2 opciones.",
      questionOptionEmpty: "Completá todas las opciones o quitá las que sobran.",
      questionsInvalid: "Revisá las preguntas: hay alguna incompleta.",
      uploadFailed: "No pudimos subir una de las fotos. Probá de nuevo.",
      generic:
        "Algo no cargó bien de nuestro lado — no es tu culpa. Probá de nuevo en un ratito.",
    },
  },

  // ===========================================================================
  // REGIÓN list — /empleos (lista + filtro de jornada)
  // ===========================================================================
  list: {
    title: "Empleos en tu comunidad",
    subtitle: "Trabajos que ofrece gente de acá",
    /** Chips de jornada — la etiqueta de cada tipo sale de EMPLOYMENT_TYPE_LABEL. */
    filterLabel: "Filtrar por jornada",
    filterAll: "Todos",
    /** Sin monto cargado: lo decimos de frente en vez de dejar el hueco. */
    salaryToAgree: "Pago a convenir",
    /** Área de foto tocable: abre el visor, nunca el detalle (feedback 2026-07-26). */
    openPhotos: (title: string) => `Ver fotos de ${title}`,
    viewJob: "Ver empleo",
    /**
     * Aviso impulsado (`boosts`, §7). MISMA palabra que el resto de la app
     * ("Patrocinado", contrato del 2026-07-30 §4): la publicidad se divulga
     * siempre y con un solo nombre, en el feed y en cada listado.
     */
    adChip: "Patrocinado",
    loadMore: "Ver más empleos",
    loadingLabel: "Cargando empleos…",
    emptyTitle: "Todavía no hay empleos publicados",
    emptyMessage:
      "Acá vas a ver el trabajo que ofrece la comunidad. Si estás buscando gente, podés publicar el primero.",
    emptyFilteredTitle: "Nada con esa jornada por ahora",
    emptyFilteredMessage: "Probá con la otra opción o mirá todos los empleos disponibles.",
    emptyPublishCta: "Publicar el primer empleo",
    /** Publicador sin cuenta (seed/API) — mismo texto que /propiedades y /profesionales. */
    externalPublisher: (name: string) => `Publicado por ${name}`,
    /** Miembro con cuenta pero sin perfil resuelto en el batch (caso borde). */
    communityMember: "Miembro de la comunidad",
  },

  // ===========================================================================
  // REGIÓN detail — /empleos/[id] (aviso + vista de quien lo publicó)
  // ===========================================================================
  detail: {
    metadataFallback: "Empleo",
    salaryTitle: "Lo que paga",
    salaryToAgree: "A convenir",
    salaryToAgreeHint: "Quien contrata prefiere hablarlo con vos.",
    employmentUnknown: "Jornada a acordar",
    descriptionTitle: "Sobre el trabajo",
    questionsTitle: "Preguntas que te van a hacer",
    questionsHint:
      "Las respondés al postularte y las ve solo quien publicó el aviso. Te las mostramos antes para que no haya sorpresas.",
    questionYesNoHint: "Se responde sí o no",
    publishedBy: "Quién ofrece el trabajo",
    externalSourceNote: "Aviso traído de una fuente de la comunidad, sin cuenta acá.",
    fallbackPublisher: "Miembro de la comunidad",
    pendingBanner:
      "Tu empleo está en revisión — lo publicamos apenas pase el control de seguridad.",

    /** Vista de quien publicó el aviso: el acceso a su bandeja de candidatos. */
    applications: {
      title: "Quién se postuló",
      count: (total: number) =>
        total === 1 ? "1 persona se postuló" : `${total} personas se postularon`,
      openCount: (open: number) =>
        open === 1 ? "1 esperando tu respuesta" : `${open} esperando tu respuesta`,
      allAnswered: "Ya respondiste a todas.",
      open: "Ver candidatos",
      emptyTitle: "Todavía no se postuló nadie",
      emptyMessage: "Apenas alguien se postule vas a verlo acá, con sus respuestas y su currículum.",
      pendingNote:
        "Mientras el aviso está en revisión no lo ve la comunidad, así que todavía no van a llegar postulaciones.",
    },
  },

  // ===========================================================================
  // REGIÓN status — vocabulario del embudo, COMPARTIDO por las dos vistas
  //
  // Es el vocabulario que pidió el cliente, palabra por palabra. Vive una sola
  // vez: si "En revisión" dijera una cosa en la pantalla del candidato y otra
  // en la del empleador, las dos partes estarían hablando de cosas distintas.
  // ===========================================================================
  status: {
    label: {
      submitted: "Solicitud enviada",
      reviewing: "En revisión",
      interview: "Entrevista",
      hired: "Contratado",
      rejected: "No seleccionado",
      withdrawn: "Retirada",
      closed: "Vacante cerrada",
    },
  },

  // ===========================================================================
  // REGIÓN apply — postularse (hoja) y estado de mi postulación
  // ===========================================================================
  apply: {
    cta: "Postularme",
    ctaLoggedOut: "Entrar para postularme",
    sheetTitle: "Postularte a este empleo",
    intro:
      "Todo esto lo ve solo quien publicó el aviso. Antes de enviar te mostramos exactamente qué va a recibir.",
    /** Botones segmentados de una pregunta de sí/no. */
    yes: "Sí",
    no: "No",
    questionCounter: (index: number, total: number) => `Pregunta ${index} de ${total}`,
    questionsHeading: "Las preguntas del aviso",
    messageLabel: "Un mensaje para quien contrata",
    messageHelp: "Contá tu experiencia o cuándo podrías empezar. Un par de líneas alcanzan.",
    messagePlaceholder: "Ej.: Tengo tres años cuidando chicos y puedo empezar la semana que viene.",

    /** Autocompletado desde el perfil + el control para no compartirlo. */
    profile: {
      heading: "Tus datos",
      shared: "Quien contrata va a ver esto de tu perfil:",
      hidden: "Vas a postularte sin mostrar tu perfil.",
      hiddenHint:
        "Van a ver tus respuestas, tu mensaje y tu currículum, pero no tu foto, tu nombre ni tu zona.",
      toggleLabel: "Compartir mi perfil con quien contrata",
      toggleHelp: "Se completa solo desde tu perfil. Podés cambiarlo cuando quieras.",
      trustLabel: "Trust Score",
      verified: "Identidad verificada",
      noCity: "Sin zona cargada",
      completeProfile: "Completar mi perfil",
    },

    /** Currículum adjunto. */
    cv: {
      label: "Tu currículum",
      help: "PDF o Word, hasta 5 MB. Opcional, pero suma muchísimo.",
      choose: "Adjuntar currículum",
      replace: "Cambiar archivo",
      remove: "Quitar el archivo",
      removed: "Quitamos el archivo.",
      uploading: "Subiendo tu currículum…",
      uploadingLive: (pct: number) => `Subiendo tu currículum, ${pct} por ciento`,
      uploaded: "Currículum listo",
      /** Peso legible al lado del nombre del archivo. */
      size: (kb: number) => (kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.round(kb)} KB`),
      errorType: "Ese archivo no nos sirve. Adjuntá tu currículum en PDF o Word.",
      errorSize: "El archivo pesa más de 5 MB. Probá con uno más liviano.",
      errorEmpty: "Ese archivo está vacío. Probá con otro.",
      errorUpload: "No pudimos subir el archivo. Fijate la señal y probá de nuevo.",
    },

    /** Enlaces de portafolio. */
    portfolio: {
      label: "Enlaces de tu trabajo",
      help: "Hasta 5. Tu portafolio, tu perfil profesional o fotos de trabajos que hiciste.",
      placeholder: "https://",
      add: "Agregar otro enlace",
      remove: (index: number) => `Quitar el enlace ${index}`,
      inputLabel: (index: number) => `Enlace ${index}`,
      errorInvalid: "Los enlaces tienen que empezar con http:// o https://.",
      errorTooMany: "Podés sumar hasta 5 enlaces.",
    },

    /** Paso de confirmación: qué va a recibir quien contrata. */
    review: {
      cta: "Revisar y enviar",
      title: "Esto es lo que va a recibir",
      back: "Volver a editar",
      profileTitle: "Tu perfil",
      profileHidden: "No compartís tu perfil",
      answersTitle: "Tus respuestas",
      messageTitle: "Tu mensaje",
      messageEmpty: "Sin mensaje",
      cvTitle: "Currículum",
      cvEmpty: "Sin currículum adjunto",
      portfolioTitle: "Enlaces",
      portfolioEmpty: "Sin enlaces",
    },

    submit: "Enviar mi postulación",
    submitting: "Enviando…",
    successTitle: "¡Listo, ya te postulaste!",
    successBody:
      "Quien publicó el aviso va a ver lo que enviaste. Seguí el estado desde Mis postulaciones.",
    successClose: "Entendido",
    successMyApplications: "Ver mis postulaciones",
    errors: {
      unanswered: "Respondé todas las preguntas antes de enviar.",
      ownJob: "Este aviso lo publicaste vos, así que no podés postularte.",
      rateLimited: "Enviaste varias postulaciones seguidas. Esperá un ratito y probá de nuevo.",
      tenantMismatch: "Este aviso es de otra comunidad.",
      invalid: "Algo quedó incompleto — revisá las respuestas y probá de nuevo.",
      cv: "Revisá el currículum: tiene que ser PDF o Word y pesar menos de 5 MB.",
      portfolio: "Revisá los enlaces: cada uno tiene que empezar con http:// o https://.",
      generic:
        "Algo no cargó bien de nuestro lado — no es tu culpa. Probá de nuevo en un ratito.",
    },

    /** Tarjeta de estado de MI postulación (reemplaza al CTA una vez enviada). */
    status: {
      submittedTitle: "Ya te postulaste",
      submittedBody:
        "Quien publicó el aviso todavía no la abrió. Te avisamos apenas haya novedades.",
      reviewingTitle: "Están mirando tu postulación",
      reviewingBody:
        "Quien publicó el aviso ya la abrió. Si le interesa tu perfil, te escribe por acá.",
      interviewTitle: "Te invitaron a una entrevista",
      interviewBody: "Quieren conocerte. Entrá a Mensajes para acordar el día y la hora.",
      hiredTitle: "¡Te eligieron para este trabajo!",
      hiredBody: "Escribile por Mensajes para arreglar horarios y todos los detalles.",
      rejectedTitle: "Esta vez eligieron a otra persona",
      rejectedBody:
        "No quedaste en este aviso, pero seguí mirando: la comunidad publica trabajos nuevos todo el tiempo.",
      closedTitle: "Se cerró la búsqueda",
      closedBody:
        "El aviso dejó de buscar gente. No hace falta que hagas nada; tu postulación queda cerrada.",
      withdrawnTitle: "Retiraste tu postulación",
      withdrawnBody:
        "Ya no aparece en la lista de quien publicó el aviso, y en este empleo no se puede volver a enviar.",
      withdraw: "Retirar mi postulación",
      withdrawConfirmTitle: "¿Retirás tu postulación?",
      withdrawConfirmBody:
        "Deja de aparecer en la lista de quien publicó el aviso y no se puede volver a enviar en este empleo.",
      withdrawConfirm: "Sí, retirarla",
      withdrawCancel: "Mejor no",
      withdrawn: "Retiraste tu postulación.",
      withdrawError: "No pudimos retirarla — probá de nuevo en un ratito.",
      browseMore: "Ver otros empleos",
      goToMessages: "Ir a Mensajes",
      seeAll: "Ver todas mis postulaciones",
    },
  },

  // ===========================================================================
  // REGIÓN myApplications — /empleos/mis-aplicaciones (vista del candidato)
  // ===========================================================================
  myApplications: {
    metaTitle: "Mis postulaciones",
    title: "Mis postulaciones",
    subtitle: "Todos los empleos a los que te postulaste y en qué anda cada uno",
    backToJobs: "Ver empleos",

    needLoginTitle: "Entrá para ver tus postulaciones",
    needLoginBody:
      "Con tu cuenta seguís el estado de cada empleo al que te postulaste, en un solo lugar.",
    needLoginCta: "Entrar",

    emptyTitle: "Todavía no te postulaste a nada",
    emptyMessage:
      "Cuando te postules a un empleo, acá vas a poder seguir en qué anda: si lo están mirando, si te invitan a una entrevista o si eligieron a otra persona.",
    emptyCta: "Ver empleos abiertos",

    filterAll: "Todas",
    filterOpen: "En curso",
    filterClosed: "Cerradas",
    emptyOpenTitle: "No tenés postulaciones en curso",
    emptyOpenMessage: "Todas las que enviaste ya tienen respuesta. Podés seguir mirando avisos.",
    emptyClosedTitle: "Todavía no hay postulaciones cerradas",
    emptyClosedMessage: "Acá van a quedar las que ya tuvieron respuesta.",

    appliedAt: (when: string) => `Te postulaste ${when}`,
    updatedAt: (when: string) => `Última novedad ${when}`,
    jobClosed: "Este aviso ya no está publicado",
    withCv: "Con currículum",
    withLinks: (count: number) => (count === 1 ? "1 enlace" : `${count} enlaces`),
    profileShared: "Compartís tu perfil",
    profileHidden: "Sin compartir tu perfil",
    profileToggleOn: "Compartir mi perfil",
    profileToggleOff: "Dejar de compartir mi perfil",
    profileUpdated: "Listo, actualizamos qué ve quien contrata.",
    profileError: "No pudimos cambiarlo — probá de nuevo en un ratito.",
    viewJob: "Ver el aviso",
  },

  // ===========================================================================
  // REGIÓN candidates — /empleos/[id]/candidatos (vista del DUEÑO del aviso)
  // ===========================================================================
  candidates: {
    metaTitle: "Candidatos",
    title: "Candidatos",
    subtitle: (jobTitle: string) => `Quiénes se postularon a «${jobTitle}»`,
    backToJob: "Volver al aviso",
    notOwnerTitle: "Esta pantalla es de quien publicó el aviso",
    notOwnerBody:
      "Acá se ven las postulaciones que recibió el aviso, así que solo entra quien lo publicó.",

    countAll: (total: number) => (total === 1 ? "1 candidato" : `${total} candidatos`),
    countOpen: (open: number) =>
      open === 1 ? "1 esperando respuesta" : `${open} esperando respuesta`,

    emptyTitle: "Todavía no se postuló nadie",
    emptyMessage:
      "Un aviso recién publicado tarda un poco en llegar. Podés impulsarlo para que lo vea más gente de tu zona.",
    emptyCta: "Impulsar este aviso",
    emptySecondary: "Volver al aviso",
    pendingTitle: "Tu aviso está en revisión",
    pendingMessage:
      "Mientras lo revisamos no lo ve la comunidad, así que todavía no van a llegar postulaciones.",

    /** Filtros por estado, arriba de la lista. */
    filterAll: "Todos",
    filterOpen: "Sin responder",
    filterInterview: "En entrevista",
    filterResolved: "Resueltos",
    emptyFilterTitle: "Nada en este filtro",
    emptyFilterMessage: "Probá con otro filtro para ver el resto de los candidatos.",

    anonymousName: "Candidato sin perfil compartido",
    anonymousHint: "Eligió no mostrar su perfil. Sí podés leer todo lo que te envió.",
    noCity: "Sin zona",
    messageTitle: "Su mensaje",
    answersTitle: "Sus respuestas",
    cvTitle: "Currículum",
    cvOpen: "Abrir currículum",
    cvOpening: "Abriendo…",
    cvNone: "No adjuntó currículum",
    cvError: "No pudimos abrir el archivo — probá de nuevo en un ratito.",
    cvPrivacyNote: "El enlace del archivo dura un minuto y es solo tuyo.",
    portfolioTitle: "Sus enlaces",

    /** Nota privada del empleador. */
    noteTitle: "Tu nota privada",
    noteHelp: "Solo la ves vos. La persona que se postuló nunca se entera de esto.",
    notePlaceholder: "Ej.: Habla inglés, puede empezar el lunes. Llamar el martes.",
    noteAdd: "Agregar una nota",
    noteSave: "Guardar nota",
    noteSaving: "Guardando…",
    noteSaved: "Guardamos tu nota.",
    noteRemoved: "Borramos tu nota.",
    noteError: "No pudimos guardar la nota — probá de nuevo en un ratito.",
    noteCancel: "Cancelar",

    /** Acciones sobre el candidato. */
    viewProfile: "Ver perfil",
    sendMessage: "Enviar mensaje",
    save: "Guardar para después",
    saved: "Guardado",
    saveHint: "Queda en tu lista para futuras vacantes. La persona no se entera.",
    savedToast: "Lo guardamos para futuras vacantes.",
    unsavedToast: "Lo sacamos de tu lista.",
    saveError: "No pudimos guardarlo — probá de nuevo en un ratito.",

    /** Avanzar el embudo. Los verbos son acciones, no etiquetas de estado. */
    advance: {
      reviewing: "Marcar en revisión",
      interview: "Invitar a entrevista",
      hired: "Marcar contratado",
      rejected: "No seleccionar",
      closed: "Cerrar la vacante",
    },
    advanceHint: "Le avisamos a la persona en cada paso.",
    advanceMore: "Más acciones",
    advanceDone: (label: string) => `Listo, quedó en «${label}».`,
    advanceError: "No pudimos actualizarla — probá de nuevo en un ratito.",
    advanceConflict:
      "Esta postulación ya se resolvió y no vuelve atrás. Actualizá la pantalla para ver cómo quedó.",
    /** Confirmación de las decisiones que no tienen vuelta atrás. */
    confirmTitle: (label: string) => `¿Marcar «${label}»?`,
    confirmBody:
      "Esta decisión no se puede deshacer y le avisamos a la persona en el momento.",
    confirmCta: "Sí, confirmar",
    confirmCancel: "Cancelar",
    hiredNote: "Escribile por Mensajes para arreglar los detalles.",
  },
} as const;
