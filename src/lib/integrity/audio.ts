import "server-only";

/**
 * =============================================================================
 * HUELLA ACÚSTICA — fingerprint perceptual de audio, en TypeScript puro
 * =============================================================================
 *
 * Hermano acústico de `phash.ts`: entra PCM mono y sale una cadena de 256 bits
 * que espeja `content_assets.audio_phash bit(256)` (migración 0061, indexada con
 * HNSW `bit_hamming_ops`). Sin I/O, sin dependencias nuevas, sin ffmpeg.
 *
 * -----------------------------------------------------------------------------
 * QUÉ ALGORITMO Y POR QUÉ
 * -----------------------------------------------------------------------------
 * Huella robusta estilo Haitsma-Kalker (el mismo principio que hay abajo de
 * Chromaprint y del "Philips robust hash"), en cuatro pasos:
 *
 *   1. VENTANEO. Frames de AUDIO_FRAME_SIZE muestras con salto de un tercio y
 *      ventana de Hann. El solapamiento es lo que hace que un desplazamiento
 *      pequeño no caiga siempre en el mismo lugar del frame.
 *   2. ESPECTRO. FFT radix-2 iterativa escrita acá (`fftInPlace`) — no hay
 *      librería de por medio, igual que el DCT de `phash.ts`.
 *   3. BANDAS PERCEPTUALES. AUDIO_BANDS bandas LOG-espaciadas entre 150 Hz y
 *      3800 Hz. Log-espaciadas y no lineales porque el oído (y los codecs)
 *      tratan una octava grave con mucho más detalle que una aguda; una banda
 *      lineal de 3 kHz de ancho no significa nada perceptualmente.
 *   4. DOBLE DIFERENCIA Y SIGNO. El clip se parte en AUDIO_SEGMENTS tramos
 *      temporales; de cada tramo sale el log-promedio de energía por banda. El
 *      bit es el SIGNO de la diferencia cruzada:
 *
 *          D(t,b) = [L(t+1,b+1) − L(t+1,b)] − [L(t,b+1) − L(t,b)]
 *
 *      Esa doble diferencia es la clave de todo lo que sigue: derivar en
 *      frecuencia mata cualquier ganancia constante (subir el volumen suma la
 *      MISMA constante a todos los logs y se cancela), y derivar además en el
 *      tiempo mata cualquier ecualización fija (un filtro que siempre realza los
 *      graves suma una constante por banda, y también se cancela). Lo que queda
 *      es cómo CAMBIA la forma del espectro a lo largo del tiempo, que es
 *      justamente lo que sobrevive a recomprimir a otro bitrate o a otro formato
 *      y lo que distingue una grabación de otra.
 *
 * (AUDIO_SEGMENTS − 1) × (AUDIO_BANDS − 1) = 16 × 16 = 256 bits exactos. El
 * ancho FIJO no es capricho: es lo que permite indexar el audio con el mismo
 * HNSW que la imagen y el video en vez de una tabla hija (razón textual de la
 * 0061).
 *
 * -----------------------------------------------------------------------------
 * QUÉ DETECTA Y QUÉ NO — LEER ANTES DE PROMETERLE NADA A NADIE
 * -----------------------------------------------------------------------------
 * DETECTA: que dos archivos de ESTA comunidad contienen sustancialmente el mismo
 * audio aunque hayan sido recomprimidos, cambiados de formato, de bitrate o de
 * volumen. Es decir: reaparición de material propio ya subido.
 *
 * NO DETECTA, y ningún cartel del panel puede sugerir que sí:
 *   · NO identifica catálogo comercial. Esto no dice "esto es tal canción de tal
 *     artista": para eso hace falta un proveedor externo de reconocimiento
 *     musical (AcoustID/MusicBrainz, ACRCloud, Audible Magic) con su base de
 *     millones de huellas. Acá sólo se compara contra lo que ya está en la base
 *     de la propia comunidad.
 *   · NO es prueba de autoría ni de infracción. Dos huellas cercanas dicen "esto
 *     suena igual", nada más — no dicen quién lo grabó ni si hay licencia.
 *   · NO sobrevive a una re-interpretación. Otra versión de la misma canción es
 *     otro audio: la huella va a estar lejos, y está bien que así sea.
 *   · NO alinea temporalmente. Los tramos se reparten sobre la porción analizada,
 *     así que un recorte grande, un fade largo o un intro agregado corren las
 *     fronteras y alejan la huella (los números medidos están en
 *     `audio.test.ts`). Chromaprint resuelve eso con huellas de largo variable y
 *     matching por sub-huellas; una columna `bit(256)` de ancho fijo no puede.
 *
 * -----------------------------------------------------------------------------
 * DE DÓNDE SALEN LAS MUESTRAS (y el precio, dicho en voz alta)
 * -----------------------------------------------------------------------------
 * Mismo patrón que el video, por el mismo motivo: el medio se sube DIRECTO al
 * bucket y el servidor nunca lo tiene abierto, y decodificar mp4/webm/mp3
 * server-side pediría ffmpeg (~70 MB de binario nativo) en una función
 * serverless. Así que quien muestrea es el navegador, que ya tiene un
 * decodificador gratis: `src/lib/media/audio-samples.ts` entrega PCM mono a
 * AUDIO_SAMPLE_RATE Hz y acá se arma la huella.
 *
 * EL PRECIO: las muestras las aporta el cliente, así que un cliente modificado
 * puede mandar PCM que no es el del archivo. Eso NO abre un agujero de autoría,
 * exactamente por las mismas dos razones que en `video.ts`:
 *   · el SHA-256 —el camino que importa legalmente— se calcula SIEMPRE en el
 *     servidor sobre los bytes reales leídos del bucket;
 *   · quien manda muestras falsas sólo consigue no aparecer en una alerta de "se
 *     parece", que es lo mismo que consigue quien re-edita el audio, y contra eso
 *     ninguna huella perceptual puede nada.
 * Está documentado acá y no escondido.
 *
 * `audioPhash256` acepta además bytes WAV/PCM, que es lo que escupiría un worker
 * con ffmpeg (`-f wav -ac 1 -ar 8000`) el día que exista: ese camino no depende
 * del cliente y no tiene esta advertencia.
 *
 * -----------------------------------------------------------------------------
 * EL NULL SIGUE SIENDO HONESTO
 * -----------------------------------------------------------------------------
 * `null` significa "no se analizó", nunca "no tiene coincidencias": audio
 * demasiado corto, silencio digital, muestras inválidas o un contenedor que no
 * se puede decodificar acá. Quien llama tiene que mandarlo a revisión humana,
 * igual que hace `register.ts` con el resto.
 */

