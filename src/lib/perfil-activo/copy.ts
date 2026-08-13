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
    manage: "Administrar tu cuenta de negocio",
    changing: "Cambiando…",
    error: "No pudimos cambiar de perfil. Probá de nuevo en un momento.",
  },

  /** Cómo se anuncia el cambio, ya hecho. */
  toast: {
    personal: (nombre: string) => `Listo, volviste a tu perfil: ${nombre}.`,
    negocio: (nombre: string) => `Listo, ahora estás como ${nombre}.`,
  },

  /** Aviso permanente mientras se actúa como negocio. */
  banner: {
    title: (nombre: string) => `Estás usando la app como ${nombre}`,
    body: "Lo que publiques va a salir con el nombre del negocio.",
    switchBack: "Volver a tu perfil",
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
} as const;
