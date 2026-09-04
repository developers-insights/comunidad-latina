import { normalizeDeclaredDuration } from "./video-policy";

/**
 * ABRIR EL VIDEO EN EL NAVEGADOR, ANTES DE SUBIR UN BYTE.
 *
 * El tope de 90 s tiene que rebotar ANTES de la subida: el archivo va directo
 * del navegador al bucket (hasta 200 MB de video contra una conexión de
 * teléfono), así que enterarse al publicar sería gastarle los datos a la persona
 * para después decirle que no. Y sin esta medición la publicación fallaría
 * igual, pero contra el CHECK `posts_video_declaration` de la base — un error de
 * Postgres no es un mensaje para nadie.
 *
 * Cómo se mide: un `<video>` fuera del documento apuntando a un `blob:` del
 * archivo. El navegador baja sólo la cabecera del contenedor, no el archivo
 * entero. Nunca lanza: si algo falla devuelve null y quien llama decide (el
 * composer rechaza — duración desconocida no se publica).
 *
 * ---- Y DE PASO, EL POSTER (0132) -----------------------------------------
 *
 * Desde el 2026-09-03 esta misma apertura saca UN FOTOGRAMA. Es la razón por la
 * que las dos cosas viven en la misma función y no en dos módulos: abrir el
 * archivo es lo caro —un `<video>` decodificando 200 MB en un teléfono de gama
 * media—, y hacerlo dos veces para preguntarle dos cosas distintas al mismo
 * archivo sería pagar ese precio al pepe.
 *
 * Para qué sirve el fotograma: el reel, la tarjeta y el visor sirven el `.mp4`
 * CRUDO desde el bucket (Mux está apagado), así que hasta que llega la metadata
 * el `<video>` no tiene NADA que pintar — el rectángulo en blanco que reportó el
 * cliente ("cuando uno está scrolleando salen en blanco"). Con un `poster` esa
 * espera muestra el primer cuadro del propio video en vez de un hueco.
 */

/** Techo de espera. Un contenedor raro no puede dejar el botón colgado. */
const METADATA_TIMEOUT_MS = 15_000;

/**
 * Techo de espera del SEEK y del dibujo del fotograma. Más corto que el de la
 * metadata a propósito: acá el archivo ya se abrió bien, así que si además de
 * eso el `seeked` no llega, no es un formato lento sino algo roto — y el poster
 * es una mejora, nunca un motivo para dejar a alguien esperando.
 */
const POSTER_TIMEOUT_MS = 6_000;

/**
 * Segundo del que se saca el fotograma. No es 0 a propósito: muchísimos videos
 * arrancan con un cuadro negro o con el obturador todavía ajustando, y un poster
 * negro es indistinguible de no tener poster. Un pelín adentro ya hay imagen de
 * verdad, y sigue estando dentro del primer segundo, así que el salto es
 * instantáneo incluso en un archivo largo. Mismo criterio (y mismo número) que
 * `video-poster.ts` usa para las miniaturas del selector de filtros.
 */
const POSTER_AT_SECONDS = 0.3;

/**
 * Lado largo del poster, en píxeles. 720 cubre un teléfono a 3x sin engordar:
 * el poster se pinta mientras el video carga, así que un archivo pesado acá
 * competiría por el ancho de banda con el video que está tapando — que es
 * exactamente el problema que vino a resolver.
 */
const POSTER_MAX_SIDE = 720;

/** Calidad del JPEG. 0.72 deja el poster típico en 40–90 KB. */
const POSTER_QUALITY = 0.72;

export interface VideoIntro {
  /** Duración normalizada por la política, o null si no se pudo medir. */
  durationSeconds: number | null;
  /**
   * Primer cuadro como JPEG, o null si el navegador no pudo decodificarlo.
   * NULL NO ES UN ERROR: la publicación sigue igual y la superficie cae a su
   * respaldo. Un códec raro puede costar un poster; nunca una publicación.
   */
  poster: Blob | null;
}

/**
 * Duración + poster en UNA sola apertura del archivo.
 *
 * `wantPoster` existe porque hay un caso donde el fotograma no sirve para nada:
 * por la ruta de Mux el poster lo genera Mux (`muxThumbnailUrl`), así que
 * sacarlo acá sería decodificar el archivo de más para tirar el resultado.
 */
