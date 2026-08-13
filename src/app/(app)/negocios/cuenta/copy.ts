/**
 * Textos de "Cuenta de negocio". Regla que manda: la persona tiene que entender
 * que sigue siendo UNA sola cuenta con dos perfiles, no dos usuarios distintos.
 * Nada de "modo", nada de "entidad", nada de "perfil B2B".
 */
export const COPY = {
  title: "Cuenta de negocio",
  subtitle:
    "Un segundo perfil para tu local o tu emprendimiento, dentro de tu misma cuenta.",

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
    nameLabel: "Nombre del negocio",
    namePlaceholder: "Panadería La Esperanza",
    nameHint: "Es el nombre con el que va a aparecer en la comunidad.",
    categoryLabel: "Rubro",
    categoryHint: "Opcional. Ayuda a que te encuentren.",
    categoryEmpty: "Elegí un rubro",
    submit: "Crear mi cuenta de negocio",
    submitting: "Creando…",
  },

  /** Ya la tiene. */
  card: {
    heading: "Tu negocio",
    roleLabel: "Tu rol",
    activeNow: "Estás usando la app con este perfil.",
    inactiveNow: "Ahora estás usando la app con tu perfil personal.",
    useIt: (nombre: string) => `Usar la app como ${nombre}`,
    backToPersonal: "Volver a mi perfil personal",
    switching: "Cambiando…",
  },

  /** Lo que se puede hacer después. Cada uno lleva a algo que existe hoy. */
  next: {
    heading: "Siguientes pasos",
    listingTitle: "Publicá la ficha de tu negocio",
    listingBody: "Dirección, horarios y fotos, para que te encuentren en Negocios.",
    presenceTitle: "Presencia Verificada",
    presenceBody: "El plan que le da a tu negocio prioridad y la insignia de verificado.",
  },

  ok: {
    created: (nombre: string) =>
      `Listo, ${nombre} ya es tu cuenta de negocio. Todavía estás publicando con tu perfil personal: cuando quieras, cambiá desde acá o desde tu foto.`,
  },

  errors: {
    signedOut: "Entrá a tu cuenta para crear tu cuenta de negocio.",
    nombreCorto: "Escribí el nombre de tu negocio.",
    nombreLargo: "El nombre es muy largo: probá con uno de hasta 60 caracteres.",
    yaExiste:
      "Ya tenés una cuenta de negocio en esta comunidad. Podés usarla desde acá mismo.",
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
