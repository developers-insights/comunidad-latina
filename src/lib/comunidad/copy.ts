import type {
  HelpStatus,
  HelpTopic,
  LostFoundCategory,
  LostFoundType,
  PlaceType,
  RegistrationKind,
  RegistrationStatus,
  RequesterType,
  ResourceTopic,
  SpaceActivity,
  VolunteerAvailability,
  VolunteerSkill,
} from "./types";

/**
 * =============================================================================
 * COPY DEL MÓDULO COMUNIDAD
 * =============================================================================
 *
 * Español rioplatense neutro, voseo, frases cortas. Quien entra acá puede estar
 * asustado —alguien lo paró en la calle, no tiene seguro, no llegó a fin de
 * mes— así que el tono es el de un vecino que sabe dónde queda la oficina: ni
 * institucional ni condescendiente. La vara la fija
 * `src/lib/integrity/declarations.ts`.
 *
 * ── LA LÍNEA QUE NO SE CRUZA ────────────────────────────────────────────────
 * En este archivo NO hay una sola frase que le diga a alguien qué hacer ante
 * migración, ante un problema de salud o ante un trámite. Ni una. Todo lo que
 * suena a instrucción viene de una fuente citada y se lee EN la fuente.
 *
 * Cuando escribas copy nuevo acá, el test es simple: si la frase, leída sola,
 * pudiera entenderse como "Comunidad Latina me dijo que hiciera esto", está
 * mal. Reescribila hasta que se entienda como "esto lo dice tal organismo, acá
 * está el enlace".
 *
 * Por eso los avisos de abajo no son letra chica ni un modal de términos: son
 * texto de la pantalla, arriba, donde se lee. Un descargo que hay que ir a
 * buscar es un descargo que nadie leyó.
 */