export async function readVideoIntro(
  file: File,
  { wantPoster = true }: { wantPoster?: boolean } = {},
): Promise<VideoIntro> {
  const vacio: VideoIntro = { durationSeconds: null, poster: null };
  if (typeof document === "undefined" || typeof URL.createObjectURL !== "function") {
    return vacio;
  }

  const objectUrl = URL.createObjectURL(file);
  const video = document.createElement("video");

  try {
    const durationSeconds = await new Promise<number | null>((resolve) => {
      let settled = false;
      const finish = (value: number | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };

      const timer = setTimeout(() => finish(null), METADATA_TIMEOUT_MS);

      // `metadata` y no `auto`: alcanza para la duración y para el primer
      // fotograma, y evita que elegir un archivo se lleve 200 MB de memoria.
      video.preload = "metadata";
      video.muted = true;
      // Algunos WebView de iOS no emiten loadedmetadata sin esto.
      video.playsInline = true;
      video.onloadedmetadata = () => finish(normalizeDeclaredDuration(video.duration));
      video.onerror = () => finish(null);
      video.src = objectUrl;
    });

    /**
     * Sin metadata no hay fotograma que buscar: si el navegador no pudo abrir el
     * contenedor, tampoco va a poder dibujarlo. Se corta acá en vez de esperar
     * seis segundos a un `seeked` que no va a llegar.
     */
    const poster =
      wantPoster && durationSeconds !== null ? await drawPosterFrame(video) : null;

    return { durationSeconds, poster };
  } catch {
    // El contrato es NUNCA LANZAR: quien llama decide qué hacer con los nulos.
    return vacio;
  } finally {
    // Soltar el archivo: sin esto el elemento sigue reteniendo el blob entero.
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(objectUrl);
  }
}

/**
 * Sólo la duración. Sigue existiendo con esta firma porque es lo único que
 * necesitan las superficies que no suben nada, y porque su contrato —número o
 * null, nunca lanza— ya está anclado por los tests de la política de video.
 */
export async function readVideoDurationSeconds(file: File): Promise<number | null> {
  const { durationSeconds } = await readVideoIntro(file, { wantPoster: false });
  return durationSeconds;
}

/**
 * El fotograma, ya como JPEG. Todo lo que puede salir mal acá termina en null:
 * un canvas sin contexto, un `seeked` que no llega, un video sin dimensiones
 * (audio disfrazado de video), o un `toBlob` que el navegador no implementa.
 */
async function drawPosterFrame(video: HTMLVideoElement): Promise<Blob | null> {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) return null;

  try {
    // Si el video dura menos que el offset, se saca el primer cuadro que haya.
    const target = Number.isFinite(video.duration)
      ? Math.min(POSTER_AT_SECONDS, Math.max(video.duration - 0.05, 0))
      : POSTER_AT_SECONDS;
    if (target > 0) {
      await waitForSeek(video, target);
    }

    // Se ACHICA manteniendo la proporción: el poster tiene que calzar sobre el
    // video que tapa, y un recorte cuadrado (lo que hace `video-poster.ts` para
    // los chips de filtro) mostraría un encuadre que no es el del video.
    const scale = Math.min(1, POSTER_MAX_SIDE / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    if (typeof canvas.toBlob !== "function") return null;
    return await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((blob) => resolve(blob), "image/jpeg", POSTER_QUALITY);
    });
  } catch {
    return null;
  }
}

/** Mueve el reloj y espera el `seeked`, con techo. Rechaza en vez de colgar. */
function waitForSeek(video: HTMLVideoElement, seconds: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("El video no llegó al fotograma a tiempo"));
    }, POSTER_TIMEOUT_MS);

    function cleanup() {
      clearTimeout(timer);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
    }
    function onSeeked() {
      cleanup();
      resolve();
    }
    function onError() {
      cleanup();
      reject(new Error("El navegador no pudo decodificar el video"));
    }

    video.addEventListener("seeked", onSeeked, { once: true });
    video.addEventListener("error", onError, { once: true });
    video.currentTime = seconds;
  });
}
