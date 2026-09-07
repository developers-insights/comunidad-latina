/**
 * COPY de la BARRA DE MENSAJE — botón +, adjuntos y notas de voz.
 *
 * Vive aparte de `copy.ts` sólo mientras dure este frente de trabajo: la idea es
 * que se consolide adentro de `COPY` como `COPY.composer.*` cuando se junten las
 * ramas. Mismo tono que el resto del módulo: español cálido neutro, sin jerga,
 * y nunca la palabra técnica cuando existe la de todos los días ("archivo" y no
 * "adjunto", "grabar" y no "capturar audio").
 */
export const COPY_COMPOSER = {
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
} as const;
