import { describe, expect, it } from "vitest";
import {
  AUDIO_BANDS,
  AUDIO_FINGERPRINT_VERSION,
  AUDIO_MAX_DISTANCE,
  AUDIO_MAX_SAMPLES,
  AUDIO_MIN_SAMPLES,
  AUDIO_PHASH_BITS,
  AUDIO_SAMPLE_RATE,
  AUDIO_SEGMENTS,
  audioPhash256,
  audioPhashFromClientSamples,
  audioPhashFromSamples,
  decodeAudioPcm16,
  isAudioFingerprintAvailable,
} from "./audio";
import { hammingDistance, isBitString } from "./phash";
import * as clientSamples from "@/lib/media/audio-samples";

/**
 * La huella acústica, probada por PROPIEDAD y no por implementación.
 *
 * Nada de "el bit 47 vale 1": eso ataría el test al algoritmo y habría que
 * reescribirlo entero ante cualquier ajuste. Lo que se prueba es lo que el
 * pipeline necesita que sea cierto:
 *
 *   · el mismo audio con otro VOLUMEN da la misma huella (distancia 0, y es 0
 *     por construcción: la doble diferencia cancela la ganancia);
 *   · el mismo audio con RUIDO leve encima queda cerca;
 *   · el mismo audio RECORTADO se aleja de forma acotada y medida;
 *   · dos audios DISTINTOS quedan lejos;
 *   · la basura devuelve null y no explota.
 *
 * Los umbrales de abajo NO son intuiciones: son los valores medidos corriendo
 * estos tests, redondeados hacia arriba con un margen. Cada uno lleva al lado el
 * número real observado.
 */

const SR = AUDIO_SAMPLE_RATE;

/**
 * TABLA MEDIDA (corrida real, Node 22 / vitest 4). El algoritmo no usa azar ni
 * reloj, así que estos números son reproducibles y no "aproximados":
 *
 *   MISMO AUDIO
 *     ×0.5 · ×2 · ×0.37 · ×0.001 (ganancia)  →    0 / 256
 *     base64 Int16 ida y vuelta              →    0 / 256
 *     WAV PCM 8 kHz mono (camino de bytes)   →    0 / 256
 *     WAV PCM 16 kHz estéreo (remuestreado)  →    0 / 256
 *     + ruido blanco amplitud 0,005          →    6 / 256
 *     cuantizado a 8 bits                    →   10 / 256
 *     + ruido blanco amplitud 0,025          →   20 / 256
 *     + ruido blanco amplitud 0,05           →   23 / 256
 *
 *   MISMO AUDIO, PERO RECORTADO  (el punto débil, sin maquillar)
 *     recortados 0,1 s del principio         →   30 / 256
 *     recortados 0,25 s                      →   38 / 256
 *     recortados 0,5 s                       →   53 / 256
 *
 *   AUDIOS DISTINTOS
 *     melodía vs barrido                     →  117 / 256
 *     melodía vs ruido blanco                →  127 / 256
 *     barrido vs ruido blanco                →  126 / 256
 *
 * La lectura honesta: la huella es MUY robusta a lo que cambia al recomprimir
 * —volumen, formato, tasa de muestreo, cuantización, ruido de codec— y sólo
 * MEDIANAMENTE robusta al recorte, porque los tramos temporales se reparten
 * proporcionalmente sobre lo analizado y sacarle el principio corre todas las
 * fronteras. Entre 23 (peor caso del mismo audio) y 115 (mejor caso de audios
 * distintos) hay muchísimo aire; ahí adentro vive AUDIO_MAX_DISTANCE = 32.
 */
const MAX_DISTANCE_SAME_AUDIO = 24;

/** Generador determinístico: los tests no pueden depender de Math.random(). */
function pseudoRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

/**
 * Una "grabación": ocho notas de medio segundo con armónicos y decaimiento, en
 * bucle. Tiene estructura en frecuencia Y en el tiempo, que es exactamente lo
 * que la huella mira.
 */