export const COMUNIDAD_COPY = {
  // -------------------------------------------------------------------------
  // Índice del módulo
  // -------------------------------------------------------------------------
  index: {
    title: "Comunidad",
    subtitle: "Información útil y una mano cuando hace falta.",
    intro:
      "Acá reunimos lo que la comunidad necesita tener a mano: pedirle un dato a los vecinos, dónde conseguir comida, quién perdió o encontró algo cerca tuyo, y los lugares que ayudan en el barrio.",
    /**
     * Grilla de categorías (rediseño 2026-08-13, pedido textual del cliente:
     * «mantener los cuadrados iguales en la parte de búsqueda, pero en la
     * sección de comunidad»). Cada `title` es lo único que se LEE en el
     * cuadrado —mismo trato que "Vivienda" o "Marketplace" en /buscar, un
     * sustantivo corto bajo un ícono— así que acá viven acortados; el nombre
     * largo de cada sección sigue intacto como título de SU propia pantalla
     * (`recursos.title`, `guias.title`, `perdidos.title` más abajo).
     *
     * `hint` NO se ve: entra como texto accesible extra del link (screen
     * reader), porque "Guías" o "Voluntarios" solos no siempre alcanzan para
     * decidir si tocar sin abrir la pantalla — se pierde ESE contexto, no la
     * lectura visual, que tiene que quedar igual de limpia que la de /buscar.
     */
    cards: {
      /**
       * "Pedir ayuda" ahora es el TABLÓN, no el directorio. El cliente lo pidió
       * el 2026-09-03 con esa frase: «la gente pone lo que necesita y la gente
       * le contesta». El directorio («Dónde pedir ayuda», fichas curadas con
       * fuente) sigue existiendo y se sigue llegando a él desde las tarjetas de
       * tema (Bancos de comida, Voluntarios, Centro de acopio) y desde Guías.
       */
      pedirAyuda: {
        title: "Pedir ayuda",
        hint: "Contá lo que necesitás y la comunidad te responde: un dato, un contacto, una mano.",
      },
      guias: {
        title: "Guías",
        hint: "Trámites explicados paso a paso, con el enlace a la fuente oficial.",
      },
      perdidos: {
        title: "Perdido y encontrado",
        hint: "Buscá por zona lo que se te perdió, o avisá si encontraste algo.",
      },
      comida: {
        title: "Bancos de comida",
        hint: "Comedores y despensas gratuitas o a bajo costo cerca tuyo.",
      },
      voluntarios: {
        title: "Voluntarios",
        hint: "Organizaciones que reciben manos voluntarias para su trabajo comunitario.",
      },
      acopio: {
        title: "Centro de acopio",
        hint: "Dejá tu donación de ropa, comida o insumos de emergencia: no es para recibir comida, es para darla.",
      },
      /**
       * Séptima tarjeta (0131). El cliente la pidió el 2026-09-03 sabiendo que
       * arranca vacía: «al principio no se van a registrar, pero por lo menos ya
       * tenemos el botón». Por eso NO lleva a un listado —no habría nada— sino a
       * una pantalla que explica de qué se trata y ofrece el formulario.
       */
      espacio: {
        title: "Espacio comunitario",
        hint: "Negocios que prestan una parte de su local para clases, talleres o charlas del barrio.",
      },
    },
  },

  /**
   * El aviso de procedencia. Va en el índice, arriba de los recursos y arriba
   * de las guías: las tres pantallas donde alguien podría confundir "lo leí en
   * la app" con "me lo dijo la app".
   */
  disclaimer: {
    title: "De dónde sale esta información",
    body:
      "Todo lo que ves acá lo publican organismos oficiales y organizaciones que ayudan a la comunidad. Nosotros lo reunimos en un solo lugar, te decimos quién lo dice y cuándo lo revisamos por última vez.",
    notAdvice:
      "Comunidad Latina no presta estos servicios ni da asesoramiento legal o médico. Antes de moverte, confirmá con la fuente: los horarios, los requisitos y los teléfonos cambian.",
    /** Específico de migración: el tema donde el error se paga más caro. */
    migration:
      "Sobre migración no vas a leer consejos nuestros. Vas a encontrar el enlace a quien tiene la información de primera mano, para que leas ahí lo que corresponde a tu caso.",
  },

  // -------------------------------------------------------------------------
  // Recursos
  // -------------------------------------------------------------------------
  recursos: {
    title: "Dónde pedir ayuda",
    subtitle: "Organizado por tema, con la fuente de cada dato.",
    sourceLabel: "Lo publica",
    checkedLabel: (fecha: string) => `Lo revisamos el ${fecha}`,
    openSource: "Ver la publicación original",
    contact: {
      call: "Llamar",
      website: "Sitio web",
      directions: "Cómo llegar",
      hours: "Horarios",
      cost: "Costo",
      requirements: "Qué piden",
      languages: "Atienden en",
    },
    emptyTitle: "Todavía no hay recursos cargados",
    emptyMessage:
      "Estamos armando el directorio de tu comunidad. Mientras tanto, las guías tienen los enlaces oficiales de cada trámite.",
    emptyAction: "Ver las guías",
    /**
     * Vacío de UN tema filtrado (`?tema=`, ver recursos/page.tsx) — distinto
     * del vacío de arriba, que es "no hay nada en todo el directorio". Acá
     * puede haber decenas de fichas en otros temas y cero en éste, así que el
     * mensaje no puede sonar a que la sección entera está vacía. Sólo los
     * tres temas con entrada propia en la grilla (comida, voluntariado,
     * acopio) necesitan el suyo: el resto de los temas se navegan desde la
     * lista completa, que ya resuelve su propio vacío con
     * `emptyTitle`/`emptyMessage`.
     */
    emptyTopic: {
      /**
       * Reescritos con la 0131. Antes los tres decían «estamos armando el
       * directorio» y ahí terminaba: un cartel de obra sin nada para hacer. Ya
       * existen los formularios, así que el vacío invita a llenarlo — y sin
       * prometer nada, porque quien registra un lugar no queda publicado por
       * registrarse: lo revisa el equipo (por eso «lo revisamos» y nunca «lo
       * publicamos»).
       */
      comida: {
        title: "Todavía no hay bancos de comida cargados",
        message:
          "Estamos sumando comedores y despensas del barrio. Si tenés uno o sabés de alguno, registralo y lo revisamos.",
      },
      voluntariado: {
        title: "Todavía no hay grupos de voluntarios cargados",
        message:
          "Podés anotarte como voluntario o pedir voluntarios para algo de la comunidad. Las dos cosas las mira el equipo, no se publican.",
      },
      acopio: {
        title: "Todavía no hay centros de acopio cargados",
        message:
          "Si tu negocio recibe donaciones —ropa, comida, insumos—, registralo y lo revisamos para sumarlo acá.",
      },
    },
    /** Vuelve a la lista completa — visible con y sin resultados en el tema. */
    allTopicsCta: "Ver toda la ayuda disponible",
  },

  // -------------------------------------------------------------------------
  // Guías (contenido de `public.guides`, leído desde acá)
  // -------------------------------------------------------------------------
  guias: {
    title: "Guías para los trámites",
    subtitle: "Escritas para leer tranquilo, con las fuentes citadas.",
    readingTime: (minutos: number) => `${minutos} min de lectura`,
    sourcesTitle: "Fuentes oficiales",
    checked: (fecha: string) => `consultada el ${fecha}`,
    updated: (fecha: string) => `Actualizada el ${fecha}`,
    back: "Volver a las guías",
    emptyTitle: "Todavía no hay guías publicadas",
    emptyMessage:
      "Cuando publiquemos la primera, la vas a ver acá. Si hay un trámite que te está costando, contanos en el feed y la escribimos.",
  },

  // -------------------------------------------------------------------------
  // Perdido y encontrado
  // -------------------------------------------------------------------------
  perdidos: {
    title: "Perdido y encontrado",
    subtitle: "Se busca y se avisa por zona.",
    publishTitle: "Publicá tu caso",
    publishHint: "Perdiste algo o encontraste algo: contalo acá y que lo vea el barrio.",
    filters: {
      areaLabel: "Zona",
      areaPlaceholder: "Ej.: Jackson Heights, Queens",
      areaHelp: "Escribí el barrio o la parada donde creés que pasó.",
      typeLabel: "Qué estás mirando",
      all: "Todo",
      lost: "Se perdió",
      found: "Se encontró",
      categoryLabel: "Tipo de cosa",
      allCategories: "Todas",
      apply: "Buscar",
      clear: "Limpiar filtros",
    },
    card: {
      lostBadge: "Se perdió",
      foundBadge: "Se encontró",
      resolvedBadge: "Ya apareció",
      happenedOn: (fecha: string) => `Pasó el ${fecha}`,
      noArea: "Sin zona indicada",
      openCase: "Ver el caso",
    },
    detail: {
      contactTitle: "¿Es tuyo? ¿Lo viste?",
      contactHint:
        "Escribile por mensaje privado a quien publicó. No pongas tus datos en un comentario público.",
      contactCta: "Enviar un mensaje",
      resolvedTitle: "Este caso ya se resolvió",
      resolvedBody: "Quien lo publicó avisó que apareció. Lo dejamos visible para que nadie siga buscando.",
      photosLabel: "Fotos del caso",
      reportHint: "¿Algo no cierra? Reportalo y lo miramos.",
    },
    resolve: {
      markCta: "Ya apareció",
      markHint: "Cuando lo marques, dejamos de mostrarlo como caso abierto.",
      undoCta: "Volver a abrir el caso",
      markedOk: "Listo, lo marcamos como resuelto.",
      reopenedOk: "Listo, el caso vuelve a estar abierto.",
      failed: "No pudimos marcarlo. Probá de nuevo en un momento.",
    },
    empty: {
      title: "Todavía no hay casos por acá",
      message:
        "Nadie publicó nada en esta zona. Si perdiste o encontraste algo, publicalo vos: así arranca.",
      filteredTitle: "No encontramos casos con esos filtros",
      filteredMessage:
        "Probá con una zona más amplia o sacá alguno de los filtros. A veces se publica con el nombre del barrio de al lado.",
      cta: "Publicar un caso",
    },
    /** Aviso de privacidad del propio módulo, no del contenido de terceros. */
    privacyNote:
      "Publicá lo justo para reconocer la cosa: sin número de documento, sin dirección exacta, sin datos que sirvan para hacerse pasar por vos.",
  },

  // -------------------------------------------------------------------------
  // Publicar un caso
  // -------------------------------------------------------------------------
  publicar: {
    title: "Publicá tu caso",
    subtitle: "Son tres pasos y toma un minuto.",
    steps: {
      what: {
        title: "¿Qué pasó?",
        typeLabel: "Elegí una",
        lost: "Perdí algo",
        found: "Encontré algo",
        categoryLabel: "¿Qué es?",
        titleLabel: "Contalo en una línea",
        titlePlaceholder: "Ej.: Mochila azul con cuadernos",
        titleHelp: "Lo que se lee primero en la lista.",
        descriptionLabel: "Los detalles",
        descriptionPlaceholderLost:
          "¿Cómo es? ¿Tiene alguna marca o algo adentro que lo distinga? ¿En qué momento del día fue?",
        descriptionPlaceholderFound:
          "¿Cómo es? ¿Dónde lo tenés guardado ahora? Guardate un detalle sin contar, así podés confirmar que es de quien dice.",
        descriptionHelp:
          "Si encontraste algo, no cuentes todo: guardarte un detalle es lo que te deja confirmar que sos el dueño.",
      },
      where: {
        title: "¿Dónde y cuándo?",
        areaLabel: "Zona",
        areaPlaceholder: "Ej.: Jackson Heights, Queens",
        areaHelp: "Un barrio o una parada alcanza. Nunca pongas tu dirección.",
        dateLabel: "¿Qué día fue?",
        dateHelp: "Si no te acordás exacto, poné el más cercano.",
      },
      photos: {
        title: "Una foto ayuda muchísimo",
        hint: "Podés subir hasta 4. Si encontraste algo, mostralo sin que se lean los datos personales que tenga.",
        add: "Agregar foto",
        remove: "Sacar esta foto",
        tooBig: "Esa foto es muy pesada. Probá con otra o sacale una nueva.",
      },
    },
    submit: "Publicar el caso",
    submitting: "Publicando…",
    back: "Atrás",
    next: "Seguir",
    donePublished: {
      title: "Listo, ya está publicado",
      body: "Tu caso ya se ve en la sección. Cuando aparezca, marcalo como resuelto para que nadie siga buscando.",
    },
    donePending: {
      title: "Lo estamos revisando",
      body: "Es un paso normal y suele ser rápido. Apenas pase la revisión, aparece en la sección.",
    },
    seeSection: "Ir a Perdido y encontrado",
    publishAnother: "Publicar otro caso",
    needLogin: "Entrá a tu cuenta para publicar",
    errors: {
      generic: "No pudimos publicarlo. Revisá los datos y probá de nuevo.",
      title: "Contanos en una línea qué pasó (al menos 6 letras).",
      description: "Escribí un poco más de detalle: con 20 letras alcanza para empezar.",
      area: "Necesitamos la zona, aunque sea el barrio.",
      date: "Esa fecha no nos cierra. Poné un día de los últimos dos años.",
      upload: "No pudimos subir la foto. Probá de nuevo o publicá sin foto.",
      auth: "Se cerró tu sesión. Entrá de nuevo y no perdés lo que escribiste.",
    },
  },

  // -------------------------------------------------------------------------
  // Ayuda mutua — el tablón de las dos direcciones (0120)
  //
  // ── LAS DOS REGLAS DURAS, ESCRITAS COMO HABLA UNA PERSONA ─────────────────
  // Este módulo tiene dos cosas que NO se pueden hacer, y las dos son de
  // seguridad, no de trámite: acá no se mueve plata y acá no se dejan datos de
  // contacto. Las dos están escritas como se lo diría un vecino a otro, van
  // ARRIBA de la pantalla del alta —donde se leen antes de escribir, no
  // después de mandar— y ninguna arranca con "el usuario acepta".
  //
  // Un aviso legal que hay que ir a buscar es un aviso legal que nadie leyó;
  // uno que da miedo es uno que espanta a quien venía a ayudar. La vara es que
  // se entienda de una lectura y que suene a cuidado, no a advertencia.
  // -------------------------------------------------------------------------
  /**
   * -------------------------------------------------------------------------
   * PEDIR AYUDA — el tablón donde la gente pide y la comunidad contesta
   * -------------------------------------------------------------------------
   *
   * Antes esta clave se llamaba `ayudaMutua` y el módulo era otra cosa: gente
   * ofreciéndose a dar una mano. El 2026-09-03 el cliente lo reencuadró con una
   * frase: «tiene que ser como un blog: la gente pone lo que necesita y la
   * gente le contesta; hay mucha gente que tiene información y mucha que no».
   *
   * El tono de esta sección es el más delicado del módulo. Quien escribe un
   * pedido está admitiendo en público que le falta algo —un turno, una silla de
   * ruedas, una computadora para sus hijos— y eso cuesta. Nada de lo que se lee
   * acá puede sonar a formulario ni a trámite: se escribe como se le habla a un
   * vecino que se acercó a preguntar.
   */
  pedirAyuda: {
    title: "Pedir ayuda",
    subtitle: "Contá lo que necesitás y la comunidad te responde.",
    intro:
      "Acá se pregunta y se contesta. Alguien sabe dónde dan turnos, quién presta una silla de ruedas o dónde hay una clase gratis, y esa información no está en ningún lado: la tiene una persona del barrio. Escribí lo tuyo y fijate lo que están pidiendo los demás.",

    /**
     * Las tres cosas que hay que saber antes de usar la sección. Van ARRIBA y
     * en el tamaño del resto del texto: un descargo que hay que ir a buscar es
     * un descargo que nadie leyó, y uno que aparece después de mandar el
     * formulario llega tarde para lo único que importa.
     *
     * La tercera es la que el producto necesita que se lea de verdad: quien
     * contesta es un vecino y la plataforma no verifica lo que dice. Está
     * escrita sin asustar y sin desalentar la respuesta, porque el valor de
     * toda la sección es que la gente conteste.
     */
    reglas: {
      informacion: {
        title: "Acá se comparte información",
        body:
          "Un dato, un contacto, una orientación: dónde preguntar, qué papeles llevar, quién puede dar una mano. No es para pedir gente que trabaje ni para mover plata.",
      },
      datos: {
        title: "No dejes tus datos en el pedido",
        body:
          "Ni teléfono, ni correo, ni tu dirección. Si alguien tiene que pasarte algo privado, te escribe por mensaje desde la app.",
      },
      responden: {
        title: "Quien te contesta es un vecino",
        body:
          "Las respuestas las escribe gente de la comunidad, no Comunidad Latina. Antes de moverte, confirmá el dato con la oficina o el lugar: los horarios y los requisitos cambian.",
      },
    },

    filtros: {
      temaLabel: "Tema",
      todosLosTemas: "Todos",
      zonaLabel: "Zona",
      zonaPlaceholder: "Ej.: Jackson Heights, Queens",
      zonaHelp: "Escribí el barrio o la parada más cercana.",
      buscarLabel: "Buscar",
      buscarPlaceholder: "Ej.: silla de ruedas, turno, clases de inglés",
    },

    card: {
      /** Nunca "0 respuestas": si no hay ninguna, la tarjeta invita en vez de contar. */
      respuestas: (cantidad: number) =>
        cantidad === 1 ? "1 respuesta" : `${cantidad} respuestas`,
      sinRespuestas: "Todavía nadie contestó",
      resuelto: "Resuelto",
      escribir: "Escribirle",
      escribirHint: "Se abre un mensaje privado. Tus datos no se publican.",
      escribirErrores: {
        generic: "No pudimos abrir el mensaje. Probá de nuevo en un momento.",
        noDisponible: "Ese pedido ya no está disponible.",
        propio: "Este pedido es tuyo.",
        bloqueado: "No podés escribirle a esta persona.",
      },
    },

    detalle: {
      noEncontrado: {
        title: "Ese pedido ya no está",
        message:
          "Puede que su autor lo haya dado de baja porque ya resolvió lo que necesitaba. Mirá los que están abiertos ahora.",
        cta: "Ver los pedidos",
      },
    },

    /** Lo nuevo de la 0130: la conversación pública abajo del pedido. */
    respuestas: {
      title: "Respuestas",
      vacioTitle: "Todavía nadie contestó",
      vacioMessage:
        "Si sabés algo que sirva —un lugar, un horario, a quién preguntarle— contalo acá abajo. Un dato tuyo le puede ahorrar semanas a alguien.",
      escribirLabel: "Tu respuesta",
      escribirPlaceholder: "Contá lo que sepas: dónde, cuándo, a quién preguntar.",
      escribirHelp:
        "Podés pasar el teléfono o la dirección de una oficina o de un lugar. Tus datos personales, no.",
      enviar: "Responder",
      enviando: "Publicando…",
      borrar: "Borrar",
      borrada: "Borraste esta respuesta.",
      oculta: "El equipo ocultó esta respuesta.",
      autorDelPedido: "Escribió el pedido",
      confirmarBorrado: "¿La borramos?",
      hecho: {
        publicada: "Listo, ya está publicada.",
        borrada: "Listo, la borramos.",
      },
      sinSesion: {
        title: "Entrá para responder",
        message:
          "Con tu cuenta podés contestar y también escribir tus propios pedidos.",
        cta: "Entrar a mi cuenta",
      },
      errors: {
        generic: "No pudimos publicar tu respuesta. Probá de nuevo en un momento.",
        vacia: "Escribí algo, aunque sea corto.",
        larga: "Es muy largo para una respuesta. Contalo en menos palabras.",
        noDisponible: "Ese pedido ya no está abierto, así que no se puede responder.",
        bloqueado: "No podés responder a esta persona.",
        moderacion:
          "Eso no lo podemos publicar tal como está. Contalo con otras palabras — lo que escribiste no se perdió.",
        cupo: "Respondiste bastante por hoy. Mañana seguís.",
        suspendida: "Tu cuenta está pausada y por ahora no puede responder.",
        borrar: "No pudimos borrarla. Recargá la página e intentá de nuevo.",
      },
      reportar: {
        cta: "Reportar",
        /** Motivos propios: los genéricos hablan de estafas y acá el problema suele ser otro. */
        motivos: [
          "Está pidiendo plata",
          "El dato es falso o engañoso",
          "Está ofreciendo un servicio, no ayudando",
          "Trata mal a la persona que pidió",
          "Otra cosa",
        ],
        contexto: (titulo: string) => `Respuesta en el pedido: ${titulo}`,
      },
    },

    publicarCta: "Escribir un pedido",
    misPedidosCta: "Mis pedidos",
    verTodos: "Ver todos los pedidos",
    /** El puente desde el directorio de recursos hacia el tablón (`<PreguntarleALaComunidad>`). */
    desdeRecursos: "Preguntarle a la comunidad",

    vacio: {
      title: "Todavía no hay pedidos por acá",
      message:
        "Nadie escribió nada en esta comunidad. Si te falta un dato o una mano, empezá vos: el primer pedido es el que arranca todo.",
      filtradoTitle: "No encontramos pedidos con esa búsqueda",
      filtradoMessage:
        "Probá con otras palabras, con una zona más amplia o mirá todos los temas.",
    },

    /** "Mis pedidos": el estado de cada uno y el botón de marcarlo resuelto. */
    mios: {
      title: "Mis pedidos",
      subtitle: "En qué anda cada uno de los que escribiste.",
      vacioTitle: "Todavía no escribiste ninguno",
      vacioMessage:
        "Cuando pidas algo, vas a poder seguirlo desde acá y ver quién te respondió.",
      rechazoTitle: "Por qué lo ocultamos",
      verRespuestas: (cantidad: number) =>
        cantidad === 1 ? "Ver 1 respuesta" : `Ver ${cantidad} respuestas`,
      verPedido: "Ver el pedido",
      resolver: "Ya lo resolví",
      resolverHint: "Se saca de la lista. Usalo cuando ya conseguiste lo que necesitabas.",
      confirmarResuelto: "¿Lo damos por resuelto?",
      hecho: {
        resuelto: "Listo. Nos alegra que lo hayas resuelto.",
      },
    },

    /** Los cinco estados, en voz de quien escribió el pedido. */
    estado: {
      draft: "Sin publicar",
      pending: "Lo estamos revisando",
      approved: "Publicado",
      rejected: "Oculto por el equipo",
      archived: "Resuelto",
    },
    estadoHint: {
      draft: "Quedó de antes y nunca se publicó. Podés darlo de baja y escribir uno nuevo.",
      pending: "Quedó de antes, en la cola del equipo. En breve lo resolvemos.",
      approved: "Se ve en el tablón de tu comunidad y te pueden responder.",
      rejected: "Leé el motivo. Si querés, escribí uno nuevo con eso corregido.",
      archived: "Ya no se ve en el tablón.",
    },
  },

  // -------------------------------------------------------------------------
  // Escribir un pedido
  // -------------------------------------------------------------------------
  escribirPedido: {
    title: "Escribir un pedido",
    subtitle: "Cuatro campos y listo. Se publica al toque.",
    campos: {
      temaLabel: "¿De qué se trata?",
      temaHelp: "Elegí el que más se parezca. Después lo contás con tus palabras.",
      tituloLabel: "Resumilo en una línea",
      tituloPlaceholder: "Ej.: ¿Alguien sabe dónde dan turnos para el pasaporte?",
      tituloHelp: "Es lo que se lee primero en la lista.",
      detalleLabel: "Contalo un poco más",
      detallePlaceholder:
        "¿Qué necesitás exactamente? ¿Ya probaste algo? Todo lo que cuentes ayuda a que te respondan bien.",
      detalleHelp: "Sin teléfono ni dirección: si hace falta, te escriben por mensaje.",
      zonaLabel: "Zona",
      zonaPlaceholder: "Ej.: Corona, Queens",
      zonaHelp: "Un barrio o una parada alcanza. Nunca pongas tu dirección.",
    },
    submit: "Publicar el pedido",
    submitting: "Publicando…",
    needLogin: "Entrá a tu cuenta para pedir",
    needLoginHint:
      "Pedir ayuda necesita tu cuenta: así quien tenga el dato te puede escribir sin que dejes tu teléfono a la vista.",
    done: {
      title: "Listo, ya está publicado",
      body:
        "Tu pedido se ve en el tablón de tu comunidad. Cuando alguien te responda, te avisamos.",
      verPedido: "Ver mi pedido",
      verTablon: "Ver todos los pedidos",
    },
    /**
     * Mirar el tablón pide cuenta, y no por capricho: la 0120 no le da SELECT a
     * `anon` porque un listado abierto de nombre + barrio + "necesito ayuda con
     * X" es un padrón de gente vulnerable. Pero eso hay que DECIRLO — antes,
     * quien entraba sin sesión veía un cartel rojo de error y se iba pensando
     * que la sección estaba rota.
     */
    sinSesion: {
      title: "Entrá para ver los pedidos",
      message:
        "Los pedidos no son públicos: se ven con tu cuenta. Así, quien pide algo no queda listado en internet para cualquiera.",
      cta: "Entrar a mi cuenta",
    },
    errors: {
      /** Falla de LECTURA, no de envío: esta pantalla no envía nada. */
      leer: "No pudimos cargar los pedidos. No es algo que hayas hecho vos: probá recargar en un momento.",
      generic: "No pudimos publicarlo. Revisá los datos y probá de nuevo.",
      title: "Resumilo en una línea (al menos 6 letras).",
      body: "Contá un poco más: con 20 letras alcanza para arrancar.",
      area: "Necesitamos la zona, aunque sea el barrio.",
      resource: "Ese lugar ya no está disponible en este tema. Elegí otro o dejalo en blanco.",
      /**
       * Los tres del detector de contacto. Cada uno dice QUÉ sacar y —lo
       * importante— POR QUÉ conviene sacarlo: sin el motivo se lee como una
       * traba caprichosa y la persona lo intenta otra vez con el número escrito
       * distinto.
       *
       * Ojo: este detector corre sobre el PEDIDO, nunca sobre las respuestas.
       * Ahí el teléfono suele ser el de una oficina, y publicarlo es justamente
       * el producto.
       */
      telefono:
        "Sacá el teléfono del texto. No hace falta: quien tenga el dato te escribe por mensaje privado desde la app, y así tu número no queda publicado.",
      email:
        "Sacá el correo del texto. Te van a escribir por mensaje privado desde acá, sin que tengas que dejar tus datos.",
      enlace:
        "Sacá el enlace. Los grupos y las páginas de afuera no se publican en esta sección: la conversación arranca por mensaje privado, donde podés reportar si algo no cierra.",
      cupo:
        "Ya tenés 5 pedidos abiertos. Marcá como resuelto alguno de los que ya conseguiste y vas a poder escribir otro.",
      moderacion:
        "Ese texto no lo podemos publicar tal como está. Contalo con otras palabras y volvé a intentar — lo que escribiste no se perdió.",
      estado: "Ese pedido ya no está en ese estado. Recargá la página y fijate cómo quedó.",
      suspendida: "Tu cuenta está pausada y por ahora no puede publicar.",
      auth: "Se cerró tu sesión. Entrá de nuevo y no perdés lo que escribiste.",
    },
  },

  // -------------------------------------------------------------------------
  // Registros privados (0131) — los cuatro formularios que NO publican nada
  //
  // Todo el copy de esta sección tiene que hacer una sola cosa bien: que quien
  // deja su teléfono entienda ANTES de dejarlo qué va a pasar con él. El
  // cliente lo dijo de la lista de voluntarios («esa lista no la ve nadie») y
  // vale para los cuatro. Por eso la promesa aparece tres veces —arriba, al
  // lado del campo de contacto y en la confirmación— y las tres veces dice lo
  // mismo con las mismas palabras.
  // -------------------------------------------------------------------------
  registros: {
    /**
     * La frase que se repite. Está escrita una sola vez a propósito: si
     * cambiara en un lugar y no en los otros dos, la promesa dejaría de ser una
     * promesa y pasaría a ser tres frases parecidas.
     */
    noSePublica: "Esto no se publica. Lo ve el equipo de Comunidad Latina y te contactamos.",

    campos: {
      contactoTitulo: "¿Cómo te contactamos?",
      contactoAyuda: "Con uno alcanza. Elegí el que uses.",
      telefonoLabel: "Teléfono",
      telefonoPlaceholder: "(917) 555-0134",
      emailLabel: "Correo",
      emailPlaceholder: "nombre@correo.com",
      zonaLabel: "Zona",
      zonaHelp: "El barrio, para saber qué te queda cerca.",
      zonaPlaceholder: "Corona, Queens",
    },

    errores: {
      nombre: "Escribí un nombre, aunque sea corto.",
      zona: "Decinos en qué barrio o zona, así sabemos qué te queda cerca.",
      detalle: "Contanos un poco más: con una línea alcanza.",
      contacto: "Dejá un teléfono o un correo para que te podamos contestar.",
      email: "Ese correo no parece completo. Fijate que tenga arroba y punto.",
      reglas: "Marcá que leíste las reglas para poder anotarte.",
      chips: "Elegí al menos una opción.",
      direccion: "Escribí la dirección completa, con calle y número.",
      horarios: "Decinos los días y horarios, aunque sea aproximados.",
      cuando: "Decinos cuándo lo necesitás.",
      personas: "Escribí cuántas personas necesitás, aunque sea un número aproximado.",
      capacidad: "Escribí cuánta gente entra, aunque sea a ojo.",
      abierto:
        "Ya tenemos un registro tuyo esperando respuesta. Te vamos a escribir; si te equivocaste en algo, retiralo y mandalo de nuevo.",
      generic: "No pudimos guardarlo — no es tu culpa. Probá de nuevo en un momento.",
      suspendida: "Tu cuenta está pausada y por ahora no puede registrarse.",
      auth: "Se cerró tu sesión. Entrá de nuevo y no perdés lo que escribiste.",
      retirar: "No pudimos retirar tus datos. Probá de nuevo en un momento.",
    },

    /** El estado "ya te registraste", compartido por los cuatro formularios. */
    abierto: {
      title: "Ya tenemos tus datos",
      body: "Te vamos a escribir. Mientras tanto no tenés que hacer nada.",
      retirar: "Retirar mis datos",
      retirando: "Retirando…",
      retirado: "Listo, borramos lo que habías dejado. Si querés, podés volver a anotarte cuando quieras.",
    },

    needLogin: "Entrá para registrarte",
    needLoginHint:
      "Pedimos cuenta por una sola razón: para poder escribirte después, y para que nadie deje los datos de otra persona.",

    // ---- 1 · Me anoto de voluntario ---------------------------------------
    voluntario: {
      title: "Anotarme como voluntario",
      subtitle: "Dejanos tus datos y te avisamos cuando haga falta una mano cerca tuyo.",
      /**
       * Los tres pasos ANTES del formulario. La estructura sale de una
       * referencia real: la pantalla "Steps to enroll" de Visible
       * (https://mobbin.com/screens/2159d2bd-343b-46d2-9668-648ae3f5a453), que
       * antes de pedir un solo dato dice en tres líneas con ícono qué va a
       * pasar. Es la respuesta exacta a la duda del cliente («esa lista no la ve
       * nadie»): en vez de prometerlo en letra chica, se cuenta el flujo.
       */
      pasos: [
        "Tus datos no se publican. Los ve el equipo de Comunidad Latina y nadie más.",
        "Cuando alguien de tu zona necesita voluntarios, revisamos que sea voluntariado de verdad y recién ahí te escribimos.",
        "Vos decidís cada vez. Anotarte no te compromete a nada.",
      ],
      nombreLabel: "Tu nombre",
      nombrePlaceholder: "Como querés que te llamemos",
      habilidadesLabel: "¿En qué podés dar una mano?",
      habilidadesHelp: "Elegí lo que te salga bien. Podés marcar varias.",
      disponibilidadLabel: "¿Cuándo podés?",
      disponibilidadHelp: "Sin compromiso: es para no escribirte a cualquier hora.",
      detalleLabel: "Contanos algo más",
      detalleHelp: "Un oficio, un idioma, si tenés auto. Lo que creas que suma.",
      detallePlaceholder:
        "Hablo español e inglés y tengo auto. Los sábados a la mañana estoy libre.",
      /**
       * Las reglas VISIBLES arriba del checkbox, no detrás de un enlace.
       * Referencia: la pantalla de comunidad de Lex
       * (https://mobbin.com/screens/64fda9f4-e87b-4d27-b2a9-006414b4759c), que
       * lista las reglas en la página y pone UNA sola casilla debajo. Es lo que
       * pidió el cliente («el voluntario acepta una regla corta para que no haya
       * compromiso con Comunidad Latina») y es la misma doctrina que
       * `<ReglasDeAyuda>`: un descargo que hay que ir a buscar es un descargo
       * que nadie leyó.
       */
      reglasTitle: "Antes de anotarte",
      reglas: [
        "Ser voluntario es dar una mano: sin cobrar y sin obligación.",
        "Comunidad Latina te pone en contacto. No es tu empleador ni te representa.",
        "Si algo no te cierra, decís que no y listo.",
      ],
      reglasCheck: "Leí estas tres cosas y estoy de acuerdo.",
      submit: "Anotarme",
      submitting: "Anotándote…",
      done: {
        title: "Listo, quedaste anotado",
        body: "Te vamos a escribir cuando haya algo cerca tuyo. Tus datos no se publican en ningún lado.",
      },
      abiertoBody:
        "Ya estás anotado como voluntario. Te escribimos cuando aparezca algo en tu zona.",
    },

    // ---- 2 · Necesito voluntarios ------------------------------------------
    pedirVoluntarios: {
      title: "Necesito voluntarios",
      subtitle: "Contanos qué necesitás y buscamos gente de la zona.",
      /**
       * La línea que el cliente pidió con todas las letras (45:40–47:50): «no va
       * a pedir voluntarios para poner el sheetrock del baño». Va ARRIBA y sin
       * rodeos — quien viene a pedir mano de obra gratis tiene que enterarse
       * antes de escribir, no después de que no le contestemos.
       */
      aviso:
        "Antes de avisarle a nadie revisamos de qué se trata. Voluntariado es dar una mano a la comunidad: si es un trabajo, va en Empleos.",
      quienLabel: "¿Quién lo pide?",
      quienHelp: "No hace falta ser una organización.",
      nombreLabel: "Tu nombre",
      nombrePlaceholder: "Quién organiza esto",
      orgLabel: "Nombre del grupo u organización",
      orgPlaceholder: "Parroquia San Juan, Club de madres de Corona…",
      paraQueLabel: "¿Para qué los necesitás?",
      paraQueHelp: "Contá qué se va a hacer y quién se beneficia.",
      paraQuePlaceholder:
        "Estamos armando bolsones de comida para las familias del barrio y necesitamos manos para separarlos.",
      cuandoLabel: "¿Cuándo?",
      cuandoPlaceholder: "El sábado 12, de 9 a 12",
      cuantosLabel: "¿Cuántas personas?",
      cuantosHelp: "Un número aproximado alcanza.",
      submit: "Enviar el pedido",
      submitting: "Enviando…",
      done: {
        title: "Lo recibimos",
        body: "Lo miramos y te escribimos. Si es voluntariado, les avisamos a los voluntarios de tu zona.",
      },
      abiertoBody: "Ya tenemos tu pedido de voluntarios. Te escribimos apenas lo miremos.",
    },

    // ---- 3 · Registrar mi lugar --------------------------------------------
    lugar: {
      title: "Registrar mi lugar",
      subtitle: "Centros de acopio, bancos de comida y comedores del barrio.",
      /**
       * Acá la promesa es AL REVÉS que en los otros tres, y por eso se dice
       * aparte: el lugar SÍ se publica si el equipo lo aprueba, con su
       * dirección, sus horarios y su teléfono. Callarlo y publicarlo después
       * sería lo peor que se puede hacer con un dato que alguien dejó creyendo
       * otra cosa.
       */
      aviso:
        "Si lo aprobamos, el lugar aparece en el listado de la comunidad con su dirección, sus horarios y el teléfono que dejes acá.",
      tipoLabel: "¿Qué es?",
      tipoHelp: "En el centro de acopio la gente deja donaciones; en el banco de comida las recibe.",
      nombreLabel: "Nombre del lugar",
      nombrePlaceholder: "Despensa Comunitaria San Rafael",
      direccionLabel: "Dirección",
      direccionPlaceholder: "103-25 Roosevelt Ave, Corona, NY 11368",
      horariosLabel: "Días y horarios",
      horariosPlaceholder: "Martes y jueves de 10 a 14",
      queLabel: "¿Qué reciben o qué entregan?",
      queHelp: "Lo que la gente necesita saber antes de ir hasta ahí.",
      quePlaceholder:
        "Entregamos bolsones de comida seca. No hace falta traer papeles ni sacar turno.",
      contactoTitulo: "Teléfono del lugar",
      contactoAyuda: "Es el que va a ver la gente si publicamos la ficha.",
      submit: "Registrar el lugar",
      submitting: "Registrando…",
      done: {
        title: "Recibimos tu lugar",
        body: "Lo vamos a revisar y confirmar los datos. Si está todo bien, lo sumamos al listado de la comunidad.",
      },
      abiertoBody: "Ya tenemos tu lugar. Lo estamos revisando y te escribimos.",
    },

    // ---- 4 · Espacio comunitario -------------------------------------------
    espacio: {
      /** La pantalla de destino de la tarjeta: explica qué es y ofrece el formulario. */
      portada: {
        title: "Espacio comunitario",
        subtitle: "Un local vacío un rato a la semana puede ser un aula.",
        body: "¿Tenés un salón, un local o un depósito que no usás los sábados a la mañana o los domingos? Se puede prestar para clases de música para los chicos, inglés para las madres o charlas informativas. Vos ponés el día, el horario y hasta dónde llega tu compromiso.",
        /**
         * El cliente ya sabe que esto arranca vacío. Decirlo es mejor que
         * simular movimiento: nadie se siente el único, y nadie espera un
         * listado que todavía no existe.
         */
        nota: "Recién arranca: por ahora estamos juntando los primeros espacios. Nada de lo que dejes acá se publica.",
        cta: "Ofrecer mi espacio",
      },
      title: "Ofrecer mi espacio",
      subtitle: "Contanos qué tenés y cuándo está libre.",
      nombreLabel: "Nombre del negocio o del lugar",
      nombrePlaceholder: "Panadería La Esperanza",
      direccionLabel: "Dirección",
      direccionPlaceholder: "82-14 Northern Blvd, Jackson Heights, NY",
      descripcionLabel: "¿Cómo es el espacio?",
      descripcionHelp: "El tamaño, si hay mesas, si hay baño, si se entra con cochecito.",
      descripcionPlaceholder:
        "El salón del fondo, con diez mesas largas y baño. Se entra por la puerta de al lado.",
      capacidadLabel: "¿Cuánta gente entra?",
      capacidadHelp: "A ojo está bien.",
      diasLabel: "¿Qué días y horarios está libre?",
      diasPlaceholder: "Sábados de 9 a 13",
      actividadesLabel: "¿Para qué lo prestarías?",
      actividadesHelp: "Marcá lo que te parezca bien. Podés elegir varias.",
      submit: "Ofrecer el espacio",
      submitting: "Enviando…",
      done: {
        title: "Gracias, lo recibimos",
        body: "Te vamos a llamar para conocernos y ver cómo organizarlo. No publicamos nada sin hablar con vos.",
      },
      abiertoBody: "Ya tenemos tu espacio anotado. Te escribimos para coordinar.",
    },
  },

} as const;