/**
 * Versión del algoritmo. Sube de número ante CUALQUIER cambio que altere los
 * bits de salida (bandas, ventana, cantidad de tramos, piso de energía).
 *
 * Existe porque las huellas viejas y las nuevas no son comparables entre sí: una
 * distancia de Hamming entre dos versiones distintas no significa nada. Guardarla
 * es lo que permite regenerar sólo lo que quedó viejo en vez de reindexar todo a
 * ciegas.
 */
export const AUDIO_FINGERPRINT_VERSION = 1;

/** Ancho de la huella, en bits. Espeja `content_assets.audio_phash bit(256)`. */
export const AUDIO_PHASH_BITS = 256;

/**
 * Tasa de muestreo del análisis, en Hz.
 *
 * 8 kHz deja 4 kHz de banda útil, que sobra: la huella vive entre 150 y 3800 Hz,
 * donde está casi toda la energía perceptual de voz y música. Bajar la tasa es
 * además lo que hace que el PCM viaje: a 8 kHz mono son 16 KB por segundo en
 * Int16, contra 176 KB de un CD.
 */
export const AUDIO_SAMPLE_RATE = 8_000;

/**
 * Segundos analizados como máximo, contados desde el principio.
 *
 * Es el mismo tope que usa una consulta de Chromaprint. Más audio no mejora la
 * huella (los tramos se reparten sobre lo analizado igual) y sí encarece el
 * transporte y el FFT.
 */
