/**
 * Textos del perfil activo. La regla que manda acá no es de estilo: la persona
 * tiene que saber SIEMPRE con qué identidad está actuando. Nada de "modo
 * negocio" ni de etiquetas que suenan a configuración — se dice el nombre con
 * el que va a publicar, en primera persona y en presente.
 */
export const PERFIL_ACTIVO_COPY = {
  /** Hoja del cambiador. */
  sheet: {
    title: "¿Con qué perfil querés usar la app?",
    hint: "Lo que publiques, comentes y respondas va a salir con el perfil que elijas.",
    personalLabel: "Tu perfil personal",
    personalHint: "Publicás con tu nombre.",
    activeBadge: "En uso",
    createBusiness: "Crear una cuenta de negocio",
    createBusinessHint: "Tu local o tu emprendimiento, con su propio nombre.",

    /**
     * AGREGAR ≠ ADMINISTRAR. Son dos filas seguidas y la única forma de que no
     * se confundan es que digan cosas distintas: una empieza con un verbo de
     * creación y la otra con uno de gestión, y cada una lleva su propio ícono
     * (un más y un engranaje). Antes había una sola fila —"Administrar"— y el
     * cliente la miró buscando la de agregar.
     */
    addBusiness: "Agregar otro negocio",
    addBusinessHint: "Otro local, con su propio nombre y su propio perfil.",

    /**
     * Cuántos lugares quedan. Se dice en positivo —lo que PODÉS hacer— y sólo
     * cuando ya tenés al menos uno: a quien todavía no creó ninguno, "podés
     * crear 10" no le resuelve nada y le mete un número en la cabeza antes de
     * tiempo.
     */
    slotsLeft: (restantes: number, tope: number) =>
      restantes === 1 ? `Podés crear 1 más (de ${tope}).` : `Podés crear ${restantes} más (de ${tope}).`,

    /**
     * Se llegó al tope. No manda a borrar nada: dar de baja una cuenta de
     * negocio no tiene pantalla hoy, y un mensaje que pide algo que no se puede
     * hacer es un callejón sin salida. Dice el límite y qué SÍ se puede seguir
     * haciendo.
     */
    capReached: (tope: number) => `Llegaste al máximo de ${tope} negocios`,
    capReachedHint: "Podés seguir usando y administrando los que ya tenés.",

    manage: "Administrar tus negocios",
    changing: "Cambiando…",
    error: "No pudimos cambiar de perfil. Probá de nuevo en un momento.",

    /**
     * La insignia de "este perfil está verificado" en la fila del cambiador
     * (0121). Va como texto y no sólo como color: es la misma regla que ya
     * sigue `BusinessBadge` — nunca depender del color solo.
     */
    verifiedBadge: "Verificado",
    unverifiedHint: "Falta verificarlo para vender",
  },

  /** Cómo se anuncia el cambio, ya hecho. */
  toast: {
    personal: (nombre: string) => `Listo, volviste a tu perfil: ${nombre}.`,
    negocio: (nombre: string) => `Listo, ahora estás como ${nombre}.`,
  },

  /** Nombre del rol, para que "administrador" no aparezca en crudo. */
  roles: {
    propietario: "Dueño",
    administrador: "Administrador",
    editor: "Editor",
    atencion: "Atención al público",
    analista: "Analista",
  },

  /** Etiqueta accesible del control del header. */
  switcherLabel: (nombre: string) => `Estás como ${nombre}. Tocá para cambiar de perfil.`,

  /**
   * La puerta de /perfil, junto a "Editar perfil" / "Verificar" / "Compartir
   * perfil" — donde el cliente lo fue a buscar. Con negocios abre esta MISMA
   * hoja (`sheet` de arriba); sin ninguno, ofrece crear el primero con
   * `sheet.createBusiness` / `createBusinessHint`.
   */
  profileDoor: {
    switchLabel: "Cambiar de perfil",
  },
} as const;
