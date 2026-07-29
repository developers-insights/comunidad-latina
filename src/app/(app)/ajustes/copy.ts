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
    blocked: {
      title: "Cuentas bloqueadas",
      description: "Quiénes no pueden verte ni escribirte.",
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
    admin: {
      title: "Panel de administración",
      description: "Moderación, miembros y configuración de la comunidad.",
    },
  },

  session: {
    as: (email: string) => `Estás en la app como ${email}.`,
    signOut: "Cerrar sesión",
    deleteHint:
      "Eliminar tu cuenta borra tu perfil, tus publicaciones y tus mensajes. No se puede deshacer.",
  },
} as const;
