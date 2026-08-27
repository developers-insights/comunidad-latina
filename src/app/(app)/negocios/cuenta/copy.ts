/**
 * Textos de "Cuenta de negocio". Regla que manda: la persona tiene que entender
 * que sigue siendo UNA sola cuenta con dos perfiles, no dos usuarios distintos.
 * Nada de "modo", nada de "entidad", nada de "perfil B2B".
 */
export const COPY = {
  title: "Tus negocios",
  subtitle:
    "Perfiles para tus locales o emprendimientos, dentro de tu misma cuenta.",

  /** Antes de tenerla: qué es y qué gana. */
  intro: {
    title: "¿Qué es una cuenta de negocio?",
    body: "Es el perfil con el que tu negocio se muestra en la comunidad. Publicás con el nombre del local en vez del tuyo, y cambiás de un perfil al otro cuando quieras — sin cerrar sesión y sin una cuenta nueva.",
    bullets: [
      "Publicás y respondés con el nombre de tu negocio.",
      "Tu perfil personal queda igual: nadie ve una cosa mezclada con la otra.",
      "Cambiás de perfil desde tu foto, arriba a la derecha.",
    ],
  },

  form: {
    legend: "Datos de tu negocio",
    /** Encabezado cuando ya hay al menos uno: no es "el" negocio, es otro más. */
    legendOtro: "Agregar otro negocio",
    nameLabel: "Nombre del negocio",
    namePlaceholder: "Panadería La Esperanza",
    nameHint: "Es el nombre con el que va a aparecer en la comunidad.",
    categoryLabel: "Rubro",
    categoryHint: "Opcional. Ayuda a que te encuentren.",
    categoryEmpty: "Elegí un rubro",
    submit: "Crear mi cuenta de negocio",
    submitting: "Creando…",
  },

  /**
   * Cuántos lugares quedan. En positivo, y sólo cuando ya tiene al menos uno:
   * a quien todavía no creó ninguno, "podés crear 10" no le resuelve nada.
   */
  slots: {
    left: (restantes: number, tope: number) =>
      restantes === 1
        ? `Te queda 1 negocio más (de ${tope}).`
        : `Te quedan ${restantes} negocios más (de ${tope}).`,
    fullTitle: (tope: number) => `Llegaste al máximo de ${tope} negocios`,
    fullBody:
      "Es el máximo por comunidad. Podés seguir usando y administrando los que ya tenés.",
  },

  /** Ya tiene al menos uno. */
  card: {
    heading: "Tus negocios",
    roleLabel: "Tu rol",
    activeNow: "Estás usando la app con este perfil.",
    inactiveNow: "Ahora estás usando la app con tu perfil personal.",
    useIt: (nombre: string) => `Usar la app como ${nombre}`,
    backToPersonal: "Volver a mi perfil personal",
    switching: "Cambiando…",
  },

  /**
   * Lo que se puede hacer después. Cada uno lleva a algo que existe hoy.
   *
   * "Publicá la ficha de tu negocio" (→ /publicar?kind=business) se sacó: desde
   * la 0116 la ficha se crea sola con la cuenta, así que ese link llevaba a un
   * formulario que la policy `listings_insert` iba a rechazar por duplicado.
   * Un siguiente paso que sólo puede terminar en error no es un siguiente paso.
   */
  next: {
    heading: "Siguientes pasos",
    presenceTitle: "Presencia Verificada",
    presenceBody: "El plan que le da a tu negocio prioridad y la insignia de verificado.",
  },

  ok: {
    created: (nombre: string) =>
      `Listo, ${nombre} ya es una de tus cuentas de negocio. Todavía estás publicando con tu perfil personal: cuando quieras, cambiá desde acá o desde tu foto.`,
  },

  /**
   * Verificación POR PERFIL (0121). Acá sólo se ANUNCIA y se enlaza: el flujo
   * entero vive en /perfil/verificar, que es una sola pantalla para las dos
   * identidades. Repetirlo sería tener dos lugares donde verificarse.
   */
  verificacion: {
    heading: "Verificación",
    verified: "Identidad verificada",
    pending: "Sin verificar todavía",
    hint: "Cada negocio se verifica por separado. Es lo que te habilita a vender.",
    cta: "Verificar mis perfiles",
  },

  errors: {
    signedOut: "Entrá a tu cuenta para crear tu cuenta de negocio.",
    nombreCorto: "Escribí el nombre de tu negocio.",
    nombreLargo: "El nombre es muy largo: probá con uno de hasta 60 caracteres.",
    /**
     * El tope, dicho igual que en el cambiador. Sin callejón sin salida: no
     * manda a borrar nada porque dar de baja un negocio no tiene pantalla hoy.
     */
    tope: (tope: number) =>
      `Llegaste al máximo de ${tope} negocios en esta comunidad. Podés seguir usando los que ya tenés.`,
    generico:
      "Algo no salió bien de nuestro lado — no es tu culpa. Probá de nuevo en un momento.",
  },

  /** Sin sesión. */
  signedOut: {
    title: "Entrá para crear tu cuenta de negocio",
    body: "Tu negocio vive dentro de tu cuenta: primero entrás, después lo creás.",
    cta: "Entrar",
  },
} as const;

/** Largo máximo del nombre — se espeja en el schema del server. */
export const MAX_NOMBRE_NEGOCIO = 60;
