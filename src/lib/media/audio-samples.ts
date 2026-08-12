"use client";

/**
 * MUESTREO DE AUDIO EN EL NAVEGADOR — insumo de la huella acústica.
 *
 * Hermano de `video-frames.ts` y por el mismo motivo: toca APIs del navegador,
 * así que vive aparte y NO se re-exporta desde `./index` (un Server Component que
 * importe el barril no puede arrastrarse un módulo que crea un AudioContext).
 *
 * QUÉ HACE: decodifica la pista de audio de un video o de un archivo de audio con
 * la Web Audio API, la mezcla a mono, la remuestrea a AUDIO_SAMPLE_RATE Hz y
 * devuelve el PCM de los primeros AUDIO_MAX_SECONDS segundos. Cero dependencias:
 * el decodificador ya está en el navegador.
 *
 * POR QUÉ ACÁ Y NO EN EL SERVIDOR: el medio se sube DIRECTO al bucket porque no
 * entra en el body de una server action, así que el servidor nunca lo tiene
 * abierto; y decodificar mp4/webm/mp3 allá pediría ffmpeg (~70 MB de binario
 * nativo) en una función serverless. El límite de confianza de esta decisión
 * —que las muestras las aporta el cliente— está documentado en
 * `src/lib/integrity/audio.ts`, y no afecta al SHA-256, que se calcula siempre en
 * el servidor sobre los bytes reales.
 *
 * CÓMO VIAJA: `encodeAudioPcm16` deja el PCM en base64 de Int16 — 16 KB por
 * segundo en binario, ~21 KB por segundo ya en base64, o sea unos 2,6 MB en el
 * peor caso de 120 s. No es poco, y es la razón por la que quien llame a esto
 * debería recortar la duración analizada a lo que su superficie necesite en vez
 * de mandar siempre el máximo. Mandar el `Float32Array` como JSON serían más de
 * 10 MB de texto: por eso el transporte es binario y no un array de números.
 *
 * NUNCA lanza: si no hay Web Audio API, si el archivo no tiene pista de audio, si
 * el códec no se soporta o si la decodificación falla, devuelve null y el
 * pipeline lo trata como "no se pudo analizar" → revisión humana.
 */

/**
 * Espejo de las constantes de `@/lib/integrity/audio`.
 *
 * Están duplicadas y no importadas porque aquel módulo abre con
 * `import "server-only"` y este corre en el navegador. `audio.test.ts` compara
 * los dos juegos de valores y falla si se separan, así que la duplicación no
 * puede quedar desincronizada en silencio.
 */
export const AUDIO_SAMPLE_RATE = 8_000;
export const AUDIO_MAX_SECONDS = 120;
export const AUDIO_MIN_SAMPLES = 4096 + 16 * 1365;

/** Techo de muestras entregadas. */
export const AUDIO_MAX_SAMPLES = AUDIO_SAMPLE_RATE * AUDIO_MAX_SECONDS;

type OfflineAudioContextConstructor = new (
  channels: number,
  length: number,
  sampleRate: number,
) => OfflineAudioContext;

/**
 * PCM mono a AUDIO_SAMPLE_RATE Hz de los primeros AUDIO_MAX_SECONDS segundos.
 *
 * Devuelve null ante cualquier problema —incluido un video mudo, que es un caso
 * normal y no un error—. Nunca lanza.
 */
