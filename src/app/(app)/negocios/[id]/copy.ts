/**
 * Copy del PERFIL DE UN NEGOCIO (call del 29/7, 1:05: "si le das ver al
 * negocio… tiene que salir profile del negocio, toda la información del
 * negocio").
 *
 * Vive local al módulo y no en `src/lib/i18n` por la misma razón que el resto
 * de /negocios: son frases de esta pantalla, no del vocabulario compartido.
 *
 * REGLA DE ESTE ARCHIVO: los vacíos dicen la VERDAD y no prometen. Hay dos
 * secciones que el cliente pidió y que la base no puede responder todavía
 * —horarios de atención y reseñas de negocios—; el texto lo dice sin inventar
 * un "próximamente" que nadie se comprometió a cumplir, y ofrece el camino que
 * sí existe (escribirle al negocio).
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
  /**
   * No hay ninguna columna de horarios en el esquema (`business_accounts`
   * guarda categoría, plan y verificación; `listings` no tiene nada del tema).
   * Decirlo así es más útil que un "Lunes a viernes" inventado.
   */
  hoursEmpty: "Este negocio todavía no publicó sus horarios. Escribile y te dice cuándo atiende.",

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
  /** Honesto: no existe tabla de reseñas de negocios (la única es gig_reviews). */
  reviewsEmpty: "Todavía no se pueden dejar reseñas de negocios en la app.",

  photosTitle: "Fotos",
  ownerBanner: "Así ven tu negocio los demás.",
  pendingBanner: "Tu negocio todavía está en revisión: por ahora solo lo ves vos.",
} as const;
