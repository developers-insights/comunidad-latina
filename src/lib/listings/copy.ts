/**
 * Textos del ciclo de vida de una publicación: vencimiento (0098), cierre y
 * reconfirmación de disponibilidad (0117) y pausa automática por reportes
 * (0118).
 *
 * REGLA DE TONO: la persona no hizo nada mal. Su aviso cumplió un plazo, o
 * necesita una confirmación, o se pausó mientras el equipo mira algo — nunca
 * porque ella se equivocó. Nada de "expiró", "caducó", "eliminado" ni signos
 * de exclamación de alarma: son palabras de multa, y acá no hay ninguna multa.
 *
 * Y la promesa se dice SIEMPRE, con todas las letras: no se borró nada. Es lo
 * único que la persona necesita saber para no entrar en pánico, y es cierto —
 * ver la Decisión 1 de la migración 0098.
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
    /** `paused` + `attrs.paused_reason === 'reports'` (0118): badge propio,
     *  distinto de `pausada`, para que se note que no lo bajó el dueño. */
    pausadaPorReportes: "Pausada por reportes",
  },

  detalle: {
    vencidaCuerpo:
      "No se borró nada: tus fotos, tus comentarios y tus estadísticas siguen acá. Renovala y vuelve a estar visible.",
    porVencerCuerpo:
      "Renovala con un toque y sigue publicada otro período completo.",
    noVenceCuerpo: "Esta publicación se queda visible mientras vos quieras.",
    renovadaVeces: (veces: number) =>
      veces === 1 ? "Renovada 1 vez" : `Renovada ${veces} veces`,
    /**
     * 0118 — mismo hecho que la notificación que ya recibió ("la sacamos de
     * circulación... no se borró nada... vuelve a estar visible apenas se
     * resuelva"), en la card de su propia lista. Sereno y sin culpa: la pausó
     * un cálculo automático, no una persona, y todavía no hay veredicto.
     */
    pausadaPorReportesCuerpo:
      "Recibió reportes de la comunidad, así que la sacamos de circulación hasta que el equipo la revise. No se borró nada: si fue un malentendido, vuelve a estar visible sola.",
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
      /**
       * 0117. En la práctica esto casi no se lee como toast: `renovar-boton`
       * intercepta este motivo puntual y abre `confirmarDisponibilidad` en su
       * lugar. Igual necesita texto acá — es el mismo diccionario que traduce
       * lo que devuelve la base, y un motivo sin traducción sería un error
       * genérico donde el usuario espera uno concreto.
       */
      necesita_confirmar_disponibilidad:
        "Esta publicación lleva más de 60 días activa. Confirmá que sigue disponible para renovarla.",
    },
    errorGenerico: "No pudimos renovarla ahora. Probá de nuevo en un momento.",
    necesitaCuenta: "Entrá con tu cuenta para renovar tu publicación.",

    /**
     * Diálogo que abre `RenovarBoton` cuando la base responde
     * `necesita_confirmar_disponibilidad` (0117). NO es un "¿estás seguro de
     * renovar?" — eso sigue sin existir, a propósito (ver el docblock del
     * componente). Es una pregunta real, con un "no" que tiene adónde ir: si
     * ya no está disponible, el camino es "Marcar como alquilado" /
     * "cubierto" / "vendido" / "finalizado", ahí al lado.
     */
    confirmarDisponibilidad: {
      titulo: "¿Sigue disponible?",
      // `dias` siempre es ≥ 60 acá (es la guarda de la propia RPC), así que no
      // hace falta la rama de singular que sí usan `vigente`/`porVencer`.
      cuerpo: (dias: number) =>
        `La publicaste hace ${dias} días. Confirmá que sigue disponible y la renovamos por otro período.`,
      confirmar: "Sí, sigue disponible",
      cancelar: "Todavía no",
    },
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

  /**
   * Cierre voluntario — "el trato se hizo" (0117). `closedReasonForKind`
   * decide la clave (rented/filled/sold/done); estos cuatro Record cubren los
   * cuatro botones, cuatro badges y el mensaje de éxito de cada uno.
   */
  cerrar: {
    cta: {
      rented: "Marcar como alquilado",
      filled: "Marcar como cubierto",
      sold: "Marcar como vendido",
      done: "Marcar como finalizado",
    },
    /** Badge de la lista cuando `status === 'closed'`. */
    badge: {
      rented: "Alquilado",
      filled: "Cubierto",
      sold: "Vendido",
      done: "Finalizado",
    },
    confirmar: {
      // El título se arma en el componente como `¿${cta[reason]}?` — un solo
      // Record de origen en vez de dos copias del mismo texto.
      /**
       * Tono NO dramático (pedido explícito): dice la consecuencia real —se
       * deja de recibir contacto por acá— y la reversibilidad real —se puede
       * volver a publicar, pero pasa de nuevo por moderación (anti
       * bait-and-switch, 0004)— sin llamarlo "irreversible" ni "cuidado".
       */
      cuerpo:
        "Vas a dejar de recibir mensajes por esta publicación. Más adelante la podés volver a publicar, pero antes tiene que pasar de nuevo por revisión.",
      confirmar: "Sí, confirmar",
      cancelar: "Cancelar",
    },
    ok: {
      rented: "Listo, marcamos tu aviso como alquilado.",
      filled: "Listo, marcamos tu aviso como cubierto.",
      sold: "Listo, marcamos tu aviso como vendido.",
      done: "Listo, marcamos tu aviso como finalizado.",
    },
    error: "No pudimos actualizarla ahora. Probá de nuevo en un momento.",
    necesitaCuenta: "Entrá con tu cuenta para actualizar tu publicación.",
  },

  /**
   * Ficha de detalle de un aviso `closed` (0117), hoy en los seis módulos que
   * publican avisos. `bannerTitulo` es el genérico y alcanza solo para
   * `closed_reason === 'done'` (Negocios, Profesionales, Eventos: no hay un
   * hecho más específico que contar). Los otros tres motivos suman una
   * segunda línea con el hecho concreto — mismo criterio que ya tenía
   * `bannerRented`, ahora con sus dos pares para Empleos y Marketplace.
   */
  cerrado: {
    bannerTitulo: "Este aviso ya no está disponible",
    /** Segunda línea del banner, sólo cuando `closed_reason === 'rented'`. */
    bannerRented: "Ya se alquiló.",
    /** Ídem, sólo cuando `closed_reason === 'filled'` (Empleos). */
    bannerFilled: "Ya se cubrió el puesto.",
    /** Ídem, sólo cuando `closed_reason === 'sold'` (Marketplace). */
    bannerSold: "Ya se vendió.",
  },
} as const;