// ---------------------------------------------------------------------------
// Etiquetas de los valores cerrados
// ---------------------------------------------------------------------------

/** Los catorce temas del directorio, en voz de quien busca. */
export const RESOURCE_TOPIC_LABEL: Record<ResourceTopic, string> = {
  emergencias: "Emergencias",
  migracion: "Migración y trámites",
  salud: "Salud sin seguro",
  adicciones: "Drogas y alcohol",
  medicinas: "Medicinas y remedios",
  comida: "Comida y alimentos",
  consulados: "Consulados",
  legal: "Ayuda legal",
  vivienda: "Vivienda y refugio",
  trabajo: "Ayuda para conseguir trabajo",
  educacion: "Educación e idioma",
  fe: "Iglesias y ayuda comunitaria",
  voluntariado: "Grupos de voluntarios",
  acopio: "Centro de acopio",
};

/**
 * Una línea por tema: qué vas a encontrar ahí adentro.
 *
 * Los cuatro de la 0120 se escribieron con el mismo cuidado que el resto: cada
 * frase describe QUÉ HAY, nunca qué hacer. "Grupos de apoyo y centros que
 * acompañan" es información; "si tenés un problema con el alcohol, buscá
 * ayuda" sería un consejo nuestro sobre salud, y eso no se escribe acá (ver la
 * cabecera del archivo).
 */