export async function sampleAudioPcm(file: Blob): Promise<Float32Array | null> {
  const Context = resolveOfflineAudioContext();
  if (!Context) return null;

  try {
    const encoded = await file.arrayBuffer();
    if (encoded.byteLength === 0) return null;

    // El contexto se crea DIRECTAMENTE a la tasa de análisis: `decodeAudioData`
    // remuestrea a la tasa del contexto con un filtro decente, que es mejor que
    // cualquier remuestreo a mano. El `length` de 1 es un mínimo formal — no se
    // renderiza nada, el contexto se usa sólo como decodificador.
    const context = new Context(1, 1, AUDIO_SAMPLE_RATE);
    const decoded = await decodeAudioData(context, encoded);
    if (!decoded || decoded.length === 0 || decoded.numberOfChannels === 0) return null;

    const mono = downmixToMono(decoded);
    const resampled =
      decoded.sampleRate === AUDIO_SAMPLE_RATE
        ? mono
        : resampleMono(mono, decoded.sampleRate, AUDIO_SAMPLE_RATE);

    const total = Math.min(resampled.length, AUDIO_MAX_SAMPLES);
    if (total < AUDIO_MIN_SAMPLES) return null;
    return total === resampled.length ? resampled : resampled.slice(0, total);
  } catch {
    // Sin pista de audio, códec no soportado, archivo corrupto: sin muestras.
    // El servidor lo lee como "no se pudo analizar", nunca como "está limpio".
    return null;
  }
}

/**
 * PCM en base64 de Int16 little-endian, listo para viajar en un FormData.
 *
 * Int16 y no Float32 porque son cuatro veces menos bytes y el error de
 * cuantización queda 90 dB por debajo de cualquier cosa que la huella note.
 * `decodeAudioPcm16` (en `integrity/audio.ts`) es la inversa exacta.
 */
export function encodeAudioPcm16(samples: Float32Array): string {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    // 32767 y no 32768: multiplicar por 32768 desborda el Int16 en el +1 exacto.
    view.setInt16(i * 2, Math.round(clamped * 32_767), true);
  }

  // De a pedazos: `String.fromCharCode(...bytes)` con un array de dos millones
  // de elementos revienta el stack de argumentos del motor.
  const CHUNK = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
  }
  return btoa(binary);
}

/* -------------------------------------------------------------------------- */

function resolveOfflineAudioContext(): OfflineAudioContextConstructor | null {
  if (typeof window === "undefined") return null;
  const candidate = (
    window as unknown as {
      OfflineAudioContext?: OfflineAudioContextConstructor;
      webkitOfflineAudioContext?: OfflineAudioContextConstructor;
    }
  );
  return candidate.OfflineAudioContext ?? candidate.webkitOfflineAudioContext ?? null;
}

/**
 * `decodeAudioData` en sus dos formas: la moderna devuelve una promesa, la de
 * WebKit sólo acepta callbacks. Se prueba la promesa y se cae a los callbacks.
 */
function decodeAudioData(
  context: OfflineAudioContext,
  encoded: ArrayBuffer,
): Promise<AudioBuffer | null> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (buffer: AudioBuffer | null) => {
      if (settled) return;
      settled = true;
      resolve(buffer);
    };

    try {
      const maybePromise = context.decodeAudioData(
        encoded,
        (buffer) => done(buffer),
        () => done(null),
      ) as Promise<AudioBuffer> | undefined;
      if (maybePromise && typeof maybePromise.then === "function") {
        maybePromise.then(done, () => done(null));
      }
    } catch {
      done(null);
    }
  });
}

/** Promedio de todos los canales. Un estéreo con las fases invertidas se anula
 * y queda casi en silencio — el servidor devuelve null y va a revisión, que es
 * el comportamiento correcto para un archivo así. */
function downmixToMono(buffer: AudioBuffer): Float32Array {
  const channels = buffer.numberOfChannels;
  if (channels === 1) return buffer.getChannelData(0);

  const mono = new Float32Array(buffer.length);
  for (let channel = 0; channel < channels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < mono.length; i += 1) mono[i] += data[i];
  }
  for (let i = 0; i < mono.length; i += 1) mono[i] /= channels;
  return mono;
}

/**
 * Red de seguridad por si el navegador NO remuestrea al crear el contexto a
 * 8 kHz. Promedia la ventana de origen al bajar de tasa (pasabajos crudo contra
 * el aliasing) e interpola al subir — mismo criterio que `resampleMono` del lado
 * del servidor, y por eso mismo duplicado: aquel módulo es `server-only`.
 */
function resampleMono(samples: Float32Array, from: number, to: number): Float32Array {
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