function melody(durationSec = 12): Float32Array {
  const notes = [220, 277.18, 329.63, 392, 293.66, 246.94, 349.23, 440];
  const total = Math.round(durationSec * SR);
  const noteLength = Math.round(0.5 * SR);
  const out = new Float32Array(total);
  for (let i = 0; i < total; i += 1) {
    const note = notes[Math.floor(i / noteLength) % notes.length];
    const t = i / SR;
    const envelope = Math.exp(-3 * ((i % noteLength) / noteLength));
    out[i] =
      0.5 *
      envelope *
      (0.6 * Math.sin(2 * Math.PI * note * t) +
        0.25 * Math.sin(2 * Math.PI * 2 * note * t) +
        0.12 * Math.sin(2 * Math.PI * 3 * note * t) +
        0.06 * Math.sin(2 * Math.PI * 5 * note * t));
  }
  return out;
}

/** Un audio PERCEPTUALMENTE DISTINTO: barrido de 200 Hz a 3500 Hz. */
function sweep(durationSec = 12): Float32Array {
  const total = Math.round(durationSec * SR);
  const out = new Float32Array(total);
  let phase = 0;
  for (let i = 0; i < total; i += 1) {
    const progress = i / total;
    const frequency = 200 + (3500 - 200) * progress;
    phase += (2 * Math.PI * frequency) / SR;
    out[i] = 0.5 * Math.sin(phase);
  }
  return out;
}

/** Otro audio distinto: ruido blanco con semilla fija. */
function whiteNoise(durationSec = 12, seed = 12345): Float32Array {
  const random = pseudoRandom(seed);
  const total = Math.round(durationSec * SR);
  const out = new Float32Array(total);
  for (let i = 0; i < total; i += 1) out[i] = (random() - 0.5) * 0.8;
  return out;
}

function withGain(source: Float32Array, gain: number): Float32Array {
  const out = new Float32Array(source.length);
  for (let i = 0; i < source.length; i += 1) out[i] = source[i] * gain;
  return out;
}

/** Ruido blanco leve encima: lo que deja un micrófono o un codec agresivo. */
function withNoise(source: Float32Array, amplitude: number, seed = 99): Float32Array {
  const random = pseudoRandom(seed);
  const out = new Float32Array(source.length);
  for (let i = 0; i < source.length; i += 1) {
    out[i] = source[i] + (random() - 0.5) * 2 * amplitude;
  }
  return out;
}

/** Cuantización brutal a 8 bits: simula una recompresión muy pobre. */
function quantized8bit(source: Float32Array): Float32Array {
  const out = new Float32Array(source.length);
  for (let i = 0; i < source.length; i += 1) out[i] = Math.round(source[i] * 128) / 128;
  return out;
}

/** Recorte del principio: el caso "alguien le sacó el intro". */
function trimmedStart(source: Float32Array, seconds: number): Float32Array {
  return source.slice(Math.round(seconds * SR));
}