export const RESOURCE_TOPIC_HINT: Record<ResourceTopic, string> = {
  emergencias: "Líneas que atienden a cualquier hora.",
  migracion: "Oficinas y organizaciones que informan sobre trámites.",
  salud: "Clínicas y centros que atienden sin seguro.",
  adicciones: "Grupos de apoyo, líneas que atienden y centros que acompañan con drogas y alcohol.",
  medicinas: "Dónde conseguir remedios gratis o más baratos, y quién ayuda con el costo.",
  comida: "Despensas y comedores comunitarios.",
  consulados: "Consulados y sus servicios para connacionales.",
  legal: "Organizaciones con asistencia legal gratuita o a bajo costo.",
  vivienda: "Refugios y programas de ayuda con la vivienda.",
  trabajo: "Centros de trabajadores, talleres de currículum y bolsas de trabajo del barrio.",
  educacion: "Clases de inglés, terminar la secundaria, formación.",
  fe: "Parroquias, templos y organizaciones de fe que dan una mano y acompañan.",
  voluntariado: "Organizaciones que suman voluntarios para comedores, refugios y otras tareas del barrio.",
  acopio: "Adónde llevar ropa, comida o insumos para donar, y qué hace falta en cada lugar ahora mismo.",
};

/**
 * ── ETIQUETAS DEL TABLÓN "PEDIR AYUDA" (0120 + 0130) ───────────────────────
 *
 * Los estados se DERIVAN del objeto de copy en vez de repetirlo, y la
 * anotación de tipo es lo que hace el trabajo: `Record<HelpStatus, string>`
 * obliga a que estén los cinco. El día que la migración sume uno, TypeScript
 * rompe acá y no en una pantalla que dibuja una etiqueta vacía.
 *
 * ── POR QUÉ LOS TEMAS YA NO REUSAN EL MAPA DEL DIRECTORIO ──────────────────
 * Hasta la 0120, `HELP_TOPIC_LABEL` era literalmente `RESOURCE_TOPIC_LABEL`:
 * los seis temas del tablón eran un subconjunto de los catorce del directorio
 * y compartir el mapa garantizaba que se llamaran igual en los dos lados.
 *
 * La 0130 rompe ese subconjunto —`tramites` y `otro` no existen en el
 * directorio— y, sobre todo, rompe la premisa: una ficha del directorio se
 * rotula desde la información («Salud sin seguro», «Migración y trámites»),
 * y un tema de pedido se rotula desde la persona que pregunta. Quien escribe
 * «¿alguien sabe dónde dan turnos?» no está buscando la categoría "Migración y
 * trámites": está haciendo un trámite. Las etiquetas de acá son más cortas y
 * más llanas por eso, no por descuido.
 */