export const AUDIO_MAX_SECONDS = 120;

/** Muestras por frame de análisis. Potencia de 2: la FFT es radix-2. */
export const AUDIO_FRAME_SIZE = 4096;

/** Salto entre frames: un tercio del frame (66 % de solapamiento). */
export const AUDIO_HOP_SIZE = 1365;

/** Bandas log-espaciadas por frame. 17 bandas → 16 diferencias en frecuencia. */
export const AUDIO_BANDS = 17;

/** Tramos temporales. 17 tramos → 16 diferencias en el tiempo. */
export const AUDIO_SEGMENTS = 17;

/** Techo de muestras analizadas. */
export const AUDIO_MAX_SAMPLES = AUDIO_SAMPLE_RATE * AUDIO_MAX_SECONDS;

/**
 * Piso de muestras: hace falta al menos un frame por tramo temporal.
 *
 * Son 25 936 muestras ≈ 3,24 s a 8 kHz. Por debajo de eso no hay huella (null):
 * un clip de dos segundos daría tramos vacíos y bits que no significan nada, y
 * un bit que no significa nada es peor que no tener huella.
 */
export const AUDIO_MIN_SAMPLES = AUDIO_FRAME_SIZE + (AUDIO_SEGMENTS - 1) * AUDIO_HOP_SIZE;

/** Segundos mínimos de audio analizable. Derivado, para mostrarlo en la UI. */
export const AUDIO_MIN_SECONDS = AUDIO_MIN_SAMPLES / AUDIO_SAMPLE_RATE;

/** ¿Hay extractor de audio disponible? Sí. Lo lee el panel para no mentir. */
export const isAudioFingerprintAvailable = true;

/**
 * Umbral SUGERIDO de distancia de Hamming para "es el mismo audio", en bits.
 *
 * 32 sobre 256 = 87,5 % de bits iguales. No es una intuición: sale de la tabla
 * medida en `audio.test.ts`, donde el mismo audio con ruido, cuantizado a 8 bits
 * y pasado por otro formato y otra tasa nunca superó los 23 bits, y dos audios
 * distintos nunca bajaron de 115. Entre 23 y 115 hay muchísimo aire, y 32 deja
 * margen para material real —que es más sucio que una señal sintética— sin
 * acercarse a la zona de los falsos positivos.
 *
 * OJO AL ENCHUFARLO: hoy `find_similar_content` (0061) recibe UN solo umbral para
 * las tres huellas, y `scan.ts` le pasa DEFAULT_MAX_DISTANCE = 10, que está
 * calibrado sobre los 64 bits de la imagen. Usar este número para el audio pide
 * un umbral por algoritmo, y eso se decide en `scan.ts`, no acá.
 */
export const AUDIO_MAX_DISTANCE = 32;

/* -------------------------------------------------------------------------- */
/* Constantes internas del algoritmo                                          */
/* -------------------------------------------------------------------------- */

/** Extremo grave de la huella. Por debajo hay más zumbido de red que música. */
const BAND_LOW_HZ = 150;

/** Extremo agudo. Deja margen contra la Nyquist de 4 kHz. */
const BAND_HIGH_HZ = 3_800;

