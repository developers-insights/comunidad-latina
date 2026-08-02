/**
 * Copy de consentimiento. Todo en un archivo para que se pueda leer entero de
 * una sentada y detectar incoherencias de tono.
 *
 * REGLAS QUE SIGUE ESTE TEXTO
 * ---------------------------
 * El público son familias latinas en EE.UU., muchas sin formación técnica y
 * varias llegando en un momento vulnerable. Entonces:
 *   · Se habla de "lo que guardamos en tu teléfono", no de "tecnologías de
 *     almacenamiento". La palabra "cookie" no significa nada para quien no
 *     programa; se usa sólo donde la ley pide nombrarla.
 *   · Frases cortas (8–14 palabras): a 8 palabras la comprensión es del 100%.
 *   · Nada de "Utilizamos cookies para mejorar su experiencia" — no dice qué
 *     se guarda, ni para qué, ni quién lo ve. Es ruido con forma de aviso.
 *   · Los botones son verbos concretos y simétricos. "Aceptar todo" y
 *     "Rechazar todo" pesan lo mismo, miden lo mismo y están al mismo nivel.
 */

export const CONSENT_COPY = {
  banner: {
    /** Encabezado del banner. Anuncia una decisión, no una notificación. */
    title: "Vos decidís qué guardamos",
    /**
     * El cuerpo dice tres cosas en tres líneas: qué guardamos siempre, qué
     * estamos pidiendo, y que decir que no no rompe nada. Esa última parte es
     * la que la gente necesita oír y casi ningún aviso dice.
     */
    body: "Para que puedas entrar a tu cuenta guardamos lo mínimo en tu teléfono. Ahora queremos usar un poco más, y eso sí te lo preguntamos. Si decís que no, la app funciona igual.",
    acceptAll: "Aceptar todo",
    rejectAll: "Rechazar todo",
    customize: "Elegir una por una",
    /** Se lee en voz alta al abrir el banner con lector de pantalla. */
    ariaLabel: "Tus preferencias de privacidad",
    readPolicy: "Leer la política de cookies",
  },

  preferences: {
    title: "Tus preferencias de privacidad",
    description:
      "Elegí qué puede guardar la app en este teléfono. Podés cambiarlo cuando quieras.",
    save: "Guardar",
    cancel: "Cancelar",
    on: "Sí",
    off: "No",
    always: "Siempre",
    countNone: "Hoy no guardamos nada de esto",
    count: (n: number) => (n === 1 ? "1 cosa guardada" : `${n} cosas guardadas`),
  },

  /** Punto de entrada permanente: pie de página y Ajustes. */
  entry: {
    label: "Privacidad y cookies",
    description: "Mirá qué guardamos y cambialo cuando quieras",
  },

  /** Controles de la pantalla de Ajustes › Privacidad. */
  settings: {
    title: "Privacidad",
    subtitle: "Qué guardamos, dónde, y cómo lo borrás.",

    nothingToConsent: {
      title: "Hoy no hay nada que consentir",
      body: "No usamos herramientas de medición ni de publicidad. Lo único que guardamos en tu teléfono es lo que hace falta para que entres a tu cuenta, más tus preferencias — y eso no sale de acá.",
      cta: "Ver la lista completa",
    },

    decision: {
      title: "Tu decisión",
      /** La fecha importa: es la prueba de cuándo se dio el permiso. */
      savedOn: (date: string) => `Elegiste esto el ${date}.`,
      never: "Todavía no elegiste nada, así que sólo guardamos lo imprescindible.",
      change: "Cambiar mis preferencias",
      revoke: "Volver a preguntarme",
      revoked: "Listo. Te vamos a volver a preguntar.",
    },

    localData: {
      title: "Lo que hay en este teléfono",
      body: "Esto vive solamente en el navegador que estás usando. Nunca lo mandamos a ningún lado, y borrarlo no toca tu cuenta ni tus publicaciones.",
      empty: "Ahora mismo no hay nada guardado en este teléfono.",
      clear: "Borrar de este teléfono",
      cleared: "Borrado. Tu cuenta y tus publicaciones siguen intactas.",
      /** Confirmación: acción no reversible, aunque sea de bajo riesgo. */
      confirmTitle: "¿Borrar lo guardado en este teléfono?",
      confirmBody:
        "Vas a perder tu historial de búsquedas, las guías que bajaste y el modo claro u oscuro que elegiste. Tu cuenta no se toca.",
      confirmCta: "Sí, borrar",
      confirmCancel: "Mejor no",
    },

    rights: {
      title: "Tus derechos",
      body: "Podés pedir una copia de tus datos, corregirlos o borrarlos. Te respondemos dentro de los plazos que marca la ley.",
      exportCta: "Pedir una copia de mis datos",
      deleteCta: "Eliminar mi cuenta",
      doNotSell: "No vendan ni compartan mi información personal",
      doNotSellNote:
        "No vendemos tus datos y no los compartimos con nadie para publicidad. Este enlace existe porque la ley de California te da derecho a pedirlo, y queremos que sepas que la respuesta ya es no.",
    },
  },
} as const;