export const HELP_TOPIC_LABEL: Record<HelpTopic, string> = {
  tramites: "Trámites y papeles",
  salud: "Salud",
  trabajo: "Trabajo",
  educacion: "Estudio e idioma",
  vivienda: "Vivienda",
  comida: "Comida",
  fe: "Iglesia y comunidad",
  voluntariado: "Voluntariado",
  acopio: "Donaciones",
  otro: "Otra cosa",
};

/**
 * Una línea por tema: qué clase de pedido va ahí. Cada frase describe QUÉ SE
 * PIDE, nunca qué hacer — la línea del §11 vale en esta sección igual que en
 * el resto del módulo.
 */
export const HELP_TOPIC_HINT: Record<HelpTopic, string> = {
  tramites: "Turnos, papeles, consulados, licencias: a quién preguntarle y qué llevar.",
  salud: "Dónde atienden, cómo conseguir un remedio o un equipo que hace falta.",
  trabajo: "Dónde buscar, qué se necesita para un oficio, quién enseña.",
  educacion: "Clases de inglés, terminar la secundaria, cursos y capacitaciones.",
  vivienda: "Dónde preguntar por un lugar, a quién acudir si hay un problema con el alquiler.",
  comida: "Dónde hay comida gratis o barata cerca.",
  fe: "Parroquias y grupos que acompañan y dan una mano.",
  voluntariado: "Buscás gente que quiera colaborar con algo de la comunidad.",
  acopio: "Necesitás ropa, muebles o insumos, o buscás dónde llevarlos.",
  otro: "Lo que no entra en ninguno de los anteriores.",
};

