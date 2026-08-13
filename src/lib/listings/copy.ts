/**
 * Textos del vencimiento de publicaciones (0098).
 *
 * REGLA DE TONO: la persona no hizo nada mal. Su aviso cumplió un plazo, y el
 * plazo existe para que la comunidad no se llene de cosas que ya no están.
 * Nada de "expiró", "caducó", "eliminado" ni signos de exclamación de alarma:
 * son palabras de multa, y acá no hay ninguna multa.
 *
 * Y la promesa se dice SIEMPRE, con todas las letras: no se borró nada. Es lo
 * único que la persona necesita saber para no entrar en pánico, y es cierto —
 * ver la Decisión 1 de la migración.
 */

export const VENCIMIENTO_COPY = {
  pagina: {
    titulo: "Mis publicaciones",
    bajada: "Todo lo que publicaste, con el tiempo que le queda a cada una.",
    volver: "Volver",
    vacioTitulo: "Todavía no publicaste nada",
    vacioCuerpo:
      "Cuando publiques un aviso, acá vas a poder ver cuánto le queda y renovarlo cuando haga falta.",
    vacioCta: "Publicar algo",
    necesitaCuentaTitulo: "Entrá para ver tus publicaciones",
    necesitaCuentaCuerpo: "Con tu cuenta vas a ver el estado de todo lo que publicaste.",
    necesitaCuentaCta: "Entrar",
  },

  estado: {
    /** `vigente` — falta bastante. */
    vigente: (dias: number) => (dias === 1 ? "Queda 1 día" : `Quedan ${dias} días`),
    /** `por_vencer` — dentro de la ventana de aviso. */
    porVencer: (dias: number) =>
      dias <= 0
        ? "Vence hoy"
        : dias === 1
          ? "Vence mañana"
          : `Vence en ${dias} días`,
    vencida: "Dejó de mostrarse",
    /** Categorías que no caducan (negocios, profesionales). */
    noVence: "Sin vencimiento",
    borrador: "Borrador",
    enRevision: "En revisión",
    pausada: "Pausada",
    bajada: "Dada de baja",
  },

  detalle: {
    vencidaCuerpo:
      "No se borró nada: tus fotos, tus comentarios y tus estadísticas siguen acá. Renovala y vuelve a estar visible.",
    porVencerCuerpo:
      "Renovala con un toque y sigue publicada otro período completo.",
    noVenceCuerpo: "Esta publicación se queda visible mientras vos quieras.",
    renovadaVeces: (veces: number) =>
      veces === 1 ? "Renovada 1 vez" : `Renovada ${veces} veces`,
  },

  renovar: {
    cta: "Renovar",
    ctaVencida: "Volver a publicar",
    enviando: "Renovando…",
    okTitulo: "Listo, sigue publicada",
    okCuerpo: (dias: number) =>
      dias === 1
        ? "Le queda 1 día más."
        : `Le quedan ${dias} días más.`,
    /**
     * Traducción de los motivos que devuelve `public.renovar_publicacion()`.
     * Uno por uno y en persona, sin códigos: "todavia_no" no le dice nada a
     * nadie, pero "todavía falta" sí.
     */
    motivos: {
      no_encontrada: "No encontramos esa publicación en tu cuenta.",
      estado_invalido:
        "Esta publicación no está activa. Volvé a publicarla desde su propia pantalla.",
      no_vence: "Esta publicación no vence, así que no hace falta renovarla.",
      tope_alcanzado:
        "Esta publicación llegó al máximo de renovaciones de la comunidad. Podés volver a publicarla como nueva.",
      todavia_no: "Todavía falta. Vas a poder renovarla cuando se acerque la fecha.",
    },
    errorGenerico: "No pudimos renovarla ahora. Probá de nuevo en un momento.",
    necesitaCuenta: "Entrá con tu cuenta para renovar tu publicación.",
  },

  /**
   * De qué módulo es cada aviso. Los nombres son los de la NAVEGACIÓN, no los
   * del `kind`: la persona publicó en "Vivienda", no en `property`. Y
   * `creator_gig` se llama "Colaboraciones" —igual que su pestaña de
   * notificaciones— aunque el pedido del cliente lo listó como "Influencers":
   * dos nombres para el mismo lugar dentro del producto sería peor.
   */
  modulos: {
    property: "Vivienda",
    business: "Negocios",
    professional: "Profesionales",
    event: "Eventos",
    job: "Empleos",
    product: "Marketplace",
    creator_gig: "Colaboraciones",
    lost_found: "Perdido y encontrado",
  } as Record<string, string>,

  /** Categoría de notificaciones (espeja CATEGORY_META.vencimientos). */
  notificaciones: {
    categoria: "Vencimientos",
    descripcion: "Cuándo vencen tus publicaciones y cuándo hace falta renovarlas.",
  },
} as const;