/**
 * Piso de energía, como fracción de la energía media de TODO el clip.
 *
 * Sin piso, una banda casi vacía da un logaritmo enorme y negativo y su bit lo
 * decide el ruido: una banda 80 dB por debajo del promedio no tiene contenido
 * musical, tiene el residuo del codec, y su bit se daría vuelta con cualquier
 * recompresión. 1e-2 (−40 dB respecto del promedio) es el valor que mejor midió
 * en `audio.test.ts` —el ruido a −40 dB pasó de 19 bits de diferencia con un piso
 * de 1e-6 a 6 con este— y coincide con el orden de magnitud por debajo del cual
 * los codecs con pérdida directamente descartan información.
 *
 * Que el piso sea RELATIVO al propio clip (y no un número absoluto) es lo que
 * conserva la invarianza a la ganancia: si todo el audio se multiplica por g, la
 * energía media escala por g² y el piso también, así que el logaritmo se corre
 * una constante y la doble diferencia la cancela.
 *
 * Cambiar este número cambia los bits de salida: sube AUDIO_FINGERPRINT_VERSION.
 */
const ENERGY_FLOOR_RATIO = 1e-2;

/** log2(AUDIO_FRAME_SIZE). */
const FFT_BITS = 12;

/** Permutación de bit-reversal, calculada una vez por proceso. */
const REVERSE = (() => {
  const table = new Uint16Array(AUDIO_FRAME_SIZE);
  for (let i = 0; i < AUDIO_FRAME_SIZE; i += 1) {
    let reversed = 0;
    for (let bit = 0; bit < FFT_BITS; bit += 1) {
      reversed |= ((i >> bit) & 1) << (FFT_BITS - 1 - bit);
    }
    table[i] = reversed;
  }
  return table;
})();

/** Twiddles e^{-2πi·k/N}: sólo hace falta medio giro. */
const TWIDDLE_COS = new Float64Array(AUDIO_FRAME_SIZE / 2);
const TWIDDLE_SIN = new Float64Array(AUDIO_FRAME_SIZE / 2);
for (let i = 0; i < AUDIO_FRAME_SIZE / 2; i += 1) {
  const angle = (2 * Math.PI * i) / AUDIO_FRAME_SIZE;
  TWIDDLE_COS[i] = Math.cos(angle);
  TWIDDLE_SIN[i] = Math.sin(angle);
}

/** Ventana de Hann: corta el frame sin el chorreo espectral de un corte seco. */
const HANN = (() => {
  const window = new Float64Array(AUDIO_FRAME_SIZE);
  for (let i = 0; i < AUDIO_FRAME_SIZE; i += 1) {
    window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (AUDIO_FRAME_SIZE - 1)));
  }
  return window;
})();

/**
 * Fronteras de banda, en índices de bin de la FFT.
 *
 * Log-espaciadas: cada banda es un múltiplo constante de la anterior, o sea
 * bandas de ancho parecido en octavas. La corrección final garantiza al menos un
 * bin por banda —una banda vacía daría una división por cero.
 */
const BAND_EDGES = (() => {
  const edges = new Int32Array(AUDIO_BANDS + 1);
  const ratio = BAND_HIGH_HZ / BAND_LOW_HZ;
  for (let i = 0; i <= AUDIO_BANDS; i += 1) {
    const hz = BAND_LOW_HZ * Math.pow(ratio, i / AUDIO_BANDS);
    edges[i] = Math.round((hz * AUDIO_FRAME_SIZE) / AUDIO_SAMPLE_RATE);
  }
  for (let i = 1; i <= AUDIO_BANDS; i += 1) {
    if (edges[i] <= edges[i - 1]) edges[i] = edges[i - 1] + 1;
  }
  return edges;
})();

/* -------------------------------------------------------------------------- */
/* FFT                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * FFT compleja radix-2 de Cooley-Tukey, in place, sobre AUDIO_FRAME_SIZE puntos.
 *
 * Escrita a mano por la misma razón que el DCT de `phash.ts`: es media pantalla
 * de código, no necesita mantenimiento y evita meter una dependencia nueva en la
 * ruta caliente de una publicación. La entrada es real (`im` en cero), así que se
 * calcula el espectro entero y se usa sólo la mitad útil — el doble de trabajo
 * que una FFT real optimizada, y aun así despreciable contra decodificar el
 * medio.
 */
