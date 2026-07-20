/**
 * Copy del Asistente Comunitario — español cálido, directo, sin jerga (§ux-writing).
 * NUNCA "Chatbot IA": se nombra por la comunidad ("Asistente de Queens, NY").
 * El disclaimer legal es FIJO y no se negocia (encuadre §11 del plan).
 */
export const ASSISTANT_COPY = {
  header: {
    title: (city: string) => `Asistente de ${city}`,
    subtitle: "Respuestas con fuente verificada, de tu propia comunidad.",
  },

  /** Disclaimer FIJO, siempre visible bajo el header. */
  disclaimer:
    "Te comparto información de fuentes oficiales con su enlace. No doy consejos legales — para tu caso puntual, hablá con un profesional verificado.",

  hero: {
    title: "Preguntame lo que necesites sobre vivir acá.",
    subtitle:
      "Busco en las guías y en los datos verificados de tu comunidad, y siempre te muestro de dónde sale la respuesta.",
    tryLabel: "Probá con:",
  },

  /** Preguntas sugeridas — resuelven el "blank page problem" (§4.e). */
  suggestions: [
    "¿Cómo saco mi ITIN?",
    "¿Dónde encuentro vivienda sin crédito?",
    "¿Cómo alquilo con seguridad?",
    "¿Qué hago si me para ICE?",
  ],

  input: {
    placeholder: "Escribí tu pregunta…",
    send: "Enviar pregunta",
    label: "Tu pregunta para el asistente",
  },

  typing: "El asistente está buscando en las fuentes verificadas…",

  sources: {
    heading: "De dónde sale esto",
  },

  feedback: {
    question: "¿Te sirvió esta respuesta?",
    up: "Sí, esta respuesta me sirvió",
    down: "No, esta respuesta no me sirvió",
    thanks: "¡Gracias por avisarnos!",
  },

  anon: {
    remaining: (n: number) =>
      n === 1
        ? "Te queda 1 pregunta de prueba."
        : `Te quedan ${n} preguntas de prueba.`,
    limitTitle: "Creá tu cuenta para seguir preguntando",
    limitBody:
      "Las primeras preguntas van por casa. Con tu cuenta gratis seguís preguntando sin límite y guardás lo que encuentres.",
    limitCta: "Crear mi cuenta gratis",
    limitSecondary: "Ya tengo cuenta",
    /** Burbuja del asistente cuando el invitado agota sus 3 preguntas. */
    limitBubble:
      "Me encantaría seguir ayudándote. Creá tu cuenta gratis — tarda menos de un minuto — y seguimos justo donde quedamos.",
  },

  errors: {
    generic:
      "Algo no cargó bien de nuestro lado — no es tu culpa. Probá de nuevo en un momento.",
    rateLimit:
      "Hiciste varias preguntas seguidas y necesito un respiro corto. Esperá unos minutos y seguimos — mientras tanto podés mirar las guías.",
    tooShort: "Contame un poquito más para poder buscarte una buena respuesta.",
  },

  /** Card de entrada discreta en /feed. */
  entry: {
    title: "Preguntale al Asistente",
    description:
      "Respuestas al toque desde las guías y datos verificados de tu comunidad — siempre con la fuente.",
  },
} as const;
