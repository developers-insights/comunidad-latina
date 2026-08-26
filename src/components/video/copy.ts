/**
 * TODO LO QUE SE LEE MIENTRAS UN VIDEO SUBE, SE PROCESA O FALLA.
 *
 * Tres reglas que se siguen en cada línea de este archivo:
 *
 *  1. NUNCA SE NOMBRA A MUX. La persona no contrató un servicio de video: subió
 *     un video a su comunidad. Que atrás haya un proveedor de terceros es un
 *     detalle de nuestra infraestructura, y filtrarlo al texto sólo agrega una
 *     palabra que nadie puede accionar. (Poncho, que es un panel de admin, sí lo
 *     nombra — ahí quien lee es el dueño del producto. Acá no.)
 *  2. NUNCA UN CÓDIGO NI UN ERROR TÉCNICO. Ni "error 500", ni "no se pudo
 *     transcodificar", ni el `message` que venga de la librería. Cada mensaje
 *     dice qué pasó en términos de la persona y qué puede hacer.
 *  3. LA ESPERA SE DICE, NO SE DISIMULA. Un video de varios minutos tarda en
 *     procesarse, y un archivo grande en 4G tarda en subir. Prometer que es
 *     rápido y que después no lo sea es peor que avisar desde el principio.
 */
export const VIDEO_COPY = {
  /**
   * ---- SUBIENDO ------------------------------------------------------------
   *
   * Es la pantalla más importante de todo este flujo: con un archivo grande en
   * 4G, la persona se va a quedar mirando esto un rato largo. Tiene que
   * responder tres preguntas sin que nadie las haga: ¿cuánto va?, ¿se puede
   * cortar?, ¿qué pasa si se me cae el internet?
   */
  subida: {
    /** Título de la barra. El porcentaje va al lado, en su propio elemento. */
    titulo: "Subiendo tu video",
    /**
     * "116 de 340 MB". El porcentaje solo miente sobre el tiempo cuando el
     * archivo es grande: 3 % de 2 GB y 3 % de 20 MB se ven idénticos y no lo
     * son. Los megabytes le dan escala real a la espera.
     *
     * La unidad se dice UNA vez, al final. "116 MB de 340 MB" es correcto y se
     * lee peor: repite la palabra que ya se entendió y hace más largo el
     * renglón justo donde la persona quiere leer dos números de un vistazo.
     */
    avance: (subido: string, total: string) => `${subido} de ${total}`,
    /**
     * Esto es verdad y por eso se dice: UpChunk sube por pedazos y retoma solo.
     * Es la diferencia entre quedarse mirando el teléfono con miedo a moverse y
     * poder guardarlo en el bolsillo.
     */
    tranquilidad: "Podés seguir usando la app. Si se corta el internet, la subida retoma sola.",
    /** Se cortó de verdad: UpChunk avisa y espera. Nada se perdió. */
    sinConexion: "Se cortó el internet. Guardamos lo que ya subiste y seguimos apenas vuelva.",
    /** Volvió. Un renglón, corto, que se va solo cuando el progreso avanza. */
    volvioLaConexion: "Volvió el internet. Seguimos con tu video.",
    /**
     * El botón de cancelar. Dos textos para el mismo control, a propósito:
     *  · el VISIBLE es corto, porque a 375 px comparte renglón con el avance en
     *    megabytes y "Cancelar la subida" empujaría la fila a partirse;
     *  · el ACCESIBLE (aria-label) es la frase entera, porque un lector de
     *    pantalla puede llegar al botón sin haber leído lo que hay alrededor, y
     *    "Cancelar" a secas no dice qué se cancela.
     */
    cancelar: "Cancelar la subida",
    cancelarCorto: "Cancelar",
    /** Después de cancelar. No es un error: la persona lo pidió. */
    cancelada: "Cancelaste la subida. Podés elegir otro video cuando quieras.",
    /**
     * Se agotaron los reintentos. Dice qué revisar y —lo más importante— que no
     * perdió lo que ya había escrito, que es el miedo real en ese momento.
     */
    falloTitulo: "No pudimos terminar de subir tu video",
    falloCuerpo:
      "Revisá tu conexión y probá de nuevo. Lo que escribiste sigue acá, no se borró nada.",
  },

  /**
   * ---- PROCESANDO ----------------------------------------------------------
   *
   * La publicación YA salió. Este es el estado de la tarjeta mientras el video
   * se prepara, y lo ve tanto quien publicó como cualquiera que pase por el
   * feed. Nunca un reproductor vacío, nunca un cuadro negro.
   */
  procesando: {
    titulo: "Estamos preparando este video",
    /** Lo que hay que sacarle de encima a la persona: la obligación de vigilar. */
    cuerpo: "Tarda un ratito. Cuando esté listo aparece solo, no hace falta recargar.",
    /**
     * Se acabó la paciencia del sondeo (15 minutos). No se miente diciendo que
     * ya casi está, y tampoco se declara un fracaso que no sabemos si pasó.
     */
    demoradoTitulo: "Este video está tardando más de lo normal",
    demoradoCuerpo: "Seguí usando la app: va a aparecer acá apenas termine.",
    /** Rótulo del bloque para lectores de pantalla y para el chip de la tarjeta. */
    chip: "Preparando",
  },

  /**
   * ---- FALLÓ ---------------------------------------------------------------
   *
   * El video no se pudo preparar y no se va a reintentar solo. Se dice con todas
   * las letras y con una salida concreta.
   */
  fallo: {
    titulo: "No pudimos preparar este video",
    cuerpo: "Puede que el archivo esté dañado. Probá subirlo otra vez o elegí otro.",
  },

  /** Etiqueta accesible del reproductor cuando no hay nombre de autor a mano. */
  reproductorLabel: "Video de la publicación",
} as const;

