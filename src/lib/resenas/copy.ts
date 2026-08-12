/**
 * Copy de RESEÑAS DE NEGOCIOS Y PROFESIONALES.
 *
 * La vara de tono es `lib/integrity/declarations.ts`: se dice lo que hay, en
 * primera persona, sin jerga y sin prometer nada que el producto no cumpla.
 *
 * TRES COSAS QUE ESTE COPY NO PUEDE SUAVIZAR:
 *
 *   1. UNA reseña por persona. Se avisa ANTES de escribir, no después de un
 *      error: "ya reseñaste este negocio, podés editarla" es información;
 *      "violación de restricción única" es una puerta en la cara.
 *   2. La reseña es PÚBLICA y lleva el nombre de quien la escribe. Se dice
 *      arriba del formulario, no en una letra chica.
 *   3. Nosotros no verificamos las reseñas. Son opiniones de la comunidad, y el
 *      texto no puede leerse como que la plataforma las avala — el mismo criterio
 *      legal de `verification_checks` (§11).
 */
export const RESENAS_COPY = {
  titulo: "Reseñas",

  /** Vacío honesto, ahora con el camino que sí existe: dejar la primera. */
  vacio: "Todavía nadie dejó una reseña. Si lo conocés, tu opinión le sirve a toda la comunidad.",
  vacioSinCuenta: "Todavía nadie dejó una reseña de este negocio.",

  /* ------------------------------ Resumen -------------------------------- */
  sinPuntaje: "Sin reseñas todavía",
  cantidad: (n: number) => (n === 1 ? "1 reseña" : `${n} reseñas`),
  promedioAria: (promedio: string, n: number) =>
    `${promedio} de 5 estrellas, sobre ${n === 1 ? "1 reseña" : `${n} reseñas`}`,
  distribucionTitulo: "Cómo se reparten los puntajes",
  distribucionFila: (puntaje: number, n: number) =>
    `${puntaje} ${puntaje === 1 ? "estrella" : "estrellas"}: ${n}`,

  /* ---------------------------- Formulario ------------------------------- */
  escribirTitulo: "Dejá tu reseña",
  editarTitulo: "Editá tu reseña",
  aviso: "Se publica con tu nombre y la puede ver cualquiera que abra este negocio.",
  puntajeLabel: "¿Cómo te fue?",
  puntajeAria: (n: number) => `${n} ${n === 1 ? "estrella" : "estrellas"}`,
  puntajePalabra: {
    1: "Muy mal",
    2: "Mal",
    3: "Más o menos",
    4: "Bien",
    5: "Excelente",
  } as Record<number, string>,
  textoLabel: "Contá cómo fue tu experiencia",
  textoPlaceholder: "Ej.: fui por una reparación, me atendieron el mismo día y quedó impecable.",
  textoHelp: "Ayuda más contar qué pasó que decir si estuvo bueno o malo.",
  publicar: "Publicar reseña",
  publicando: "Publicando…",
  guardarCambios: "Guardar cambios",
  cancelar: "Cancelar",
  editar: "Editar mi reseña",
  borrar: "Borrar mi reseña",
  borrando: "Borrando…",
  borrarConfirmar: "¿Borrás tu reseña? No se puede deshacer.",
  yaResenaste: "Ya dejaste tu reseña. Podés editarla cuando quieras.",
  publicada: "Listo, tu reseña ya está publicada.",
  actualizada: "Listo, actualizamos tu reseña.",
  borrada: "Borramos tu reseña.",

  /* --------------------------- Respuesta dueño --------------------------- */
  respuestaTitulo: "Respuesta del negocio",
  responder: "Responder",
  editarRespuesta: "Editar respuesta",
  respuestaLabel: "Tu respuesta",
  respuestaPlaceholder: "Gracias por escribirnos. Sobre lo que contás…",
  respuestaHelp: "La ve todo el mundo, junto a la reseña. Una sola por reseña, y la podés editar.",
  respuestaGuardar: "Publicar respuesta",
  respuestaGuardando: "Publicando…",
  respuestaBorrar: "Quitar respuesta",
  respuestaPublicada: "Publicamos tu respuesta.",

  /* ------------------------------ Reportar ------------------------------- */
  reportar: "Reportar esta reseña",
  reportarTitulo: "¿Qué pasa con esta reseña?",
  reportarLabel: "Contanos qué está mal",
  reportarPlaceholder: "Ej.: no es un cliente, nunca vino al local.",
  reportarEnviar: "Enviar el reporte",
  reportarEnviando: "Enviando…",
  reportada: "Gracias. Lo mira una persona del equipo.",
  reportarNota: "Lo revisa alguien del equipo. Reportar no borra la reseña.",

  /* ------------------------------- Errores ------------------------------- */
  errores: {
    sinPuntaje: "Elegí de una a cinco estrellas para poder publicar.",
    textoLargo: "Se pasó de largo: contalo en menos de 1000 caracteres.",
    sinCuenta: "Necesitás una cuenta para dejar una reseña. Entrá y volvé — te toma un minuto.",
    propioNegocio:
      "No podés reseñar un negocio que administrás. Si querés responderle a alguien, usá el botón de responder.",
    duplicada: "Ya reseñaste este negocio. Editá la que dejaste en vez de publicar otra.",
    noEncontrado: "No encontramos ese negocio en tu comunidad.",
    sinPermisoRespuesta: "Solo el dueño del negocio o su equipo pueden responder una reseña.",
    demasiadas:
      "Dejaste varias reseñas hoy. Para que se puedan leer bien, seguí mañana — gracias por el aguante.",
    motivoRequerido: "Contanos brevemente qué está mal, así el equipo puede revisarlo.",
    generico: "No pudimos guardar tu reseña ahora — no es culpa tuya. Probá de nuevo en un rato.",
  },

  /** Se muestra al pie de la lista. Es la parte que no se puede suavizar. */
  descargo:
    "Las reseñas las escriben personas de la comunidad. No las verificamos ni las respaldamos.",
} as const;
