import { MAX_PARTICIPANTES } from "@/lib/calls/tipos";

/**
 * Todo el texto que se ve en llamadas, en un solo lugar.
 *
 * Misma convención que `components/messaging/copy.ts`. Nada de esto es una
 * transcripción de cómo se pidió la función: se escribe como se lo diría una
 * persona a otra, sin jerga y sin nombrar al proveedor —a nadie le importa que
 * atrás haya Agora, y decirlo sólo agrega una palabra que no significa nada.
 */
export const COPY = {
  seccion: {
    title: "Llamadas",
    /** Vacío del historial: explica de qué se trata y dónde se empieza. */
    emptyTitle: "Todavía no hiciste ninguna llamada",
    emptyBody:
      "Podés hablar por audio o video con hasta 10 personas de la comunidad, sin gastar minutos del teléfono. Se empieza desde un chat, con el botón de llamar.",
    emptyCta: "Ir a mis mensajes",
    tabsLabel: "Secciones de mensajes",
    tabPersonas: "Personas",
    tabGrupos: "Grupos",
    tabLlamadas: "Llamadas",
  },

  iniciar: {
    audioLabel: "Llamar por audio",
    videoLabel: "Llamar por video",
  },

  pantalla: {
    sello: "Conexión segura",
    selloDetalle: "El audio y el video viajan cifrados entre vos y quien te escucha.",
    llamando: "Llamando…",
    sonando: "Te está llamando",
    conectando: "Conectando…",
    reconectando: "Se cortó un momento, ya volvemos",
    terminada: "Llamada terminada",
    volver: "Volver",
    entrar: "Entrar a la llamada",
    entrarHint: "Vamos a pedirte permiso para usar el micrófono.",
    entrarHintVideo: "Vamos a pedirte permiso para usar el micrófono y la cámara.",
    duracionLabel: (hablada: string) => `Llevan ${hablada} de llamada`,
    participantes: (n: number) => (n === 1 ? "1 persona" : `${n} personas`),
    silenciado: "Con el micrófono apagado",
    sinCamara: "Con la cámara apagada",
    vos: "Vos",
    conectandose: "Conectándose…",
  },

  controles: {
    silenciar: "Silenciar",
    activarMic: "Activar micrófono",
    silenciarAria: "Apagar mi micrófono",
    activarMicAria: "Encender mi micrófono",
    video: "Video",
    prenderCamaraAria: "Encender mi cámara",
    apagarCamaraAria: "Apagar mi cámara",
    altavoz: "Altavoz",
    apagarSonidoAria: "Apagar el sonido de la llamada",
    encenderSonidoAria: "Encender el sonido de la llamada",
    anadir: "Añadir",
    anadirAria: "Añadir personas a la llamada",
    chat: "Chat",
    chatAria: "Abrir el chat en otra pestaña",
    finalizar: "Finalizar",
    finalizarAria: "Finalizar la llamada",
    atender: "Atender",
    rechazar: "Rechazar",
  },

  agregar: {
    sheetTitle: "Añadir a la llamada",
    intro: "Elegí a quién querés sumar. Les va a sonar el teléfono ahora mismo.",
    tope: `Máximo ${MAX_PARTICIPANTES} participantes`,
    cupo: (restantes: number) =>
      restantes === 1 ? "Podés sumar 1 persona más" : `Podés sumar ${restantes} personas más`,
    sinCupo: "La llamada ya está completa",
    buscar: "Buscar por nombre",
    vacio: "No encontramos a nadie con ese nombre en tu comunidad.",
    vacioSinBusqueda: "Todavía no tenés con quién hablar acá. Buscá a alguien por su nombre.",
    yaEsta: "Ya está en la llamada",
    boton: (n: number) => (n === 1 ? "Añadir 1" : `Añadir ${n}`),
    okTitle: (n: number) =>
      n === 1 ? "Le está sonando" : `Les está sonando a ${n} personas`,
    okBody: "Van a entrar en cuanto atiendan.",
  },

  timbre: {
    ariaLabel: "Llamada entrante",
    audio: "Llamada de audio",
    video: "Llamada de video",
    enGrupo: (nombre: string) => `Llamada del grupo ${nombre}`,
    atendiendo: "Entrando…",
  },

  errores: {
    permisoTitle: "No pudimos usar tu micrófono",
    permisoBody:
      "Tu navegador tiene el permiso bloqueado. Tocá el candado al lado de la dirección, permití el micrófono y volvé a intentar.",
    sinDispositivoTitle: "No encontramos micrófono ni cámara",
    sinDispositivoBody:
      "Conectá unos auriculares o revisá que el equipo tenga micrófono, y probá de nuevo.",
    ocupadoTitle: "Tu micrófono está en uso",
    ocupadoBody:
      "Otra aplicación o pestaña lo está usando. Cerrala y volvé a entrar a la llamada.",
    sinContextoSeguroTitle: "Esta dirección no permite llamar",
    sinContextoSeguroBody:
      "Las llamadas necesitan una conexión segura. Abrí el sitio desde su dirección con https y probá otra vez.",
    sinApiTitle: "Este navegador no puede hacer llamadas",
    sinApiBody:
      "Suele pasar cuando se abre desde adentro de otra aplicación. Abrí el sitio en Chrome o Safari y vas a poder llamar.",
    tokenTitle: "No pudimos conectarte",
    tokenBody: "La llamada ya no está disponible o perdiste el acceso. Probá de llamar de nuevo.",
    conexionTitle: "No pudimos entrar a la llamada",
    conexionBody: "Revisá tu conexión y probá de nuevo.",
    desconocidoTitle: "Algo no salió bien",
    desconocidoBody: "No es tu culpa. Probá de nuevo en un momento.",
    reintentar: "Probar de nuevo",
    salir: "Salir",
  },

  fallos: {
    llenaTitle: "La llamada está completa",
    llenaBody: `Ya son ${MAX_PARTICIPANTES} personas, que es el máximo. Si alguien corta, se libera un lugar.`,
    suspendidaTitle: "No podés llamar por ahora",
    suspendidaBody: "Tu cuenta está en revisión. Escribinos si creés que es un error.",
    prohibidaTitle: "No pudimos empezar la llamada",
    prohibidaBody: "Puede que esa persona ya no esté disponible para vos.",
    terminadaTitle: "Esa llamada ya terminó",
    terminadaBody: "Podés empezar una nueva desde el chat.",
    rapidoTitle: "Muchas llamadas seguidas",
    rapidoBody: "Esperá un momento antes de volver a llamar.",
    genericoTitle: "No pudimos empezar la llamada",
    genericoBody: "No es tu culpa. Probá de nuevo en un momento.",
  },

  historial: {
    perdida: "Llamada perdida",
    rechazada: "Llamada rechazada",
    sinRespuesta: "No atendieron",
    saliente: "Llamaste",
    entrante: "Te llamaron",
    kindAudio: "Audio",
    kindVideo: "Video",
  },
} as const;