export const HELP_STATUS_LABEL: Record<HelpStatus, string> = COMUNIDAD_COPY.pedirAyuda.estado;
export const HELP_STATUS_HINT: Record<HelpStatus, string> = COMUNIDAD_COPY.pedirAyuda.estadoHint;

/**
 * Idiomas ofrecidos como opción cerrada y no como texto libre.
 *
 * Con texto libre, "español", "Español", "castellano" y "espanol" son cuatro
 * idiomas distintos y el dato deja de servir para filtrar. La lista incluye
 * "Lenguas indígenas" porque en esta población no es un caso de borde: hay
 * barrios enteros donde el mixteco o el k'iche' son la primera lengua, y quien
 * puede acompañar en esa lengua es exactamente la persona más difícil de
 * encontrar.
 */
export const HELP_LANGUAGES = [
  "Español",
  "Inglés",
  "Portugués",
  "Créole haitiano",
  "Lenguas indígenas",
] as const;

export const LOST_FOUND_TYPE_LABEL: Record<LostFoundType, string> = {
  lost: "Se perdió",
  found: "Se encontró",
};

export const LOST_FOUND_CATEGORY_LABEL: Record<LostFoundCategory, string> = {
  documentos: "Documentos",
  llaves: "Llaves",
  telefono: "Teléfono",
  billetera: "Billetera o cartera",
  mochila: "Mochila o bolso",
  mascota: "Mascota",
  otro: "Otra cosa",
};