function fftInPlace(re: Float64Array, im: Float64Array): void {
  const n = re.length;

  for (let i = 0; i < n; i += 1) {
    const j = REVERSE[i];
    if (j > i) {
      const tmpRe = re[i];
      re[i] = re[j];
      re[j] = tmpRe;
      const tmpIm = im[i];
      im[i] = im[j];
      im[j] = tmpIm;
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const step = n / len;
    for (let start = 0; start < n; start += len) {
      for (let k = 0; k < half; k += 1) {
        const twiddle = k * step;
        const wRe = TWIDDLE_COS[twiddle];
        const wIm = -TWIDDLE_SIN[twiddle];
        const a = start + k;
        const b = a + half;
        const productRe = re[b] * wRe - im[b] * wIm;
        const productIm = re[b] * wIm + im[b] * wRe;
        re[b] = re[a] - productRe;
        im[b] = im[a] - productIm;
        re[a] += productRe;
        im[a] += productIm;
      }
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Núcleo puro                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Huella acústica de 256 bits a partir de PCM MONO a AUDIO_SAMPLE_RATE Hz.
 *
 * Determinista: la misma entrada da siempre exactamente la misma salida. No hay
 * azar, ni reloj, ni estado entre llamadas.
 *
 * Devuelve null —"no se analizó", nunca "no coincide"— si el audio es más corto
 * que AUDIO_MIN_SAMPLES, si trae algún valor no finito (un NaN envenenaría la
 * FFT en silencio y saldrían 256 bits que no significan nada), si es silencio
 * digital, o si la huella resultante es degenerada (todo ceros coincidiría con
 * cualquier otro silencio).
 *
 * NUNCA lanza.
 */
export function audioPhashFromSamples(samples: ArrayLike<number>): string | null {
  const length = Math.min(samples.length, AUDIO_MAX_SAMPLES);
  if (length < AUDIO_MIN_SAMPLES) return null;

  // Validación en el borde: un solo NaN o Infinity se propaga por toda la FFT.
  let peak = 0;
  for (let i = 0; i < length; i += 1) {
    const value = samples[i];
    if (!Number.isFinite(value)) return null;
    const magnitude = value < 0 ? -value : value;
    if (magnitude > peak) peak = magnitude;
  }
  if (peak === 0) return null; // silencio digital

  const frameCount = 1 + Math.floor((length - AUDIO_FRAME_SIZE) / AUDIO_HOP_SIZE);
  if (frameCount < AUDIO_SEGMENTS) return null;

  // --- Energía por banda y por frame ---------------------------------------
  const energy = new Float64Array(frameCount * AUDIO_BANDS);
  const re = new Float64Array(AUDIO_FRAME_SIZE);
  const im = new Float64Array(AUDIO_FRAME_SIZE);
  let energyTotal = 0;

  for (let frame = 0; frame < frameCount; frame += 1) {
    const offset = frame * AUDIO_HOP_SIZE;
    for (let i = 0; i < AUDIO_FRAME_SIZE; i += 1) {
      re[i] = samples[offset + i] * HANN[i];
      im[i] = 0;
    }
    fftInPlace(re, im);

    for (let band = 0; band < AUDIO_BANDS; band += 1) {
      const from = BAND_EDGES[band];
      const to = BAND_EDGES[band + 1];
      let sum = 0;
      for (let bin = from; bin < to; bin += 1) {
        sum += re[bin] * re[bin] + im[bin] * im[bin];
      }
      // Potencia MEDIA y no total: las bandas agudas son mucho más anchas en
      // bins que las graves, y sin dividir el agudo se comería la comparación.
      const mean = sum / (to - from);
      energy[frame * AUDIO_BANDS + band] = mean;
      energyTotal += mean;
    }
  }

  const floor = (energyTotal / (frameCount * AUDIO_BANDS)) * ENERGY_FLOOR_RATIO;
  if (!Number.isFinite(floor) || floor <= 0) return null;

  // --- Log-promedio por tramo temporal --------------------------------------
  // Los tramos se reparten proporcionalmente sobre lo analizado, igual que el
  // muestreo de fotogramas del video (`media/video-frames.ts`). Promediar
  // LOGARITMOS (media geométrica) y no energías evita que un golpe suelto se
  // coma el tramo entero, y sigue cancelando la ganancia en la doble diferencia.
  const levels = new Float64Array(AUDIO_SEGMENTS * AUDIO_BANDS);
  for (let segment = 0; segment < AUDIO_SEGMENTS; segment += 1) {
    const from = Math.floor((segment * frameCount) / AUDIO_SEGMENTS);
    const to = Math.floor(((segment + 1) * frameCount) / AUDIO_SEGMENTS);
    const count = to - from; // ≥ 1: frameCount ≥ AUDIO_SEGMENTS
    for (let band = 0; band < AUDIO_BANDS; band += 1) {
      let accumulator = 0;
      for (let frame = from; frame < to; frame += 1) {
        accumulator += Math.log(energy[frame * AUDIO_BANDS + band] + floor);
      }
      levels[segment * AUDIO_BANDS + band] = accumulator / count;
    }
  }

  // --- Doble diferencia → 256 bits ------------------------------------------
  let bits = "";
  let ones = 0;
  for (let segment = 0; segment + 1 < AUDIO_SEGMENTS; segment += 1) {
    const current = segment * AUDIO_BANDS;
    const next = (segment + 1) * AUDIO_BANDS;
    for (let band = 0; band + 1 < AUDIO_BANDS; band += 1) {
      const delta =
        levels[next + band + 1] -
        levels[next + band] -
        (levels[current + band + 1] - levels[current + band]);
      if (delta > 0) {
        bits += "1";
        ones += 1;
      } else {
        // El empate exacto cae a '0' A PROPÓSITO: pasa en tramos idénticos
        // (silencio, tono sostenido) y ahí el '0' es estable en los dos
        // archivos, que es lo único que importa para la distancia.
        bits += "0";
      }
    }
  }

  if (ones === 0) return null; // degenerada: coincidiría con cualquier otra
  return bits;
}

/* -------------------------------------------------------------------------- */
/* Bordes: lo que manda el cliente y lo que manda un worker                    */
/* -------------------------------------------------------------------------- */

/**
 * Huella a partir de lo que llegó del navegador, sea lo que sea.
 *
 * Acepta las tres formas en que el PCM puede viajar: un `Float32Array`, un array
 * de números (JSON) o la cadena base64 de Int16 que produce
 * `encodeAudioPcm16` (`media/audio-samples.ts`) — que es la que conviene, porque
 * es la única que no multiplica por diez el tamaño del FormData.
 *
 * Se valida en el borde y no se confía, igual que `isLumaFrame` en `video.ts`:
 * una publicación no se puede caer porque el cliente mandó cualquier cosa.
 * NUNCA lanza.
 */
export function audioPhashFromClientSamples(value: unknown): string | null {
  try {
    const samples = readPcmSamples(value);
    if (!samples) return null;
    return audioPhashFromSamples(samples);
  } catch (error) {
    console.warn("[integrity] no se pudo armar la huella de audio", {
      message: error instanceof Error ? error.message : "error desconocido",
    });
    return null;
  }
}

/** Normaliza las tres formas de PCM aceptadas a un `Float32Array`. Nunca lanza. */
function readPcmSamples(value: unknown): Float32Array | null {
  if (value instanceof Float32Array) return value;
  if (typeof value === "string") return decodeAudioPcm16(value);
  if (Array.isArray(value)) {
    if (value.length < AUDIO_MIN_SAMPLES) return null;
    const samples = new Float32Array(Math.min(value.length, AUDIO_MAX_SAMPLES));
    for (let i = 0; i < samples.length; i += 1) {
      const sample = value[i];
      if (typeof sample !== "number") return null;
      samples[i] = sample;
    }
    return samples;
  }
  return null;
}

/**
 * Decodifica el PCM base64 de Int16 little-endian que produce el navegador.
 *
 * Inversa exacta de `encodeAudioPcm16`. Int16 y no Float32 porque son cuatro
 * veces menos bytes y la cuantización a 16 bits está 90 dB por debajo de
 * cualquier cosa que la huella pueda notar. Devuelve null ante base64 inválido o
 * una longitud impar (que sería un buffer truncado, no audio).
 */
export function decodeAudioPcm16(base64: string): Float32Array | null {
  if (base64.length === 0) return null;
  let bytes: Buffer;
  try {
    bytes = Buffer.from(base64, "base64");
  } catch {
    return null;
  }
  if (bytes.byteLength === 0 || bytes.byteLength % 2 !== 0) return null;

  const total = Math.min(bytes.byteLength / 2, AUDIO_MAX_SAMPLES);
  const samples = new Float32Array(total);
  for (let i = 0; i < total; i += 1) {
    samples[i] = bytes.readInt16LE(i * 2) / 32_768;
  }
  return samples;
}

/**
 * Huella a partir de los BYTES de un archivo de audio.
 *
 * Firma histórica y estable: es la que ya estaba y la que llamaría un worker de
 * transcodificación. Hoy entiende WAV/RIFF con PCM entero o float —o sea,
 * exactamente lo que emite `ffmpeg -f wav`—, lo pasa a mono, lo remuestrea a
 * AUDIO_SAMPLE_RATE y calcula la huella.
 *
 * Un mp3, un m4a o un webm devuelven null: decodificar esos contenedores pide un
 * decodificador nativo, que es justo lo que no entra en una función serverless.
 * Para esos el camino es el navegador (`media/audio-samples.ts`).
 *
 * NUNCA lanza.
 */
export async function audioPhash256(media: Uint8Array): Promise<string | null> {
  try {
    const pcm = decodeWavToMono(media);
    if (!pcm) return null;
    const resampled = resampleMono(pcm.samples, pcm.sampleRate, AUDIO_SAMPLE_RATE);
    return audioPhashFromSamples(resampled);
  } catch (error) {
    console.warn("[integrity] no se pudo decodificar el audio", {
      message: error instanceof Error ? error.message : "error desconocido",
    });
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* WAV                                                                        */
/* -------------------------------------------------------------------------- */

interface DecodedPcm {
  samples: Float32Array;
  sampleRate: number;
}

/** Códigos de `wFormatTag` de RIFF que este decodificador entiende. */
const WAVE_FORMAT_PCM = 1;
const WAVE_FORMAT_IEEE_FLOAT = 3;
const WAVE_FORMAT_EXTENSIBLE = 0xfffe;

/**
 * Decodificador WAV mínimo: recorre los chunks de RIFF, lee `fmt ` y `data`, y
 * mezcla los canales a mono promediándolos.
 *
 * Deliberadamente estricto: cualquier cosa que no sea PCM entero de 8/16/24/32
 * bits o float de 32 bits devuelve null en vez de adivinar. Una huella calculada
 * sobre bytes mal interpretados sería peor que no tener huella.
 */
function decodeWavToMono(media: Uint8Array): DecodedPcm | null {
  if (media.byteLength < 44) return null;

  const view = new DataView(media.buffer, media.byteOffset, media.byteLength);
  if (readTag(view, 0) !== "RIFF" || readTag(view, 8) !== "WAVE") return null;

  let format = 0;
  let channels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let dataOffset = -1;
  let dataLength = 0;

  let cursor = 12;
  while (cursor + 8 <= view.byteLength) {
    const tag = readTag(view, cursor);
    const size = view.getUint32(cursor + 4, true);
    const body = cursor + 8;
    if (size > view.byteLength - body) break; // chunk truncado: se corta acá

    if (tag === "fmt " && size >= 16) {
      format = view.getUint16(body, true);
      channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bitsPerSample = view.getUint16(body + 14, true);
      if (format === WAVE_FORMAT_EXTENSIBLE && size >= 40) {
        // En EXTENSIBLE el formato real vive en los dos primeros bytes del GUID.
        format = view.getUint16(body + 24, true);
      }
    } else if (tag === "data") {
      dataOffset = body;
      dataLength = size;
    }
    cursor = body + size + (size % 2); // los chunks se alinean a 2 bytes
  }

  if (dataOffset < 0 || channels <= 0 || sampleRate <= 0) return null;
  if (format !== WAVE_FORMAT_PCM && format !== WAVE_FORMAT_IEEE_FLOAT) return null;

  const bytesPerSample = bitsPerSample / 8;
  if (!Number.isInteger(bytesPerSample) || bytesPerSample < 1 || bytesPerSample > 4) return null;
  if (format === WAVE_FORMAT_IEEE_FLOAT && bitsPerSample !== 32) return null;

  const frameBytes = bytesPerSample * channels;
  const frames = Math.floor(dataLength / frameBytes);
  if (frames <= 0) return null;

  const samples = new Float32Array(frames);
  for (let frame = 0; frame < frames; frame += 1) {
    let sum = 0;
    for (let channel = 0; channel < channels; channel += 1) {
      sum += readSample(
        view,
        dataOffset + frame * frameBytes + channel * bytesPerSample,
        format,
        bitsPerSample,
      );
    }
    samples[frame] = sum / channels;
  }
  return { samples, sampleRate };
}

/** Una muestra normalizada a [-1, 1]. */
function readSample(view: DataView, offset: number, format: number, bits: number): number {
  if (format === WAVE_FORMAT_IEEE_FLOAT) return view.getFloat32(offset, true);
  switch (bits) {
    // 8 bits en WAV es SIN signo con centro en 128; el resto va con signo.
    case 8:
      return (view.getUint8(offset) - 128) / 128;
    case 16:
      return view.getInt16(offset, true) / 32_768;
    case 24: {
      const raw =
        view.getUint8(offset) | (view.getUint8(offset + 1) << 8) | (view.getInt8(offset + 2) << 16);
      return raw / 8_388_608;
    }
    case 32:
      return view.getInt32(offset, true) / 2_147_483_648;
    default:
      return 0;
  }
}

function readTag(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}

/**
 * Remuestreo a la tasa de análisis.
 *
 * Al BAJAR de tasa promedia la ventana completa de origen en vez de tomar una
 * muestra suelta: ese promedio es un pasabajos crudo, y sin él las frecuencias
 * por encima de la nueva Nyquist se plegarían hacia abajo y ensuciarían justo las
 * bandas que mira la huella. Al SUBIR interpola linealmente, que para este uso
 * alcanza (subir de tasa no agrega información que la huella pueda leer).
 */
function resampleMono(samples: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return samples;
  const ratio = from / to;
  const total = Math.max(0, Math.floor(samples.length / ratio));
  const output = new Float32Array(total);

  if (ratio > 1) {
    for (let i = 0; i < total; i += 1) {
      const start = Math.floor(i * ratio);
      const end = Math.min(samples.length, Math.floor((i + 1) * ratio));
      let sum = 0;
      for (let j = start; j < end; j += 1) sum += samples[j];
      output[i] = end > start ? sum / (end - start) : 0;
    }
    return output;
  }

  for (let i = 0; i < total; i += 1) {
    const position = i * ratio;
    const index = Math.floor(position);
    const fraction = position - index;
    const a = samples[index];
    const b = index + 1 < samples.length ? samples[index + 1] : a;
    output[i] = a + (b - a) * fraction;
  }
  return output;
}
