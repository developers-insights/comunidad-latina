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
        amountLabel: "Cuánto pagás",
        amountPlaceholder: "18",
        amountHelp: "Solo el número.",
        periodLabel: "Cada cuánto",
        periodHelp: "Cómo se calcula ese pago.",
        previewLabel: "Así se va a ver en tu aviso",
        typeLegend: "Dedicación",
        typeHelp: "Elegí lo que más se parezca a la carga horaria.",
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
        areaHelp: "Dónde se trabaja. Si es a distancia, poné “Remoto”.",
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
      areaShort: "Decinos la zona (al menos 3 caracteres).",
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
    loadMore: "Ver más empleos",
    loadingLabel: "Cargando empleos…",
    emptyTitle: "Todavía no hay empleos publicados",
    emptyMessage:
      "Acá vas a ver el trabajo que ofrece la comunidad. Si estás buscando gente, podés publicar el primero.",
    emptyFilteredTitle: "Nada con esa jornada por ahora",
    emptyFilteredMessage: "Probá con la otra opción o mirá todos los empleos disponibles.",
    emptyPublishCta: "Publicar el primer empleo",
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

    /** Vista de quien publicó el aviso: las postulaciones que le llegaron. */
    applications: {
      title: (count: number) => `Postulaciones (${count})`,
      emptyTitle: "Todavía no se postuló nadie",
      emptyMessage: "Apenas alguien se postule vas a verlo acá, con sus respuestas y su mensaje.",
      pendingNote:
        "Mientras el aviso está en revisión no lo ve la comunidad, así que todavía no van a llegar postulaciones.",
      messageTitle: "Su mensaje",
      answersTitle: "Sus respuestas",
      accept: "Aceptar",
      decline: "Rechazar",
      statusSubmitted: "Nueva",
      statusAccepted: "Aceptada",
      statusDeclined: "Rechazada",
      statusWithdrawn: "Retirada",
      acceptedNote: "Escribile por Mensajes para arreglar los detalles.",
      updated: "Listo, actualizamos la postulación.",
      errorGeneric: "No pudimos actualizarla — probá de nuevo en un ratito.",
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
      "Respondé las preguntas y, si querés, contale algo de vos. Solo lo ve quien publicó el aviso.",
    /** Botones segmentados de una pregunta de sí/no. */
    yes: "Sí",
    no: "No",
    questionCounter: (index: number, total: number) => `Pregunta ${index} de ${total}`,
    messageLabel: "Un mensaje para quien contrata",
    messageHelp: "Contá tu experiencia o cuándo podrías empezar. Un par de líneas alcanzan.",
    messagePlaceholder: "Ej.: Tengo tres años cuidando chicos y puedo empezar la semana que viene.",
    submit: "Enviar mi postulación",
    submitting: "Enviando…",
    successTitle: "¡Listo, ya te postulaste!",
    successBody:
      "Quien publicó el aviso va a ver tus respuestas. Si le interesa tu perfil, te escribe por acá.",
    successClose: "Entendido",
    errors: {
      unanswered: "Respondé todas las preguntas antes de enviar.",
      ownJob: "Este aviso lo publicaste vos, así que no podés postularte.",
      rateLimited: "Enviaste varias postulaciones seguidas. Esperá un ratito y probá de nuevo.",
      tenantMismatch: "Este aviso es de otra comunidad.",
      invalid: "Algo quedó incompleto — revisá las respuestas y probá de nuevo.",
      generic:
        "Algo no cargó bien de nuestro lado — no es tu culpa. Probá de nuevo en un ratito.",
    },

    /** Tarjeta de estado de MI postulación (reemplaza al CTA una vez enviada). */
    status: {
      submittedTitle: "Ya te postulaste",
      submittedBody:
        "Quien publicó el aviso está mirando las postulaciones. Te avisamos apenas te responda.",
      acceptedTitle: "¡Te eligieron para este trabajo!",
      acceptedBody:
        "Aceptaron tu postulación. Escribile por Mensajes para arreglar horarios y detalles.",
      declinedTitle: "Esta vez eligieron a otra persona",
      declinedBody:
        "No quedaste en este aviso, pero seguí mirando: la comunidad publica trabajos nuevos todo el tiempo.",
      withdrawnTitle: "Retiraste tu postulación",
      withdrawnBody:
        "Ya no aparece en la lista de quien publicó el aviso, y en este empleo no se puede volver a enviar.",
      withdraw: "Retirar mi postulación",
      withdrawn: "Retiraste tu postulación.",
      withdrawError: "No pudimos retirarla — probá de nuevo en un ratito.",
      browseMore: "Ver otros empleos",
      goToMessages: "Ir a Mensajes",
    },
  },
} as const;
