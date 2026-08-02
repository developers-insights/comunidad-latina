/**
 * COPY del módulo MONETIZACIÓN. Español cálido rioplatense-neutro, voseo suave.
 *
 * Dos reglas propias de este módulo, porque es el que cobra:
 *
 *  1. NUNCA prometer lo que el sistema no hace. La campaña guarda países,
 *     ciudades, edad, idiomas e intereses, y HOY no hay motor que los use para
 *     elegir a quién mostrarle el anuncio (está fuera de alcance por decisión
 *     del contrato). El copy lo dice con todas las letras en vez de dejar que
 *     la persona lo suponga: se paga alcance, no segmentación.
 *  2. El plan gratuito se explica, no se castiga. El panel muestra qué suma
 *     premium sin tapar lo que la persona vino a ver — un muro que hay que
 *     esquivar para leer tus propias estadísticas es una forma cara de que
 *     alguien se vaya.
 *  3. UNA sola palabra para la cosa que se vende: "aviso". El archivo alternaba
 *     "aviso" y "publicación" —a veces en la misma tarjeta: el título prometía
 *     "no perdés tu aviso" y el cuerpo hablaba de "tu publicación"—, y quien
 *     está por pagar no tiene por qué deducir que son lo mismo. "aviso" es lo
 *     que ya dicen el resto del módulo ("Publicar aviso", "Promocionar tu
 *     aviso") y la ruta que lo muestra (/negocios/presencia/aviso/[id]).
 *     "publicación" queda reservada para los posts del feed, que son otra cosa.
 */

import type { ExternalCtaKind } from "./tier";

