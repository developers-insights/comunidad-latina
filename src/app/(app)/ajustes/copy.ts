/**
 * Textos de Ajustes. Tono Comunidad Latina: se le habla a la persona, no al
 * sistema. Cada fila dice QUÉ hace, no cómo se llama la tabla.
 */
export const COPY = {
  title: "Ajustes",
  subtitle: "Tu cuenta, tus avisos y cómo se ve la app.",

  identity: {
    viewProfile: "Ver y editar tu perfil",
    signedOut: "Entrá a tu cuenta",
    signedOutHint: "Para publicar, guardar y hablar con la comunidad",
    signIn: "Entrar",
    /**
     * Se dice el nombre, no "modo negocio": lo que la persona necesita saber es
     * con qué NOMBRE va a salir lo que publique. Aparece arriba de todo y sólo
     * cuando está actuando como negocio — cuando está como ella misma, el
     * avatar y su nombre ya lo dicen.
     */
    actingAs: (nombre: string) => `Estás usando la app como ${nombre}`,
    actingAsHint: "Lo que publiques va a salir con el nombre del negocio.",
    switchProfile: "Cambiar de perfil",
  },

  groups: {
    activity: "Tu actividad",
    account: "Tu cuenta",
    privacy: "Privacidad y seguridad",
    preferences: "Preferencias",
    help: "Ayuda y comunidad",
    admin: "Administración",
    session: "Sesión",
  },

  rows: {
    notifications: {
      title: "Notificaciones",
      description: "Todo lo que pasó mientras no estabas.",
    },
    messages: {
      title: "Mensajes",
      description: "Tus conversaciones con la comunidad.",
    },
    saved: {
      title: "Guardados",
      description: "Lo que te guardaste para mirar después.",
    },
    editProfile: {
      title: "Editar tu perfil",
      description: "Tu nombre, tu foto, tu zona y tu bio.",
    },
    verify: {
      title: "Verificar tu identidad",
      description: "La insignia que le da confianza a quien te contacta.",
    },
    verified: {
      title: "Identidad verificada",
      description: "Ya tenés tu insignia. Gracias por cuidar a la comunidad.",
    },
    /**
     * La fila que faltaba: el cliente pidió "para qué tipo de perfil puedan
     * aplicar el tick, el verificado azul" parado en ESTA pantalla, y no había
     * ningún camino de acá a /verificacion. Es OTRA insignia que `verify`/
     * `verified` de arriba (esa es Stripe Identity, gratis) — por eso nunca
     * comparten fila ni copy, aunque las dos empiecen con "verificar".
     */
    checkAzul: {
      title: "El check azul",
      description: "La insignia paga junto a tu nombre. Primero hace falta verificar tu identidad.",
    },
    checkAzulActivo: {
      title: "Tu check azul",
      description: "Ya está activo. Administrá tu plan o tu impulso de regalo.",
    },
    /**
     * Las dos entradas que faltaban (pedido del cliente: «agregar el botón de
     * hacerte creador en la sección de ajustes», «lo mismo para crear una
     * cuenta de negocio»). El camino a creador ya existía completo en
     * /creadores/solicitud pero NADA en la app llevaba ahí: era una pantalla
     * huérfana. Acá sólo se agrega la puerta.
     */
    becomeCreator: {
      title: "Recibí trabajos como creador",
      description: "Postulate a los trabajos que publican los negocios y cobrá por ellos.",
    },
    createBusiness: {
      title: "Crear una cuenta de negocio",
      description: "Un segundo perfil para tu local, dentro de tu misma cuenta.",
    },
    businessAccount: {
      title: "Tu cuenta de negocio",
      description: "Elegí con qué perfil usás la app y administrá tu negocio.",
    },
    blocked: {
      title: "Cuentas bloqueadas",
      description: "Quiénes no pueden verte ni escribirte.",
    },
    privacy_data: {
      title: "Privacidad y datos",
      description: "Qué guardamos, cómo borrarlo y cómo pedir una copia.",
    },
    theme: {
      title: "Tema",
      description: "Claro u oscuro, como te resulte más cómodo.",
    },
    rules: {
      title: "Normas de convivencia",
      description: "Qué se puede publicar y qué no.",
    },
    terms: { title: "Términos del servicio", description: "Las reglas del acuerdo." },
    privacy: {
      title: "Política de privacidad",
      description: "Qué datos guardamos y para qué.",
    },
    // Va DESPUÉS de los tres legales y no antes: los legales se leen, soporte
    // se usa. Lo último de la lista es lo que queda a mano cuando ninguna de
    // las respuestas escritas alcanzó.
    support: {
      title: "Soporte",
      description: "Hablá con una persona del equipo.",
    },
    admin: {
      title: "Panel de administración",
      description: "Moderación, miembros y configuración de la comunidad.",
    },
  },

  session: {
    as: (email: string) => `Estás en la app como ${email}.`,
    signOut: "Cerrar sesión",
    // Tiene que decir la verdad de `0015_account_deletion_fk.sql`: los mensajes y
    // avisos se borran (CASCADE), pero las publicaciones y comentarios quedan sin
    // tu nombre (SET NULL). Prometer que "se borra todo" era falso, y es la clase
    // de promesa que alguien descubre justo cuando ya no puede volver atrás.
    deleteHint:
      "Eliminar tu cuenta borra tu perfil, tus mensajes y tus avisos. Lo que publicaste en el muro queda, pero sin tu nombre. No se puede deshacer.",
  },
} as const;