type UnidadDeTamaño = { nombre: "KB" | "MB" | "GB"; divisor: number; decimales: number };

/** La unidad en la que conviene leer un tamaño: la que da un número corto. */
function unidadPara(bytes: number): UnidadDeTamaño {
  const kb = 1024;
  const mb = kb * 1024;
  const gb = mb * 1024;
  if (bytes < mb) return { nombre: "KB", divisor: kb, decimales: 0 };
  if (bytes < gb) return { nombre: "MB", divisor: mb, decimales: 0 };
  return { nombre: "GB", divisor: gb, decimales: 1 };
}

function enUnidad(bytes: number, unidad: UnidadDeTamaño): string {
  const factor = 10 ** unidad.decimales;
  return String(Math.round((bytes / unidad.divisor) * factor) / factor);
}

/**
 * "340 MB" · "1.3 GB" · "900 KB". Para el avance de la subida, donde el número
 * tiene que leerse de un vistazo y no ser exacto: nadie necesita saber que son
 * 347.812.480 bytes.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 KB";
  const unidad = unidadPara(bytes);
  return `${enUnidad(bytes, unidad)} ${unidad.nombre}`;
}

/**
 * LOS DOS NÚMEROS DEL AVANCE, EN LA MISMA UNIDAD: "116" y "340 MB".
 *
 * La unidad la fija el TOTAL, no cada número por su cuenta. Si cada uno eligiera
 * la suya, una subida de 2 GB empezaría diciendo "900 KB de 2 GB" y al rato
 * "40 MB de 2 GB": tres unidades distintas en la misma línea, y la persona
 * teniendo que convertir mentalmente para saber si va por la mitad. Con la
 * unidad del total, los dos números son comparables de un vistazo, siempre.
 */
export function formatBytesPair(
  uploadedBytes: number,
  totalBytes: number,
): { subido: string; total: string } {
  const seguros = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);
  const total = seguros(totalBytes);
  const subido = Math.min(seguros(uploadedBytes), total);
  const unidad = unidadPara(total);
  return {
    subido: enUnidad(subido, unidad),
    total: `${enUnidad(total, unidad)} ${unidad.nombre}`,
  };
}
