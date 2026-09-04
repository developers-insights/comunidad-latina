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
    /**
     * Nombre accesible de la lista, no un título visible: arriba ya está el
     * <h1> "Tus negocios" y repetirlo veinte píxeles más abajo era ruido. Lleva
     * el número porque con tope de diez "cuántos tengo" es una pregunta real, y
     * así el lector de pantalla la contesta al entrar en la lista.
     */
    heading: (cantidad: number) =>
      cantidad === 1 ? "Tu negocio" : `Tus ${cantidad} negocios`,

    /**
     * CON QUÉ PERFIL ESTÁS ACTUANDO — una sola vez, arriba de la lista.
     *
     * Antes esta frase vivía DENTRO de cada tarjeta, así que con nueve negocios
     * inactivos se leía nueve veces la misma oración sobre el perfil personal.
     * Es un dato de la persona, no de cada negocio: se dice una vez y listo. La
     * tarjeta activa sólo se marca a sí misma, para poder encontrarla.
     */
    usingPersonal: (nombre: string) => `Ahora publicás como ${nombre}, tu perfil personal.`,
    usingBusiness: (nombre: string) => `Ahora publicás como ${nombre}.`,

    /**
     * Marca en la tarjeta activa. Es un LOCALIZADOR —"cuál de las diez"—, no la
     * explicación: esa la da entera la frase de arriba ("Ahora publicás como
     * Panadería La Esperanza."). Corta a propósito para que entre en la misma
     * línea que el chip de verificación en una tarjeta de 299px.
     */
    activeNow: "En uso ahora",

    /**
     * Etiqueta del botón. Corta a propósito: el nombre del negocio ya está en
     * la tarjeta, y "Usar la app como Panadería Doña Rosa del Barrio" no entra
     * en un botón de 291px sin desbordar la pantalla. El nombre completo sigue
     * viajando en el `aria-label`, que es donde hace falta para no tener diez
     * botones que suenan igual.
     */
    useIt: "Usar este perfil",
    useItAria: (nombre: string) => `Usar la app como ${nombre}`,
    /**
     * La puerta al editor de la página (0127). Corta, como `useIt`, y con el
     * nombre completo en el `aria-label`: con diez negocios en la pantalla,
     * diez botones que suenan igual no le sirven a nadie.
     */
    edit: "Editar la página",
    editAria: (nombre: string) => `Editar la página de ${nombre}`,
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
