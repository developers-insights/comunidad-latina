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
