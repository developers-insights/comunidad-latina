/**
 * Copy de "Tu zona", en un solo lugar.
 *
 * Vive junto al módulo y no en `@/lib/i18n` por el mismo motivo que
 * `PERFIL_ACTIVO_COPY`: es vocabulario de UNA feature, con frases que se
 * arman con la zona adentro. Las dos claves que ya existían en el diccionario
 * (`nav.chooseLocation`, `nav.locationPlaceholder`) se siguen usando desde ahí
 * — son del header, no de esta hoja.
 */
export const ZONA_COPY = {
  /** Rótulo del control cuando NO hay zona elegida. La invitación, no un estado. */
  botonSinZona: "Tu zona",
  botonConZona: (zona: string) => `Estás viendo ${zona}. Tocá para cambiar de zona.`,
  botonSinZonaLabel: "Elegí la zona que querés ver",

  /**
   * "Usar mi ubicación".
   *
   * El cliente lo pidió como «my location». No se copia: nadie le dice así a
   * esto en su casa, y la mitad de la comunidad no lee en inglés. Se nombra por
   * lo que hace —encontrar tu barrio— y la ayuda contesta la única pregunta que
   * frena a alguien antes de dar el permiso: qué se guarda.
   */
  ubicacion: {
    boton: "Usar mi ubicación",
    ayuda: "Buscamos el barrio más cercano. No guardamos tu ubicación exacta.",
    buscando: "Buscando tu barrio…",
    listo: (zona: string) => `Te ubicamos en ${zona}`,

    /**
     * Los errores, uno por causa. "Algo salió mal" no le sirve a nadie: quien
     * negó el permiso necesita saber que lo negó y dónde se cambia, y quien
     * está en un sótano necesita saber que puede reintentar. Todos terminan en
     * la misma salida: la lista de barrios sigue abierta abajo.
     */
    error: {
      denegado:
        "No nos diste permiso para ver tu ubicación. Podés activarlo desde los permisos del navegador, o elegir tu barrio de la lista.",
      noDisponible:
        "Tu teléfono no pudo determinar dónde estás. Probá de nuevo o elegí tu barrio de la lista.",
      demoro:
        "Tardó demasiado en responder. Probá de nuevo o elegí tu barrio de la lista.",
      sinSoporte:
        "Este navegador no puede compartir la ubicación. Elegí tu barrio de la lista.",
      lejos:
        "No encontramos un barrio nuestro cerca tuyo. Elegí de la lista el que quieras ver.",
      generico:
        "No pudimos ubicarte. Probá de nuevo o elegí tu barrio de la lista.",
    },
  },

  /**
   * El radio en millas.
   *
   * Se dice "a la redonda" y no "radio de búsqueda": es como habla la gente y
   * es lo que el propio cliente escribió. El subtítulo nombra la zona para que
   * nunca haya duda de alrededor de QUÉ se está midiendo.
   */
  radio: {
    titulo: "¿Hasta qué distancia?",
    ayuda: (zona: string) => `A la redonda de ${zona}.`,
    ayudaSinZona: "Elegí primero tu zona y después hasta dónde querés ver.",
    soloZona: "Solo mi zona",
    soloZonaLabel: "Ver solo mi zona, sin distancia a la redonda",
    millas: (millas: number) => `${millas} millas`,
    millasLabel: (millas: number, zona: string) =>
      `Ver hasta ${millas} millas a la redonda de ${zona}`,
    recomendado: "Recomendado",
    /** Insignia del header cuando hay radio puesto. Corta a propósito. */
    insignia: (millas: number) => `${millas} mi`,
  },

  hoja: {
    titulo: "¿Qué zona querés ver?",
    ayuda:
      "Filtra el feed y todas las secciones: Vivienda, Empleos, Negocios, Profesionales, Marketplace y Eventos. Podés volver a toda la comunidad cuando quieras.",
    buscarLabel: "Buscar zona",
    buscarPlaceholder: "Buscá tu barrio o ciudad",
    todas: "Toda la comunidad",
    todasAyuda: "Sin filtrar por zona",
    viendo: "Viendo",
    cambiando: "Cambiando",
    usarEscrita: (texto: string) => `Ver «${texto}»`,
    usarEscritaAyuda: "Tal como lo escribiste",
    sinZonas:
      "Todavía nadie publicó indicando su zona. En cuanto pase, las vas a ver acá.",
    sinResultados: "No encontramos esa zona entre las publicadas.",
    error: "No pudimos traer las zonas. Probá de nuevo en un momento.",
    reintentar: "Reintentar",
  },

  toast: {
    zona: (zona: string) => `Listo, estás viendo ${zona}`,
    todas: "Listo, estás viendo toda la comunidad",
    error: "No pudimos cambiar la zona. Probá de nuevo.",
    /** El radio confirma con la zona adentro: el radio solo no dice nada. */
    radio: (millas: number, zona: string) =>
      `Listo, estás viendo hasta ${millas} millas de ${zona}`,
    radioSolo: (zona: string) => `Listo, estás viendo solo ${zona}`,
    radioError: "No pudimos cambiar la distancia. Probá de nuevo.",
  },

  /**
   * El vacío de una zona. NO puede decir "no hay resultados" a secas: sin decir
   * en qué zona está mirando, quien llega piensa que la app está vacía — que es
   * el modo de falla más caro de esta feature.
   */
  vacio: {
    titulo: (zona: string) => `Todavía no hay nada en ${zona}`,
    mensaje: (zona: string) =>
      `Estás viendo solo ${zona}. Ampliá la vista y mirá lo que publicó el resto de la comunidad.`,
    cta: "Ver toda la comunidad",
  },
} as const;