export const COPY = {
  // -------------------------------------------------------------------------
  // Gratis vs premium
  // -------------------------------------------------------------------------
  tier: {
    freeLabel: "Aviso gratuito",
    premiumLabel: "Aviso premium",
    freeBadge: "Gratis",
    premiumBadge: "Premium",

    comparisonTitle: "Qué incluye cada aviso",
    freeColumnTitle: "Gratis",
    premiumColumnTitle: "Premium",

    freePoints: [
      "Hasta 5 fotos",
      "1 video de hasta 59 segundos",
      "Chat de Comunidad Latina para que te escriban",
      "Aparece en tu perfil, en las búsquedas y en su sección",
    ],
    premiumPoints: [
      "Hasta 20 fotos",
      "1 video de hasta 5 minutos",
      "Botones de acción: llamar, WhatsApp, sitio web y más",
      "Aparece también en el feed principal de la comunidad",
      "Prioridad en los resultados de búsqueda",
      "Estadísticas completas, con los clics de cada botón",
    ],

    photoLimitHelp: (max: number) =>
      max === 1 ? "Podés subir 1 foto." : `Podés subir hasta ${max} fotos.`,
    /** Ayuda completa del paso de fotos: el tope real + el porqué de subirlas. */
    photoStepHelp: (max: number) =>
      `Hasta ${max} fotos. Los avisos con fotos reciben muchas más consultas.`,
    photoLimitReached: (max: number) =>
      `Llegaste a ${max} ${max === 1 ? "foto" : "fotos"}. Con premium podés subir hasta 20.`,
    videoLimitHelp: (seconds: number) =>
      seconds >= 60
        ? `Tu video puede durar hasta ${Math.round(seconds / 60)} minutos.`
        : `Tu video puede durar hasta ${seconds} segundos.`,

    /** Lo que se le dice a alguien en gratis, sin sonar a reto. */
    freeContactNote:
      "Tu aviso se contacta por el chat de Comunidad Latina. Tu teléfono no se publica.",
    upgradeTeaser:
      "Con premium sumás botones para que te llamen, te escriban por WhatsApp o vayan directo a tu sitio.",
    upgradeCta: "Ver qué incluye premium",
  },

  // -------------------------------------------------------------------------
  // Suscripción premium de UN aviso — la pantalla que COBRA
  //
  // Tres reglas propias, porque acá se saca la tarjeta:
  //  1. Decir el precio y la frecuencia ANTES del botón, no después.
  //  2. Contar qué pasa al cancelar sin que haya que preguntarlo. El miedo real
  //     de quien paga no es el precio: es "¿pierdo mi aviso?". La respuesta es
  //     no, y va escrita.
  //  3. Nombrar lo de los botones de contacto. Al bajar a gratis desaparecen
  //     (la base lo obliga) y vuelven al reactivar (0054 los guarda). Ocultarlo
  //     y que alguien vea su teléfono borrado sería la peor sorpresa posible.
  // -------------------------------------------------------------------------
  premium: {
    pageTitle: "Aviso premium",
    /** Debajo del título. Una frase, sin adjetivos de más. */
    pageIntro: "Más fotos, videos más largos y botones para que te contacten.",

    priceSuffix: "por mes",
    priceNote: "Se renueva solo cada mes. Cancelás cuando quieras.",

    includesTitle: "Qué incluye",

    /** La promesa que saca el miedo de encima, antes del botón. */
    safetyTitle: "Si cancelás, no perdés tu aviso",
    safetyBody:
      "Tu aviso sigue publicado como gratuito: hasta 5 fotos, un video de 59 segundos y contacto por el chat. Guardamos los botones que cargaste y vuelven apenas te suscribas de nuevo.",

    activateCta: "Pasar a premium",
    reactivateCta: "Volver a premium",
    manageCta: "Ver mis pagos",
    manageHint: "Ahí cambiás la tarjeta, reanudás o cancelás, cuando quieras.",

    // Estados que ve el dueño. Título corto, cuerpo que dice qué hacer.
    statusActiveTitle: "Tu aviso es premium",
    statusActiveBody: (fecha: string) => `Se renueva sola el ${fecha}.`,
    statusActiveBodyNoDate: "Ya está activa. La próxima renovación es automática.",

    statusCancelingTitle: (fecha: string) => `Premium hasta el ${fecha}`,
    statusCancelingBody:
      "Cancelaste la renovación. Hasta esa fecha no cambia nada. Después tu aviso vuelve a ser gratuito y guardamos tus botones.",

    statusPastDueTitle: "No pudimos cobrar tu premium",
    statusPastDueBody:
      "Tu aviso sigue premium mientras lo intentamos de nuevo. Actualizá tu tarjeta para no perder los botones.",

    statusEndedTitle: "Tu premium terminó",
    statusEndedBody:
      "Tu aviso sigue publicado, ahora como gratuito. Tus botones quedaron guardados: volvés a verlos apenas te suscribas.",

    // Éxito y cancelación del Checkout (vuelta desde Stripe).
    checkoutSuccess:
      "¡Listo! Recibimos tu pago. Tu aviso pasa a premium en unos minutos.",
    checkoutCanceled: "No se hizo ningún cargo. Cuando quieras, acá te esperamos.",

    /** Feature para <ProximamentePremium> cuando no hay Stripe configurado. */
    proximamenteFeature: "los pagos",

    errors: {
      alreadyActive:
        "Este aviso ya es premium. Para cambiar tu tarjeta o cancelar, entrá a “Ver mis pagos”.",
      noPortal:
        "Todavía no tenés pagos hechos para este aviso, así que no hay nada que gestionar.",
      notPublished:
        "Tu aviso tiene que estar publicado. Apenas lo apruebe el equipo de tu comunidad, volvé por acá.",
    },
  },

  // -------------------------------------------------------------------------
  // Botones de acción
  // -------------------------------------------------------------------------
  cta: {
    /** Etiqueta visible del botón. Corta, verbo primero. */
    label: {
      phone: "Llamar",
      whatsapp: "WhatsApp",
      website: "Sitio web",
      purchase: "Comprar",
      tickets: "Comprar boletos",
      booking: "Reservar cita",
      directions: "Cómo llegar",
      chat: "Escribir por el chat",
    } satisfies Record<ExternalCtaKind | "chat", string>,

    /**
     * Nombre accesible: la ACCIÓN y el DESTINO, en ese orden. Un lector de
     * pantalla que anuncia cinco veces "enlace, botón" no dice nada; "Llamar a
     * Panadería Doña Rosa al +1 305 555 0134" dice todo.
     */
    accessible: {
      phone: (subject: string, value: string) => `Llamar a ${subject} al ${value}`,
      whatsapp: (subject: string, value: string) =>
        `Escribir por WhatsApp a ${subject} al ${value}`,
      website: (subject: string) => `Abrir el sitio web de ${subject} (se abre en otra pestaña)`,
      purchase: (subject: string) => `Comprar ${subject} en su tienda (se abre en otra pestaña)`,
      tickets: (subject: string) => `Comprar boletos para ${subject} (se abre en otra pestaña)`,
      booking: (subject: string) => `Reservar una cita con ${subject} (se abre en otra pestaña)`,
      directions: (subject: string, value: string) => `Cómo llegar a ${subject}: ${value}`,
      chat: (subject: string) => `Escribirle a ${subject} por el chat de Comunidad Latina`,
    },

    externalHint: "Se abre fuera de Comunidad Latina",
    /** Aparece una sola vez debajo de la fila, no en cada botón. */
    safetyNote:
      "Estos datos los publicó quien anuncia. Nunca envíes dinero por adelantado.",

    // Formulario de carga (dueño del aviso)
    formTitle: "Botones de acción",
    formIntro:
      "Elegí cómo querés que te contacten. Lo que dejes vacío no se muestra.",
    formPremiumOnly:
      "Los botones de acción son parte del aviso premium. En tu aviso gratuito el contacto es el chat de Comunidad Latina.",
    formSaved: "Listo, guardamos tus botones",
    formSavedBody: "Ya aparecen en tu aviso.",
    fieldLabel: {
      phone: "Teléfono para llamadas",
      whatsapp: "WhatsApp",
      website: "Sitio web",
      purchase: "Link para comprar",
      tickets: "Link para comprar boletos",
      booking: "Link para reservar cita",
      directions: "Dirección para el mapa",
    } satisfies Record<ExternalCtaKind, string>,
    fieldPlaceholder: {
      phone: "+1 305 555 0134",
      whatsapp: "+1 305 555 0134",
      website: "https://tunegocio.com",
      purchase: "https://tutienda.com/producto",
      tickets: "https://boleteria.com/tu-evento",
      booking: "https://tuagenda.com/reservar",
      directions: "Ej.: 37-11 82nd St, Jackson Heights",
    } satisfies Record<ExternalCtaKind, string>,
    fieldHelp: {
      directions:
        "Se muestra como un botón que abre el mapa. Poné la dirección tal como querés que la vea la gente.",
    },
  },

  // -------------------------------------------------------------------------
  // Errores (server actions) — cálidos, sin jerga, siempre con salida
  // -------------------------------------------------------------------------
  errors: {
    generic:
      "Algo no salió bien de nuestro lado — no es tu culpa. Probá de nuevo en un momento.",
    needsAuth: "Para esto necesitás entrar a tu cuenta.",
    notYours: "Este aviso no es tuyo, así que no podés editarlo.",
    notPublished:
      "El aviso tiene que estar publicado. Apenas lo apruebe el equipo de tu comunidad, volvé por acá.",
    premiumOnly:
      "Los botones de acción vienen con el aviso premium. Mientras tanto, tu aviso se contacta por el chat.",
    tooManyPhotos: (max: number) =>
      `Tu aviso admite hasta ${max} ${max === 1 ? "foto" : "fotos"}. Sacá alguna o pasate a premium para subir hasta 20.`,
    videoTooLong: (max: number) =>
      max >= 60
        ? `Tu video puede durar hasta ${Math.round(max / 60)} minutos. Recortalo un poco y volvé a intentar.`
        : `Tu video puede durar hasta ${max} segundos. Con premium podés subir uno de hasta 5 minutos.`,
    videoUnknown:
      "No pudimos leer la duración de ese video. Probá con otro archivo.",
    invalidPhone:
      "Revisá el número: escribilo completo con el código de país, por ejemplo +1 305 555 0134.",
    invalidUrl:
      "Ese link no se entiende. Tiene que empezar con https:// y llevar a una página real.",
    invalidAddress: "Escribí la dirección completa, para que el mapa la encuentre.",
    tooManyTries:
      "Guardaste muchos cambios seguidos. Esperá un momento y probá de nuevo — no se perdió nada.",
  },

  // -------------------------------------------------------------------------
  // Promocionar: los dos caminos
  // -------------------------------------------------------------------------
  promote: {
    title: "Promocionar tu aviso",
    subtitle: "Hay dos formas, y hacen cosas distintas.",
    boostTab: "Impulso",
    campaignTab: "Campaña",
    // "Patrocinado" y no "Destacado" (contrato 2026-07-30 §4): "Destacado" es el
    // nivel máximo del Trust Score, que se gana por reputación. Una sola palabra
    // para las dos cosas hacía que un espacio pago se leyera como mérito.
    boostSummary:
      "Un pago único: tu aviso sube al principio de los resultados con la etiqueta \"Patrocinado\".",
    campaignSummary:
      "Armás una campaña con objetivo, presupuesto y a quién querés llegar. Queda guardada y la podés revisar cuando quieras.",
    chooseTitle: "¿Qué querés hacer?",
  },

  // -------------------------------------------------------------------------
  // Campaña — el copy más delicado del módulo
  // -------------------------------------------------------------------------
  campaign: {
    title: "Crear una campaña",
    intro:
      "Contanos qué buscás y cuánto querés invertir. Guardamos la configuración completa y podés editarla mientras sea borrador.",

    /**
     * LA FRASE HONESTA. Sin ella, cargar países, edades e intereses hace creer
     * que el anuncio se le muestra a esa gente y a nadie más. Hoy no es así, y
     * decirlo antes de cobrar es lo único decente.
     */
    deliveryNoticeTitle: "Cómo se muestra hoy tu campaña",
    deliveryNoticeBody:
      "Tu campaña se muestra a toda la comunidad, igual que un impulso. Los datos de país, ciudad, edad, idioma e intereses quedan guardados en tu campaña, pero todavía no filtran a quién le aparece el anuncio. Te vamos a avisar cuando eso cambie.",

    objectiveLabel: "¿Qué querés lograr?",
    objectives: [
      { value: "reach", label: "Que me conozcan", hint: "Llegar a la mayor cantidad de gente." },
      { value: "traffic", label: "Visitas a mi sitio", hint: "Que entren a tu página o tienda." },
      { value: "messages", label: "Que me escriban", hint: "Empezar conversaciones por el chat." },
      { value: "leads", label: "Conseguir contactos", hint: "Juntar consultas de gente interesada." },
      { value: "sales", label: "Vender", hint: "Cerrar ventas de lo que ofrecés." },
    ],

    budgetLabel: "Presupuesto",
    budgetHelp: "En dólares, para toda la campaña. Podés cambiarlo mientras sea borrador.",
    budgetError: "Poné un presupuesto de al menos USD 1.",

    durationLabel: "¿Cuántos días?",
    durationHelp: "Entre 1 y 90 días.",
    durationError: "Elegí una cantidad de días entre 1 y 90.",

    audienceTitle: "A quién te gustaría llegar",
    audienceOptional: "Todo esto es opcional.",
    countriesLabel: "Países",
    countriesPlaceholder: "Ej.: Estados Unidos, México",
    citiesLabel: "Ciudades",
    citiesPlaceholder: "Ej.: Queens, Miami",
    languagesLabel: "Idiomas",
    languagesPlaceholder: "Ej.: Español, Inglés",
    interestsLabel: "Intereses",
    interestsPlaceholder: "Ej.: comida, mudanzas, trabajo",
    listHelp: "Separá con comas.",
    ageLabel: "Edad",
    ageFrom: "Desde",
    ageTo: "Hasta",
    ageError: "Revisá las edades: la mínima no puede ser mayor que la máxima.",

    saveDraft: "Guardar borrador",
    submit: "Enviar a revisión",
    submitHelp:
      "Un borrador lo podés editar todo lo que quieras. Cuando lo mandás a revisión, el presupuesto y la duración se congelan.",

    savedTitle: "Guardamos tu campaña",
    savedBody: "Queda como borrador. Podés seguir editándola cuando quieras.",
    sentTitle: "Tu campaña está en revisión",
    sentBody:
      "El equipo de tu comunidad la revisa y te avisamos por acá. Mientras tanto, el presupuesto y la duración quedan fijos.",

    statusLabel: {
      draft: "Borrador",
      pending_review: "En revisión",
      active: "Activa",
      paused: "En pausa",
      finished: "Terminada",
      rejected: "No aprobada",
    } as Record<string, string>,

    existingTitle: "Tu campaña",
    emptyTitle: "Todavía no tenés una campaña para este aviso",
    rejectedNote: (note: string) => `El equipo dejó esta nota: ${note}`,
  },

  // -------------------------------------------------------------------------
  // Estadísticas
  // -------------------------------------------------------------------------
  stats: {
    title: "Estadísticas de tu aviso",
    subtitleFree: "Esto es lo que pasó con tu aviso.",
    subtitlePremium: "Todo lo que pasó con tu aviso, botón por botón.",
    since: (days: number) => `Últimos ${days} días`,

    views: "Vistas",
    likes: "Me gusta",
    comments: "Comentarios",
    shares: "Compartidos",
    chats: "Chats recibidos",
    reach: "Alcance",
    reachHelp: "Cuánta gente distinta vio tu aviso.",

    ctaSectionTitle: "Clics por botón",
    ctaEmpty: "Todavía nadie tocó tus botones. Con el tiempo van a aparecer acá.",
    promoSectionTitle: "Resultados de tus promociones",
    promoEmpty: "Todavía no promocionaste este aviso.",
    promoBoost: (days: number) => `Impulso de ${days} días`,
    promoCampaign: "Campaña",

    lockedTitle: "Con premium ves también",
    lockedPoints: [
      "Cuántos tocaron cada botón de acción",
      "Alcance: cuánta gente distinta vio tu aviso",
      "Resultados de tus impulsos y campañas",
    ],
    lockedCta: "Ver qué incluye premium",
    /** El panel gratuito muestra sus números completos; esto sólo los acompaña. */
    lockedNote: "Tus números de arriba son tuyos siempre, con premium o sin premium.",

    emptyTitle: "Todavía no hay números",
    emptyBody:
      "Apenas la comunidad empiece a ver tu aviso, las estadísticas aparecen acá.",
  },

  // -------------------------------------------------------------------------
  // Vista previa y pantalla de éxito
  // -------------------------------------------------------------------------
  preview: {
    title: "Así te va a quedar",
    help: "Revisá que esté todo bien antes de publicar.",
    edit: "Editar",
    publish: "Publicar aviso",
    photosNone: "Sin fotos",
    photoCount: (n: number) => `${n} ${n === 1 ? "foto" : "fotos"}`,
  },

  success: {
    boostCta: "Impulsar este aviso",
    boostHint: "Que aparezca primero en los resultados.",
    campaignCta: "Crear una campaña",
    campaignHint: "Con objetivo, presupuesto y duración.",
    viewCta: "Ver mi aviso",
    laterNote: "También podés hacerlo más adelante desde tu aviso.",
  },
} as const;
