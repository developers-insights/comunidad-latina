/**
 * COPY de COMPARTIR. Local al módulo, como el resto (nunca src/lib/i18n).
 *
 * Tono: español cálido y directo. La idea que ordena todo el panel es que
 * compartir acá no es pasar un link — es acercarle algo a alguien que puede
 * necesitarlo. Por eso "enviar a alguien de la comunidad" va primero y se lee
 * como una conversación, y "compartir afuera" queda como la salida secundaria.
 */
export const SHARE_COPY = {
  /** Etiqueta del botón que abre el panel. Es la misma palabra en toda la app. */
  trigger: "Compartir",
  sheetTitle: "Compartir",
  close: "Cerrar",

  // ── Bloque 1: adentro ─────────────────────────────────────────────────────
  dentroTitle: "Enviar a alguien de la comunidad",
  dentroHint: "Le llega al chat como una tarjeta, lista para abrir.",

  buscarLabel: "Buscar una persona o un grupo",
  // Sin el segundo "un": con él se corta en 375px, que es el ancho donde vive
  // la mitad de la comunidad.
  buscarPlaceholder: "Buscá una persona o grupo",
  buscarLimpiar: "Borrar la búsqueda",
  buscando: "Buscando…",
  buscarVacio: (termino: string) => `No encontramos a nadie con “${termino}”.`,
  buscarError: "No pudimos buscar ahora. Probá de nuevo en un momento.",

  recientesTitle: "Recientes",
  resultadosTitle: "Resultados",

  vacioTitle: "Todavía no hablaste con nadie",
  vacioBody: "Buscá arriba a quién querés mandárselo y empezá la conversación acá.",

  /** Se lee en voz alta al tocar una fila. El estado lo lleva `aria-checked`. */
  seleccionar: (nombre: string) => `Enviar a ${nombre}`,
  grupoMiembros: (cantidad: number) =>
    `${cantidad} ${cantidad === 1 ? "integrante" : "integrantes"}`,

  notaLabel: "Agregá un mensaje (opcional)",
  notaPlaceholder: "Escribile algo…",

  enviar: "Enviar",
  enviarA: (cantidad: number) => `Enviar a ${cantidad}`,
  enviando: "Enviando…",
  seleccionados: (cantidad: number) =>
    cantidad === 1 ? "1 seleccionado" : `${cantidad} seleccionados`,

  // ── Bloque 2: afuera ──────────────────────────────────────────────────────
  afueraTitle: "Compartir afuera",
  afueraHint: "Por WhatsApp, redes o copiando el enlace.",
  /**
   * Corto a propósito: los dos botones van a mitad de ancho y a 375px
   * "Compartir en otras apps" se corta en "Compartir en …", que no dice nada.
   * El encabezado de la sección ya puso el contexto ("Compartir afuera"), así
   * que acá alcanza con nombrar el destino. La etiqueta larga sobrevive en el
   * `aria-label`, que no tiene ancho.
   */
  compartirNativo: "Otras apps",
  compartirNativoLabel: "Compartir en otras apps",
  copiarEnlace: "Copiar enlace",

  // ── Resultados ────────────────────────────────────────────────────────────
  copiadoTitle: "Enlace copiado",
  copiadoBody: "Pegalo donde quieras.",
  copiarErrorTitle: "No pudimos copiar el enlace",
  copiarErrorBody: "Copialo desde la barra de direcciones.",

  enviadoTitle: (cantidad: number) =>
    cantidad === 1 ? "Enviado" : `Enviado a ${cantidad} chats`,
  enviadoBody: "Ya pueden abrirlo desde la conversación.",

  /**
   * Envío a medias. Se dice el número, no el motivo: quién bloqueó a quién y
   * quién dejó un grupo son datos de otra persona, y el panel no los revela.
   */
  parcialTitle: (ok: number, total: number) => `Se envió a ${ok} de ${total}`,
  parcialBody: "Los demás no lo recibieron. Podés intentarlo de nuevo.",

  errorTitle: "No pudimos enviarlo",
  errorBody: "Probá de nuevo en un momento.",
  errorSesionTitle: "Entrá a tu cuenta para enviar",
  errorSesionBody: "Con tu cuenta abierta podés mandárselo a quien quieras.",
  errorLimiteTitle: "Frenemos un toque",
  errorLimiteBody: "Enviaste muchos mensajes seguidos. Probá en un rato.",
} as const;

/**
 * COPY de la TARJETA que se pinta dentro de la burbuja del chat. Vive acá y no
 * en messaging/copy.ts porque es la misma pieza que arma el panel de compartir:
 * si un día cambia cómo se nombra un contenido compartido, cambia en un lugar.
 */
export const SHARED_CARD_COPY = {
  abrir: "Abrir",
  /** Lo que lee un lector de pantalla en el enlace entero de la tarjeta. */
  abrirEtiqueta: (titulo: string) => `Abrir: ${titulo}`,

  /**
   * Se nombra QUÉ era, aunque ya no esté: "esto ya no está disponible" deja a
   * quien lo recibió sin saber si perdió un departamento o un video.
   *
   * El texto es el MISMO cuando el contenido se borró y cuando quien mira no
   * puede verlo, a propósito: distinguirlos confirmaría que existe algo privado.
   */
  noDisponible: {
    post: "Esta publicación ya no está disponible",
    listing: "Este aviso ya no está disponible",
    job: "Este empleo ya no está disponible",
    business: "Este negocio ya no está disponible",
    video: "Este video ya no está disponible",
    profile: "Este perfil ya no está disponible",
    group: "Este grupo ya no está disponible",
  },
  noDisponibleBody: "Puede que lo hayan eliminado o cerrado.",

  /** Qué es lo que se compartió, para que la tarjeta se lea sola. */
  etiqueta: {
    post: "Publicación",
    listing: "Aviso",
    job: "Empleo",
    business: "Negocio",
    video: "Video",
    profile: "Perfil",
    group: "Grupo",
  },

  sinTitulo: {
    post: "Publicación de la comunidad",
    video: "Video de la comunidad",
    profile: "Miembro de la comunidad",
    group: "Grupo de la comunidad",
  },

  /**
   * Lo que se lee en la bandeja como último mensaje. Escrito entero por tipo y
   * no armado con `${etiqueta} compartida`: en español el participio concuerda,
   * y esa plantilla produce "Empleo compartida".
   */
  resumen: {
    post: "Compartió una publicación",
    listing: "Compartió un aviso",
    job: "Compartió un empleo",
    business: "Compartió un negocio",
    video: "Compartió un video",
    profile: "Compartió un perfil",
    group: "Compartió un grupo",
  },
} as const;