// ---------------------------------------------------------------------------
// Registros privados (0131) — etiquetas de los catálogos cerrados
//
// Viven acá y no junto a los ids (types.ts) por la misma razón que
// RESOURCE_TOPIC_LABEL: el id es contrato con la base y no se toca; la etiqueta
// es copy y se reescribe cuando hace falta. Los usan LOS DOS lados: el
// formulario que dibuja los chips y la ficha del panel que los vuelve a leer —
// si estuvieran duplicados, el equipo terminaría viendo un nombre distinto del
// que eligió la persona.
// ---------------------------------------------------------------------------

export const VOLUNTEER_SKILL_LABEL: Record<VolunteerSkill, string> = {
  comida: "Repartir comida",
  acompanar: "Acompañar a alguien",
  traducir: "Traducir o interpretar",
  ensenar: "Enseñar o dar clases",
  transporte: "Llevar y traer cosas",
  eventos: "Ayudar en eventos",
  formularios: "Ayudar a llenar formularios",
  cuidado: "Cuidar chicos o acompañar mayores",
};

export const VOLUNTEER_AVAILABILITY_LABEL: Record<VolunteerAvailability, string> = {
  mananas: "Mañanas",
  tardes: "Tardes",
  noches: "Noches",
  finde: "Fines de semana",
  entre_semana: "Entre semana",
  cuando_haga_falta: "Cuando haga falta",
};

