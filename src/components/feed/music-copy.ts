/**
 * Copy de MÚSICA EN PUBLICACIONES (0090) — español cálido, sin jerga.
 * Archivo propio, igual que carousel-copy.ts y viewer-copy.ts: la sección
 * compartida de copy.ts la editan otros módulos en paralelo y acá no hay
 * conflicto posible.
 *
 * Vocabulario, elegido una sola vez y sostenido en todos lados:
 *  - "música", no "audio" ni "track". Es lo que la persona cree que está
 *    haciendo.
 *  - "pista" para hablar de UNA canción del catálogo cuando "música" quedaría
 *    ambiguo ("sacar la música" vs "cambiar de pista").
 *  - "desde el segundo X" en vez de "offset" o "recorte": el control se explica
 *    solo si lo nombramos como lo que hace.
 *  - "escuchar" para la vista previa. "Reproducir" es lo que hace un aparato.
 *
 * Los mensajes de error dicen QUÉ pasó y QUÉ hacer, nunca "algo salió mal".
 */
export const MUSIC_COPY = {
  /* ------------------------------- La fila -------------------------------- */

  /** Fila de acción del composer cuando todavía no hay música. */
  add: "Agregar música",
  /** Ayuda de la fila: qué gana la persona si toca. */
  addHint: "Elegí una canción para que suene en tu publicación",
  /** Botón para sacar la pista ya elegida. */
  remove: "Quitar la música",
  /** Botón para abrir la hoja con una pista ya elegida. */
  change: "Cambiar de canción",

  /* ------------------------------- La hoja -------------------------------- */

  sheetTitle: "Elegí la música",
  /** Encabezado de la lista. */
  listLabel: "Canciones disponibles",
  done: "Listo",
  cancel: "Cancelar",

  /** Botones de escuchar/parar la vista previa de una pista. */
  play: (title: string) => `Escuchar ${title}`,
  stop: (title: string) => `Parar ${title}`,

  /* ------------------------------ El recorte ------------------------------ */

  trimLabel: "¿Desde qué parte de la canción?",
  /** Ayuda del control: cuánto se publica, dicho en segundos redondos. */
  trimHint: (clipSeconds: number) => `Se publican ${clipSeconds} segundos`,
  /** Etiqueta accesible del deslizador. */
  trimSliderLabel: "Segundo en el que arranca la música",
  /** Texto del valor actual: "Desde 0:45". */
  trimValue: (clock: string) => `Desde ${clock}`,
  /**
   * Lo que anuncia el lector de pantalla al mover el deslizador. Dice el tramo
   * completo, no sólo el número, porque un "45" suelto no significa nada.
   */
  trimValueText: (from: string, to: string) => `De ${from} a ${to}`,

  /* ------------------------------- Estados -------------------------------- */

  loading: "Buscando canciones…",
  /**
   * Vacío honesto. La razón real es que todavía no hay música licenciada, y
   * decirlo así —sin echarle la culpa a un "error"— evita que alguien reintente
   * diez veces esperando otro resultado.
   */
  emptyTitle: "Todavía no hay música",
  emptyBody: "Estamos armando la selección de canciones. Muy pronto vas a poder ponerle música a lo que publiques.",

  errorTitle: "No pudimos cargar las canciones",
  errorBody: "Revisá tu conexión y probá de nuevo.",
  retry: "Reintentar",

  /** El guard cortó por sesión vencida. */
  signedOut: "Tu sesión venció. Volvé a entrar para elegir música.",

  /* -------------------------------- Errores ------------------------------- */

  /**
   * La publicación SALIÓ pero la música no se pudo asociar (paso 2 de la
   * secuencia; ver music-actions.ts). Lo primero que dice es la buena noticia:
   * lo que la persona quería —publicar— ya pasó.
   */
  attachFailed: "Tu publicación salió, pero la música quedó afuera. Podés agregarla desde la publicación.",
  /** La pista dejó de estar disponible entre que se eligió y se publicó. */
  trackUnavailable: "Esa canción ya no está disponible. Elegí otra.",
  /** El post no es de esta persona, es de otra comunidad, o lo moderaron. */
  postUnavailable: "No se puede agregar música a esta publicación.",

  /* ------------------- Editar la música ya publicada ---------------------- */

  /**
   * La segunda puerta a la música, y la que vuelve verdadera la promesa de
   * `attachFailed`: desde el ⋯ de la propia publicación. Se dice "de esta
   * publicación" —y no sólo "Música"— porque en esa hoja conviven el texto y
   * las fotos, y el título tiene que decir sobre QUÉ manda cada sección.
   */
  editSectionLabel: "Música de esta publicación",
  /**
   * Se avisa que el cambio ya ocurrió. Esta fila NO espera al botón Guardar
   * —igual que quitar una foto—, así que callarse dejaría a la persona
   * apretando Guardar por algo que ya pasó.
   */
  editAppliedTitle: "Listo, ya suena",
  editAppliedBody: "La música quedó puesta en tu publicación.",
  editRemovedTitle: "Le sacamos la música",
  editRemovedBody: "Tu publicación queda con su sonido de siempre.",
  /** Falló el guardado de la pista: la publicación sigue intacta. */
  editFailed: "No pudimos guardar la música. Probá de nuevo en un momento.",

  /* ------------------------------ La insignia ----------------------------- */

  /** Prefijo accesible de la insignia sobre la publicación. */
  badgeLabel: (title: string, artist: string) => `Música: ${title}, de ${artist}`,
  /** Separador visible entre título y artista. */
  badgeSeparator: " · ",

  /* -------------------------------- Sonido -------------------------------- */

  /**
   * El botón de sonido de una publicación CON música. Dice "la música" y no "el
   * sonido" porque, cuando hay pista, es la música lo que se escucha — el audio
   * propio del video queda silenciado (ver `resolveAudioMix`).
   */
  unmute: "Escuchar la música",
  mute: "Silenciar la música",
} as const;
