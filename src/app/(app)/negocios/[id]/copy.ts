/**
 * Copy del PERFIL DE UN NEGOCIO (call del 29/7, 1:05: "si le das ver al
 * negocio… tiene que salir profile del negocio, toda la información del
 * negocio").
 *
 * Vive local al módulo y no en `src/lib/i18n` por la misma razón que el resto
 * de /negocios: son frases de esta pantalla, no del vocabulario compartido.
 *
 * REGLA DE ESTE ARCHIVO: los vacíos dicen la VERDAD y no prometen.
 *
 * HISTORIA, PORQUE EXPLICA EL TONO: hasta la migración 0093 había dos secciones
 * que el cliente pidió y que la base no podía responder —horarios de atención y
 * reseñas de negocios—, y el texto lo decía sin inventar un "próximamente" que
 * nadie se había comprometido a cumplir. Esas tablas ya existen, así que el
 * copy dejó de hablar de una limitación del producto y pasó a hablar de un
 * negocio que todavía no cargó sus datos. El tono no cambió: se sigue diciendo
 * lo que hay y se sigue ofreciendo el camino que sí existe.
 *
 * El copy fino de las dos secciones vive en `lib/horarios/copy.ts` y
 * `lib/resenas/copy.ts`, porque lo comparten Negocios y Profesionales. Acá
 * quedan los títulos, que son de esta pantalla.
 */
export const BUSINESS_PROFILE_COPY = {
  fallbackTitle: "Negocio",
  verified: "Presencia verificada",
  verifiedHint: "Comunidad Latina confirmó que este negocio existe.",

  aboutTitle: "Sobre el negocio",
  aboutEmpty: "Todavía no escribió una descripción.",

  whereTitle: "Dónde queda",
  whereEmpty: "Todavía no publicó su dirección.",

  hoursTitle: "Horarios de atención",

  contactTitle: "Cómo contactarlo",
  contactFree:
    "Escribile por el chat de Comunidad Latina: tu número queda protegido hasta que vos quieras compartirlo.",
  messagePlaceholder: "Hola, quería consultarte por…",
  messageLabel: "Escribir al negocio",

  publisherTitle: "Quién lo publica",
  externalSourceNote: "Publicado desde una fuente externa, sin cuenta en la comunidad.",

  postsTitle: "Publicaciones",
  postsEmpty: "Todavía no publicó nada en la comunidad.",
  postsMore: "Ver todas las publicaciones",

  reviewsTitle: "Reseñas",

  /**
   * La puerta al editor de la página (0127). "Editar la página" y no "editar
   * el aviso": para el dueño esto es su perfil de negocio, no una publicación
   * clasificada — es la palabra que usó el cliente («editar la información de
   * la otra cuenta»).
   */
  editCta: "Editar la página",

  photosTitle: "Fotos",
  ownerBanner: "Así ven tu negocio los demás.",
  pendingBanner: "Tu negocio todavía está en revisión: por ahora solo lo ves vos.",
} as const;