export const SPACE_ACTIVITY_LABEL: Record<SpaceActivity, string> = {
  clases_chicos: "Clases para los chicos",
  idiomas: "Clases de idiomas",
  charlas: "Charlas informativas",
  talleres: "Talleres y oficios",
  reuniones: "Reuniones del barrio",
  donaciones: "Juntar donaciones",
};

export const PLACE_TYPE_LABEL: Record<PlaceType, string> = {
  acopio: "Centro de acopio",
  comida: "Banco de comida o comedor",
};

export const PLACE_TYPE_HINT: Record<PlaceType, string> = {
  acopio: "La gente deja donaciones: ropa, alimentos, insumos.",
  comida: "La gente recibe comida: despensa, bolsones, plato caliente.",
};

export const REQUESTER_TYPE_LABEL: Record<RequesterType, string> = {
  persona: "Una persona o un grupo de vecinos",
  organizacion: "Una organización, iglesia o negocio",
};

/**
 * Etiqueta de cada campo del `details`, para la ficha del panel. Las claves son
 * las MISMAS que escribe `registros.ts` en la base: si alguna se renombra allá
 * y no acá, la ficha muestra la clave cruda — que es feo pero honesto, y mejor
 * que esconder un dato.
 */
export const REGISTRATION_FIELD_LABEL: Record<string, string> = {
  skills: "Puede ayudar con",
  availability: "Disponible",
  requester_type: "Quién pide",
  org_name: "Organización",
  when_label: "Cuándo",
  people_needed: "Cuántas personas",
  place_type: "Tipo de lugar",
  address: "Dirección",
  hours_label: "Días y horarios",
  capacity: "Capacidad",
  days_label: "Días libres",
  activities: "Para qué lo presta",
};

export const REGISTRATION_KIND_LABEL: Record<RegistrationKind, string> = {
  volunteer: "Voluntarios",
  volunteer_request: "Piden voluntarios",
  place: "Lugares",
  space: "Espacios",
};

export const REGISTRATION_STATUS_LABEL: Record<RegistrationStatus, string> = {
  new: "Sin mirar",
  contacted: "Contactado",
  approved: "Aprobado",
  discarded: "Descartado",
};

/**
 * Los diccionarios que necesita `detallesDeRegistro`, ya armados. Se exporta el
 * objeto entero y no cada pieza suelta para que ninguna pantalla arme el suyo a
 * mano y se olvide de una tabla.
 */
export const REGISTRATION_DICCIONARIOS = {
  skill: VOLUNTEER_SKILL_LABEL,
  availability: VOLUNTEER_AVAILABILITY_LABEL,
  activity: SPACE_ACTIVITY_LABEL,
  placeType: PLACE_TYPE_LABEL,
  requesterType: REQUESTER_TYPE_LABEL,
  campo: REGISTRATION_FIELD_LABEL,
} as const;
