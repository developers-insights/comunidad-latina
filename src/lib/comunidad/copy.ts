import type {
  HelpDirection,
  HelpStatus,
  HelpTopic,
  LostFoundCategory,
  LostFoundType,
  ResourceTopic,
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
      "Acá reunimos lo que la comunidad necesita tener a mano: adónde pedir ayuda, comida o trámites, quién perdió o encontró algo cerca tuyo, y dónde sumarte si te sobra una mano para dar.",
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
      recursos: {
        title: "Pedir ayuda",
        hint: "Clínicas sin seguro, consulados y oficinas de ayuda, con teléfono y dirección.",
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
       * Ayuda mutua (0120). Es la única tarjeta de la grilla que lleva a algo
       * que ESCRIBE la gente: las otras seis llevan a contenido curado o a
       * Perdido y encontrado. El `title` no dice "Ofrecerme" ni "Pedir manos"
       * porque la pantalla tiene las dos caras y elegir una dejaría afuera a
       * la mitad —justo la mitad que el cliente nombró aparte: «o el lugar
       * donde necesita prestar los servicios»—. "Ayuda mutua" es además el
       * término que la comunidad ya usa para esto.
       */
      manos: {
        title: "Ayuda mutua",
        hint: "Ofrecete para dar una mano, o pedí manos para tu comedor, tu parroquia o tu punto de acopio.",
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
      comida: {
        title: "Todavía no hay bancos de comida cargados",
        message:
          "Estamos sumando comedores y despensas de tu comunidad. Mientras tanto, mirá el resto de la ayuda disponible.",
      },
      voluntariado: {
        title: "Todavía no hay grupos de voluntarios cargados",
        message:
          "Estamos armando este directorio. Mientras tanto, mirá el resto de la ayuda disponible.",
      },
      acopio: {
        title: "Todavía no hay centros de acopio cargados",
        message:
          "Estamos sumando puntos de acopio de tu comunidad. Mientras tanto, mirá el resto de la ayuda disponible.",
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
  ayudaMutua: {
    title: "Dar y pedir una mano",
    subtitle: "Quién se ofrece y qué lugares necesitan manos, cerca tuyo.",
    intro:
      "Hay dos maneras de estar acá: ofrecer un rato de tu tiempo, o pedir manos para el lugar donde ayudás. Las dos se ven en esta misma lista.",

    /** Las dos reglas duras. Ver el comentario de arriba. */
    reglas: {
      plata: {
        title: "Acá no se mueve plata",
        body:
          "Lo que se ofrece y se pide es tiempo, manos y cosas. Nunca dinero: no pidas ni mandes plata por esta sección, aunque la causa sea buena. Si alguien te la pide, reportalo y lo miramos.",
      },
      contacto: {
        title: "No dejes tus datos en el texto",
        body:
          "Nada de teléfono, correo ni dirección. Quien quiera sumarse te escribe por mensaje privado desde la app, así tu número no queda publicado para cualquiera.",
      },
      revision: {
        title: "Lo mira una persona antes de publicarse",
        body:
          "Cada aviso pasa por el equipo antes de aparecer en la lista. Es un paso corto y es lo que hace que esta sección se pueda usar tranquilo.",
      },
    },

    /**
     * Las dos direcciones. Cada una se nombra de tres formas distintas y no es
     * redundancia: `badge` es la etiqueta de la tarjeta (tercera persona, se
     * lee de un vistazo), `elegir` es lo que se toca en el formulario (primera
     * persona, es una decisión propia) y `filtro` es cómo se busca (plural, es
     * una categoría). Usar el mismo texto en los tres lugares haría que el
     * formulario suene a formulario.
     */
    direccion: {
      offer: {
        badge: "Se ofrece",
        elegir: "Quiero ayudar",
        elegirHint: "Tenés un rato, un oficio o ganas de dar una mano.",
        filtro: "Quién se ofrece",
      },
      need: {
        badge: "Piden manos",
        elegir: "Necesito manos",
        elegirHint: "Sos parte de un comedor, una parroquia o un punto de acopio y te falta gente.",
        filtro: "Dónde hacen falta manos",
      },
    },

    filtros: {
      todo: "Todo",
      temaLabel: "Tema",
      todosLosTemas: "Todos los temas",
      direccionLabel: "Qué estás mirando",
      zonaLabel: "Zona",
      zonaPlaceholder: "Ej.: Jackson Heights, Queens",
      zonaHelp: "Escribí el barrio o la parada más cercana.",
      buscar: "Buscar",
      limpiar: "Limpiar filtros",
    },

    card: {
      enLugar: (lugar: string) => `En ${lugar}`,
      disponibilidad: "Cuándo puede",
      disponibilidadNeed: "Cuándo hacen falta",
      idiomas: "Habla",
      escribir: "Escribirle",
      escribirNeed: "Escribir al lugar",
      escribirHint: "Se abre un mensaje privado. Tus datos no se publican.",
      verFicha: "Ver el lugar en el directorio",
      escribirErrores: {
        generic: "No pudimos abrir el mensaje. Probá de nuevo en un momento.",
        noDisponible: "Ese aviso ya no está disponible.",
        propio: "Este aviso es tuyo.",
        bloqueado: "No podés escribirle a esta persona.",
      },
    },

    /** CTA que aparece en las fichas del directorio y en cada tema del tablón. */
    ficha: {
      cta: "Quiero ayudar acá",
      ctaHint: "Contale al equipo que querés dar una mano en este lugar.",
      contador: (cantidad: number) =>
        cantidad === 1 ? "1 persona ya se ofreció" : `${cantidad} personas ya se ofrecieron`,
    },

    publicarCta: "Publicar un aviso",
    misAvisosCta: "Mis avisos",
    verTodos: "Ver todos los avisos",

    vacio: {
      title: "Todavía no hay avisos por acá",
      message:
        "Nadie publicó nada en esta comunidad. Si te sobra un rato o si tu lugar necesita manos, empezá vos: el primer aviso es el que arranca todo.",
      filtradoTitle: "No encontramos avisos con esos filtros",
      filtradoMessage:
        "Probá con una zona más amplia o mirá todos los temas. A veces el aviso está publicado con el nombre del barrio de al lado.",
    },

    /** "Mis avisos": la única pantalla donde alguien ve sus borradores y rechazos. */
    mios: {
      title: "Mis avisos de ayuda",
      subtitle: "En qué anda cada uno de los que publicaste.",
      vacioTitle: "Todavía no publicaste ninguno",
      vacioMessage:
        "Cuando ofrezcas una mano o pidas manos para tu lugar, vas a poder seguirlo desde acá.",
      rechazoTitle: "Por qué no se publicó",
      corregir: "Corregir y volver a enviar",
      retirar: "Retirar de la cola",
      retirarHint: "Vuelve a ser un borrador y lo podés cambiar.",
      darDeBaja: "Dar de baja",
      darDeBajaHint: "Se saca de la lista. Sirve cuando ya conseguiste lo que buscabas.",
      confirmarBaja: "¿Damos de baja este aviso?",
      hecho: {
        retirado: "Listo, lo sacamos de la cola. Ya lo podés cambiar.",
        dadoDeBaja: "Listo, lo dimos de baja.",
      },
    },

    /** Los cinco estados, en voz de quien publicó. */
    estado: {
      draft: "Borrador",
      pending: "Lo estamos revisando",
      approved: "Publicado",
      rejected: "No se publicó",
      archived: "Dado de baja",
    },
    estadoHint: {
      draft: "Todavía no lo mandaste. Cuando quieras, lo enviás.",
      pending: "Está en la cola del equipo. Suele ser rápido.",
      approved: "Ya se ve en la lista de tu comunidad.",
      rejected: "Leé el motivo, corregilo y mandalo de nuevo.",
      archived: "Lo sacaste de la lista. Podés publicar uno nuevo cuando quieras.",
    },
  },

  // -------------------------------------------------------------------------
  // Publicar un aviso de ayuda mutua
  // -------------------------------------------------------------------------
  ofrecerse: {
    title: "Publicar un aviso",
    subtitle: "Son dos pasos y toma un minuto.",
    steps: {
      lado: {
        title: "¿Qué venís a hacer?",
        temaLabel: "¿Sobre qué tema?",
        temaHelp: "Elegí el que más se parezca. Después lo contás con tus palabras.",
        lugarLabel: "¿Es para un lugar en particular?",
        lugarHelp: "Si no ves el tuyo, dejalo en blanco y contalo abajo.",
        lugarNinguno: "No es para un lugar en particular",
        lugarVacio: "Todavía no hay lugares cargados en este tema.",
      },
      contar: {
        title: "Contalo en tus palabras",
        tituloLabel: "Resumilo en una línea",
        tituloPlaceholderOffer: "Ej.: Puedo ayudar a servir los sábados",
        tituloPlaceholderNeed: "Ej.: Necesitamos 4 personas para armar bolsones",
        tituloHelp: "Es lo que se lee primero en la lista.",
        detalleLabel: "Los detalles",
        detallePlaceholderOffer:
          "¿Qué sabés hacer? ¿Cuánto tiempo tenés? ¿Hay algo que no puedas hacer? Contalo simple.",
        detallePlaceholderNeed:
          "¿Para qué son las manos? ¿Cuántas hacen falta? ¿Qué tiene que saber quien se sume?",
        detalleHelp: "Sin teléfono ni dirección: te escriben por mensaje privado desde acá.",
        zonaLabel: "Zona",
        zonaPlaceholder: "Ej.: Corona, Queens",
        zonaHelp: "Un barrio o una parada alcanza. Nunca pongas tu dirección.",
        cuandoLabel: "¿Cuándo podés?",
        cuandoLabelNeed: "¿Cuándo hacen falta?",
        cuandoPlaceholder: "Ej.: sábados de mañana",
        lugarNombreLabel: "¿Cómo se llama el lugar?",
        lugarNombreHelp: "El nombre con el que lo conoce la gente del barrio.",
        idiomasLabel: "¿En qué idiomas podés ayudar?",
        idiomasLabelNeed: "¿En qué idiomas se necesita?",
      },
    },
    submit: "Enviar para revisión",
    submitting: "Enviando…",
    back: "Atrás",
    next: "Seguir",
    needLogin: "Entrá a tu cuenta para publicar",
    needLoginHint:
      "Publicar un aviso necesita tu cuenta: así quien quiera sumarse te escribe sin que tengas que dejar tu teléfono a la vista.",
    done: {
      title: "Lo estamos revisando",
      body:
        "Nos llega primero a nosotros. Apenas le demos el visto bueno, tu aviso aparece en la lista de tu comunidad. Suele ser rápido.",
      verTablon: "Ir a Ayuda mutua",
      verMios: "Ver mis avisos",
      otro: "Publicar otro",
    },
    /**
     * Mirar el tablón pide cuenta, y no por capricho: la 0120 no le da SELECT a
     * `anon` porque un listado abierto de nombre + barrio + "necesito ayuda con
     * X" es un padrón de gente vulnerable. Pero eso hay que DECIRLO — antes,
     * quien entraba sin sesión veía un cartel rojo de error y se iba pensando
     * que la sección estaba rota.
     *
     * El copy no pide disculpas ni explica la RLS: dice qué hay del otro lado y
     * por qué conviene que sea así, que es lo que hace que valga la pena entrar.
     */
    sinSesion: {
      title: "Entrá para ver quién está dando una mano",
      message:
        "Los avisos de ayuda no son públicos: se ven con tu cuenta. Así, quien pide o se ofrece no queda listado en internet para cualquiera.",
      cta: "Entrar a mi cuenta",
    },
    errors: {
      /**
       * Falla de LECTURA, no de envío. Decía "No pudimos enviarlo" en la
       * pantalla donde no se envía nada — el copy había viajado desde el
       * formulario sin que nadie lo releyera en su nuevo lugar.
       */
      leer: "No pudimos cargar los avisos. No es algo que hayas hecho vos: probá recargar en un momento.",
      generic: "No pudimos enviarlo. Revisá los datos y probá de nuevo.",
      title: "Resumilo en una línea (al menos 6 letras).",
      body: "Contá un poco más: con 20 letras alcanza para arrancar.",
      area: "Necesitamos la zona, aunque sea el barrio.",
      orgName: "Poné el nombre del lugar para el que pedís manos.",
      topic: "Elegí un tema para tu aviso.",
      resource: "Ese lugar ya no está disponible en este tema. Elegí otro o dejalo en blanco.",
      /**
       * Los tres del detector de contacto (`detectarDatoDeContacto`). Cada uno
       * dice QUÉ sacar y —lo importante— POR QUÉ conviene sacarlo: sin el
       * motivo se lee como una traba caprichosa y la persona lo intenta otra
       * vez con el número escrito distinto.
       */
      telefono:
        "Sacá el teléfono del texto. No hace falta: quien quiera sumarse te escribe por mensaje privado desde la app, y así tu número no queda publicado.",
      email:
        "Sacá el correo del texto. Te van a escribir por mensaje privado desde acá, sin que tengas que dejar tus datos.",
      enlace:
        "Sacá el enlace. Los grupos y las páginas de afuera no se publican en esta sección: la conversación arranca por mensaje privado, donde podés reportar si algo no cierra.",
      cupo:
        "Ya tenés 5 avisos esperando respuesta. Cuando resolvamos alguno vas a poder publicar otro.",
      moderacion:
        "Ese texto no lo podemos publicar tal como está. Contalo con otras palabras y volvé a intentar — lo que escribiste no se perdió.",
      estado: "Ese aviso ya no está en ese estado. Recargá la página y fijate cómo quedó.",
      suspendida: "Tu cuenta está pausada y por ahora no puede publicar.",
      auth: "Se cerró tu sesión. Entrá de nuevo y no perdés lo que escribiste.",
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
 * ── ETIQUETAS DEL TABLÓN DE AYUDA MUTUA (0120) ─────────────────────────────
 *
 * Las tres se DERIVAN del objeto de copy en vez de repetirlo, y la anotación
 * de tipo es lo que hace el trabajo: `Record<HelpStatus, string>` obliga a que
 * estén los cinco estados y `Record<HelpDirection, …>` a que estén las dos
 * caras. El día que la migración sume un estado, TypeScript rompe acá y no en
 * una pantalla que dibuja una etiqueta vacía.
 *
 * `HELP_TOPIC_LABEL` reusa el mapa del directorio a propósito: el tablón y las
 * fichas hablan del MISMO tema y tienen que llamarlo igual. Que los seis temas
 * del tablón sean un subconjunto de los catorce del directorio es lo que hace
 * que la asignación compile — si alguien sumara al CHECK de la 0120 un tema que
 * no existe en el directorio, esta línea deja de compilar, que es exactamente
 * el aviso que hace falta.
 */
export const HELP_TOPIC_LABEL: Record<HelpTopic, string> = RESOURCE_TOPIC_LABEL;
export const HELP_TOPIC_HINT: Record<HelpTopic, string> = RESOURCE_TOPIC_HINT;

export const HELP_DIRECTION_COPY: Record<
  HelpDirection,
  { badge: string; elegir: string; elegirHint: string; filtro: string }
> = COMUNIDAD_COPY.ayudaMutua.direccion;

export const HELP_STATUS_LABEL: Record<HelpStatus, string> = COMUNIDAD_COPY.ayudaMutua.estado;
export const HELP_STATUS_HINT: Record<HelpStatus, string> = COMUNIDAD_COPY.ayudaMutua.estadoHint;

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