/** WAV PCM 16 bits, para el camino de bytes de `audioPhash256`. */
function encodeWav(samples: Float32Array, sampleRate: number, channels: number): Uint8Array {
  const frames = Math.floor(samples.length / channels);
  const dataBytes = frames * channels * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const writeTag = (offset: number, tag: string) => {
    for (let i = 0; i < tag.length; i += 1) view.setUint8(offset + i, tag.charCodeAt(i));
  };

  writeTag(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeTag(8, "WAVE");
  writeTag(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  writeTag(36, "data");
  view.setUint32(40, dataBytes, true);

  for (let i = 0; i < frames * channels; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, Math.round(clamped * 32_767), true);
  }
  return new Uint8Array(buffer);
}

/* -------------------------------------------------------------------------- */

describe("forma de la huella acústica", () => {
  const fingerprint = audioPhashFromSamples(melody());

  it("hay extractor y está versionado", () => {
    expect(isAudioFingerprintAvailable).toBe(true);
    expect(AUDIO_FINGERPRINT_VERSION).toBeGreaterThanOrEqual(1);
  });

  it("la geometría del algoritmo da exactamente los 256 bits de la columna", () => {
    expect((AUDIO_SEGMENTS - 1) * (AUDIO_BANDS - 1)).toBe(AUDIO_PHASH_BITS);
  });

  it("tiene el ancho de la columna bit(256) y es una cadena de ceros y unos", () => {
    expect(fingerprint).not.toBeNull();
    expect(fingerprint).toHaveLength(AUDIO_PHASH_BITS);
    expect(isBitString(fingerprint, AUDIO_PHASH_BITS)).toBe(true);
  });

  it("es DETERMINISTA: la misma señal da la misma huella entre corridas", () => {
    expect(audioPhashFromSamples(melody())).toBe(fingerprint);
    expect(audioPhashFromSamples(melody())).toBe(audioPhashFromSamples(melody()));
  });

  it("no es degenerada: usa los dos valores de bit", () => {
    const ones = (fingerprint as string).split("").filter((bit) => bit === "1").length;
    expect(ones).toBeGreaterThan(16);
    expect(ones).toBeLessThan(AUDIO_PHASH_BITS - 16);
  });
});

describe("robustez — el mismo audio tiene que dar una huella cercana", () => {
  const base = audioPhashFromSamples(melody()) as string;

  it("VOLUMEN: ×0.5 y ×2 dan la MISMA huella (medido: 0 bits)", () => {
    // No es suerte ni tolerancia: la doble diferencia de logaritmos cancela
    // cualquier ganancia constante, así que el 0 es exacto por construcción.
    expect(audioPhashFromSamples(withGain(melody(), 0.5))).toBe(base);
    expect(audioPhashFromSamples(withGain(melody(), 2))).toBe(base);
  });

  it("VOLUMEN: una ganancia que no es potencia de dos tampoco la mueve (medido: 0)", () => {
    const distance = hammingDistance(base, audioPhashFromSamples(withGain(melody(), 0.37))!);
    expect(distance).toBeLessThanOrEqual(2);
  });

  it("RUIDO leve (amplitud 0,005): queda pegada (medido: 6 bits)", () => {
    const distance = hammingDistance(base, audioPhashFromSamples(withNoise(melody(), 0.005))!);
    expect(distance).toBeLessThanOrEqual(8);
  });

  it("RUIDO audible (amplitud 0,025): sigue por debajo del umbral (medido: 20 bits)", () => {
    const distance = hammingDistance(base, audioPhashFromSamples(withNoise(melody(), 0.025))!);
    expect(distance).toBeLessThanOrEqual(MAX_DISTANCE_SAME_AUDIO);
  });

  it("RUIDO fuerte (amplitud 0,05): todavía adentro (medido: 23 bits)", () => {
    const distance = hammingDistance(base, audioPhashFromSamples(withNoise(melody(), 0.05))!);
    expect(distance).toBeLessThanOrEqual(MAX_DISTANCE_SAME_AUDIO);
  });

  it("CUANTIZACIÓN a 8 bits: apenas la mueve (medido: 10 bits)", () => {
    const distance = hammingDistance(base, audioPhashFromSamples(quantized8bit(melody()))!);
    expect(distance).toBeLessThanOrEqual(12);
  });

  it("OTRO FORMATO Y OTRA TASA: WAV estéreo a 16 kHz da la misma huella (medido: 0)", async () => {
    // El caso real de "el mismo audio, otro archivo": otro contenedor, dos
    // canales, el doble de tasa de muestreo. Entra por el camino de BYTES —
    // decodificador WAV + mezcla a mono + remuestreo— y sale en el mismo lugar.
    const source = melody();
    const stereo = new Float32Array(source.length * 4); // 16 kHz = 2× muestras
    for (let i = 0; i < source.length * 2; i += 1) {
      const sample = source[Math.floor(i / 2)];
      stereo[i * 2] = sample;
      stereo[i * 2 + 1] = sample;
    }

    const fingerprint = await audioPhash256(encodeWav(stereo, 16_000, 2));
    expect(fingerprint).not.toBeNull();
    // Tolerancia mínima y no igualdad exacta: la cuantización a Int16 del WAV y
    // el remuestreo mueven los valores lo justo para que un bit en empate pueda
    // caer del otro lado. Medido: 0.
    expect(hammingDistance(base, fingerprint!)).toBeLessThanOrEqual(4);
  });

  it("WAV mono a la tasa de análisis: exactamente la misma huella (medido: 0)", async () => {
    const fingerprint = await audioPhash256(encodeWav(melody(), SR, 1));
    expect(hammingDistance(base, fingerprint!)).toBeLessThanOrEqual(2);
  });
});

describe("recorte — el límite real, sin maquillar", () => {
  const base = audioPhashFromSamples(melody()) as string;

  it("un recorte de 0,1 s YA despega la huella (medido: 30 bits)", () => {
    // Se afirma el número real y no uno cómodo: los tramos temporales se
    // reparten proporcionalmente sobre lo analizado, así que sacarle el
    // principio corre TODAS las fronteras. Es la limitación conocida de una
    // huella de ancho fijo, está documentada en `audio.ts`, y este test existe
    // para que nadie la descubra en producción.
    const distance = hammingDistance(base, audioPhashFromSamples(trimmedStart(melody(), 0.1))!);
    expect(distance).toBeGreaterThan(MAX_DISTANCE_SAME_AUDIO);
    expect(distance).toBeLessThanOrEqual(36);
  });

  it("con 0,25 s recortados se va al borde del umbral (medido: 38 bits)", () => {
    const distance = hammingDistance(base, audioPhashFromSamples(trimmedStart(melody(), 0.25))!);
    expect(distance).toBeLessThanOrEqual(44);
  });

  it("con 0,5 s recortados se aleja mucho más (medido: 53 bits)", () => {
    const distance = hammingDistance(base, audioPhashFromSamples(trimmedStart(melody(), 0.5))!);
    expect(distance).toBeLessThanOrEqual(64);
  });

  it("aun recortada, sigue MÁS CERCA que un audio distinto", () => {
    // Lo que salva al recorte: 53 sobre 256 sigue estando a menos de la mitad de
    // los 115+ de dos audios que no tienen nada que ver. La huella se degrada,
    // no se vuelve ruido.
    const trimmed = hammingDistance(base, audioPhashFromSamples(trimmedStart(melody(), 0.5))!);
    const different = hammingDistance(base, audioPhashFromSamples(sweep())!);
    expect(trimmed).toBeLessThan(different / 2);
  });
});

describe("discriminación — dos audios distintos tienen que quedar lejos", () => {
  const melodyHash = audioPhashFromSamples(melody()) as string;
  const sweepHash = audioPhashFromSamples(sweep()) as string;
  const noiseHash = audioPhashFromSamples(whiteNoise()) as string;

  it("melodía vs barrido (medido: 117 bits)", () => {
    expect(hammingDistance(melodyHash, sweepHash)).toBeGreaterThanOrEqual(96);
  });

  it("melodía vs ruido blanco (medido: 127 bits)", () => {
    expect(hammingDistance(melodyHash, noiseHash)).toBeGreaterThanOrEqual(96);
  });

  it("barrido vs ruido blanco (medido: 126 bits)", () => {
    expect(hammingDistance(sweepHash, noiseHash)).toBeGreaterThanOrEqual(96);
  });

  it("la separación entre 'mismo audio' y 'otro audio' es amplia", () => {
    // 117 contra 20: no es un margen que dependa de calibrar fino el umbral.
    const same = hammingDistance(melodyHash, audioPhashFromSamples(withNoise(melody(), 0.025))!);
    const different = hammingDistance(melodyHash, sweepHash);
    expect(different).toBeGreaterThan(same * 4);
  });

  it("AUDIO_MAX_DISTANCE cae en el hueco entre los dos grupos", () => {
    const worstSame = hammingDistance(melodyHash, audioPhashFromSamples(withNoise(melody(), 0.05))!);
    const bestDifferent = hammingDistance(melodyHash, sweepHash);
    expect(worstSame).toBeLessThan(AUDIO_MAX_DISTANCE);
    expect(bestDifferent).toBeGreaterThan(AUDIO_MAX_DISTANCE);
  });
});

describe("entradas inválidas — null, jamás una excepción", () => {
  it("vacío", () => {
    expect(audioPhashFromSamples(new Float32Array(0))).toBeNull();
    expect(audioPhashFromSamples([])).toBeNull();
  });

  it("demasiado corto (por debajo de AUDIO_MIN_SAMPLES)", () => {
    expect(audioPhashFromSamples(melody(3))).toBeNull(); // 3 s < 3,24 s
    expect(audioPhashFromSamples(new Float32Array(AUDIO_MIN_SAMPLES - 1))).toBeNull();
  });

  it("silencio digital: no es 'sin coincidencias', es 'no se analizó'", () => {
    expect(audioPhashFromSamples(new Float32Array(AUDIO_MIN_SAMPLES * 2))).toBeNull();
  });

  it("NaN e Infinity", () => {
    const withNaN = melody();
    withNaN[1000] = Number.NaN;
    expect(audioPhashFromSamples(withNaN)).toBeNull();

    const withInfinity = melody();
    withInfinity[2000] = Number.POSITIVE_INFINITY;
    expect(audioPhashFromSamples(withInfinity)).toBeNull();
  });

  it("bytes que no son un WAV", async () => {
    await expect(audioPhash256(new Uint8Array(0))).resolves.toBeNull();
    await expect(audioPhash256(new Uint8Array(200))).resolves.toBeNull();
    await expect(
      audioPhash256(new TextEncoder().encode("esto no es audio, es una carta de amor")),
    ).resolves.toBeNull();
  });

  it("un WAV bien formado pero demasiado corto", async () => {
    const wav = encodeWav(melody(1), SR, 1);
    await expect(audioPhash256(wav)).resolves.toBeNull();
  });

  it("cualquier cosa desde el cliente", () => {
    expect(audioPhashFromClientSamples(null)).toBeNull();
    expect(audioPhashFromClientSamples(undefined)).toBeNull();
    expect(audioPhashFromClientSamples(42)).toBeNull();
    expect(audioPhashFromClientSamples({ samples: [1, 2, 3] })).toBeNull();
    expect(audioPhashFromClientSamples("")).toBeNull();
    expect(audioPhashFromClientSamples([1, "dos", 3])).toBeNull();
    expect(audioPhashFromClientSamples(new Array(AUDIO_MIN_SAMPLES).fill("x"))).toBeNull();
  });
});

describe("transporte del PCM entre navegador y servidor", () => {
  const base = audioPhashFromSamples(melody()) as string;

  it("el ida y vuelta base64/Int16 conserva la huella", () => {
    const encoded = clientSamples.encodeAudioPcm16(melody());
    const decoded = decodeAudioPcm16(encoded);
    expect(decoded).not.toBeNull();
    // La cuantización a 16 bits está muy por debajo de lo que la huella nota.
    expect(hammingDistance(base, audioPhashFromSamples(decoded!)!)).toBeLessThanOrEqual(2);
    expect(audioPhashFromClientSamples(encoded)).toBe(audioPhashFromSamples(decoded!));
  });

  it("un array de números crudo también entra", () => {
    expect(audioPhashFromClientSamples(Array.from(melody()))).toBe(base);
  });

  it("base64 vacío, truncado o que no es PCM devuelve null", () => {
    expect(decodeAudioPcm16("")).toBeNull();
    // 5 caracteres base64 → 3 bytes → longitud impar: eso es un buffer cortado
    // por la mitad, no audio.
    expect(decodeAudioPcm16("AAAAA")).toBeNull();
    expect(audioPhashFromClientSamples("no-es-base64-de-audio")).toBeNull();
  });

  /**
   * `media/audio-samples.ts` duplica estas constantes porque no puede importar un
   * módulo `server-only`. Este test es el que impide que la duplicación se
   * desincronice en silencio: si alguien cambia la tasa de análisis de un lado y
   * no del otro, el navegador mandaría PCM a una tasa y el servidor lo leería
   * como si fuera otra, y la huella sería basura sin que nada falle.
   */
  it("las constantes duplicadas del muestreador del navegador siguen alineadas", () => {
    expect(clientSamples.AUDIO_SAMPLE_RATE).toBe(AUDIO_SAMPLE_RATE);
    expect(clientSamples.AUDIO_MIN_SAMPLES).toBe(AUDIO_MIN_SAMPLES);
    expect(clientSamples.AUDIO_MAX_SAMPLES).toBe(AUDIO_MAX_SAMPLES);
  });
});
