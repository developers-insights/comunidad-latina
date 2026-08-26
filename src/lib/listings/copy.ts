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
      confirma_disponibilidad:
        "Pasaron más de 60 días. Confirmá que la propiedad sigue disponible y después podés renovarla.",
    },
    errorGenerico: "No pudimos renovarla ahora. Probá de nuevo en un momento.",
    necesitaCuenta: "Entrá con tu cuenta para renovar tu publicación.",
  },

  /**
   * CONFIRMAR DISPONIBILIDAD (0116) — spec §4: «deben confirmar nuevamente su
   * disponibilidad después de 60 días».
   *
   * El copy no habla de "reconfirmación" ni de plazos: le pregunta a la persona
   * lo único que sabe y que a la comunidad le importa —si el cuarto sigue
   * libre— y le da dos salidas, porque las dos respuestas posibles son "sí" y
   * "ya lo alquilé".
   */
  disponibilidad: {
    titulo: "¿Sigue disponible?",
    cuerpo:
      "Pasaron más de 60 días desde la última vez que lo confirmaste. Decinos si sigue en pie para que la gente no llame de al pepe.",
    cuerpoProximo: (dias: number) =>
      dias === 1
        ? "Mañana te vamos a pedir que confirmes que sigue disponible."
        : `En ${dias} días te vamos a pedir que confirmes que sigue disponible.`,
    cta: "Sí, sigue disponible",
    enviando: "Confirmando…",
    okTitulo: "Gracias, quedó confirmado",
    okCuerpo: "Vamos a volver a preguntarte en 60 días.",
    motivos: {
      no_encontrada: "No encontramos esa publicación en tu cuenta.",
      no_aplica: "Esto sólo aplica a las propiedades en alquiler.",
      estado_invalido: "Esta publicación no está activa, así que no hay disponibilidad que confirmar.",
    },
    errorGenerico: "No pudimos confirmarla ahora. Probá de nuevo en un momento.",
    necesitaCuenta: "Entrá con tu cuenta para confirmar tu publicación.",
  },

  /**
   * ALQUILADO (0116) — spec §4: «deben marcarse como Alquilado cuando dejen de
   * estar disponibles».
   *
   * Es una acción con vuelta atrás y el copy lo dice: sin esa frase, marcar
   * alquilado se siente como borrar, y quien duda no lo toca — y un aviso
   * alquilado que sigue publicado es exactamente lo que esto viene a evitar.
   */
  alquilado: {
    cta: "Ya lo alquilé",
    enviando: "Guardando…",
    confirmarTitulo: "¿Ya lo alquilaste?",
    confirmarCuerpo:
      "Lo sacamos del listado para que no te sigan escribiendo. Podés volver a publicarlo cuando quieras.",
    confirmarCta: "Sí, ya lo alquilé",
    cancelar: "Todavía no",
    okTitulo: "Listo, lo marcamos como alquilado",
    okCuerpo: "Dejó de aparecer en Vivienda. Sigue en tus publicaciones.",
    estado: "Alquilado",
    errorGenerico: "No pudimos marcarlo ahora. Probá de nuevo en un momento.",
    necesitaCuenta: "Entrá con tu cuenta para marcar tu publicación.",
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
