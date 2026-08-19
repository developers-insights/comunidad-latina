/**
 * Textos de Ajustes › Soporte.
 *
 * Regla de tono de esta pantalla: quien llega acá ya tuvo un problema. No se le
 * cobra con jerga, no se le pide que "genere un ticket" y no se le promete un
 * tiempo de respuesta que después no se cumple. Se le dice a dónde escribir,
 * qué contar, y qué va a pasar después.
 */
export const SOPORTE_COPY = {
  title: "Soporte",
  subtitle: "Contanos qué necesitás y te respondemos por correo.",

  compose: {
    title: "Escribinos",
    body: "Elegí el motivo y contanos en tus palabras. Se abre tu correo con el mensaje ya armado; vos lo revisás antes de mandarlo.",
    topicLabel: "¿Sobre qué es?",
    messageLabel: "Contanos qué pasa",
    messageHelp: "Cuanto más concreto, más rápido te podemos ayudar.",
    counter: (used: number, max: number) => `${used} de ${max}`,
    cta: "Abrir mi correo",
    ctaHint: "Se abre tu app de correo con todo escrito. No se manda solo.",
  },

  direct: {
    title: "O escribinos directo",
    body: "Si tu correo no se abre solo, copiá la dirección y escribinos desde donde te quede cómodo.",
    copy: "Copiar la dirección",
    copied: "Dirección copiada.",
    copyMessage: "Copiar el mensaje",
    copiedMessage: "Mensaje copiado. Pegalo en tu correo.",
    copyFailed: "No pudimos copiar. Podés seleccionar la dirección y copiarla a mano.",
  },

  expectations: {
    title: "Qué pasa después",
    items: [
      "Te contesta una persona del equipo, no un robot.",
      "Solemos responder dentro de las 48 horas, de lunes a viernes.",
      "Si es algo urgente de seguridad, escribinos igual: eso lo miramos primero.",
    ],
  },

  shortcuts: {
    title: "Quizás lo resolvés en un minuto",
    items: [
      {
        href: "/ajustes/privacidad",
        title: "Tus datos y tu privacidad",
        description: "Pedir una copia, borrar lo que guardamos o cambiar quién te ve.",
      },
      {
        href: "/legal/normas",
        title: "Normas de convivencia",
        description: "Qué se puede publicar, y cómo reportamos lo que no corresponde.",
      },
      {
        href: "/perfil",
        title: "Tu perfil",
        description: "Cambiar tu nombre, tu foto, tu zona o tu bio.",
      },
    ],
  },

  privacy:
    "Lo que nos escribas lo usamos solo para responderte. Nunca lo publicamos ni se lo damos a nadie más.",
} as const;
