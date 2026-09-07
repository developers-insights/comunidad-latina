/**
 * =============================================================================
 * NOTAS DE VOZ — lo que se puede decidir sin un navegador delante
 * =============================================================================
 *
 * Módulo PURO a propósito (sin DOM, sin React, sin Supabase): lo importan el
 * grabador, el reproductor y sus tests. Todo lo que toca `MediaRecorder` o
 * `AudioContext` de verdad vive en los componentes; acá están las decisiones
 * que se pueden probar sin abrir un teléfono.
 */

/**
 * ⚠️ EL CODEC ES LA MITAD DE LOS TELÉFONOS, NO UN DETALLE DE CONFIGURACIÓN.
 *
 * `audio/webm;codecs=opus` es lo que sale en todos los ejemplos de MediaRecorder
 * y NO EXISTE en Safari ni en ningún navegador de iOS (todos usan WebKit por
 * política de la App Store, así que "uso Chrome en el iPhone" tampoco salva).
 * Ahí el contenedor es `audio/mp4` con AAC. Pasarle a `new MediaRecorder()` un
 * `mimeType` que el navegador no soporta lanza `NotSupportedError` en el
 * momento de construirlo: el botón del micrófono queda muerto para media
 * comunidad, sin un error visible más que en la consola.
 *
 * Por eso la lista se recorre con `MediaRecorder.isTypeSupported` y no se
 * asume. El orden va del que mejor comprime al que más aguanta.
 *
 * ── LAS DOS COLUMNAS NO SON REDUNDANCIA ─────────────────────────────────────
 * `grabacion` lleva el parámetro `;codecs=…` porque es lo que le da precisión a
 * MediaRecorder. `almacenamiento` es el tipo PELADO, y es el que viaja como
 * Content-Type al bucket y el que se guarda en `adjunto.mime`: la lista
 * `allowed_mime_types` de `chat-media` (0140) tiene `audio/webm`, no
 * `audio/webm;codecs=opus`. Mandar el tipo con parámetros es pedirle a Storage
 * que compare una cadena contra otra que no está en su lista — un 400 al subir
 * un audio que se grabó perfecto.
 *
 * Los tres contenedores de abajo están en esa lista. Agregar uno que no esté es
 * grabar algo que después no se puede subir.
 */
export const CANDIDATOS_DE_GRABACION = [
  { grabacion: "audio/webm;codecs=opus", almacenamiento: "audio/webm" },
  { grabacion: "audio/webm", almacenamiento: "audio/webm" },
  { grabacion: "audio/mp4;codecs=mp4a.40.2", almacenamiento: "audio/mp4" },
  { grabacion: "audio/mp4", almacenamiento: "audio/mp4" },
  { grabacion: "audio/ogg;codecs=opus", almacenamiento: "audio/ogg" },
] as const;

export interface MimeDeGrabacion {
  /** Para `new MediaRecorder(stream, { mimeType })`. Puede traer `;codecs=…`. */
  grabacion: string;
  /** Para el Content-Type de Storage y para `adjunto.mime`. Siempre pelado. */
  almacenamiento: string;
}

/**
 * El primer formato de la lista que este navegador sabe grabar, o `null`.
 *
 * `soporta` se inyecta en vez de leer `MediaRecorder` acá adentro para que la
 * elección se pueda probar sin navegador: los tests le pasan el soporte de
 * Safari, el de Chrome y el de un navegador sin MediaRecorder, y verifican que
 * cada uno reciba lo suyo.
 */
export function elegirMimeDeGrabacion(
  soporta: (mime: string) => boolean,
): MimeDeGrabacion | null {
  for (const candidato of CANDIDATOS_DE_GRABACION) {
    if (soporta(candidato.grabacion)) {
      return {
        grabacion: candidato.grabacion,
        almacenamiento: candidato.almacenamiento,
      };
    }
  }
  return null;
}

/**
 * El soporte real de este navegador, listo para pasarle a `elegirMimeDeGrabacion`.
 * Devuelve `() => false` donde no hay MediaRecorder (iOS < 14.3, navegadores
 * viejos) en vez de romper: quien llama ve `null` y apaga la feature con copy.
 */
export function soporteDeGrabacion(): (mime: string) => boolean {
  if (typeof window === "undefined" || typeof window.MediaRecorder === "undefined") {
    return () => false;
  }
  const recorder = window.MediaRecorder;
  if (typeof recorder.isTypeSupported !== "function") {
    // Existe MediaRecorder pero no la prueba: se deja que el navegador elija su
    // formato por defecto (cadena vacía en `mimeType`) en vez de adivinar.
    return (mime: string) => mime === "";
  }
  return (mime: string) => recorder.isTypeSupported(mime);
}

/** Cuánto puede durar una nota de voz. Más que esto es un audio, no un mensaje. */
export const MAX_DURACION_AUDIO_MS = 5 * 60 * 1000;

/**
 * Picos que se guardan en `adjunto.onda`.
 *
 * 48 no es estético: es lo que entra sin apretarse en una burbuja de 240 px con
 * barras de 2 px y 3 px de aire. Y el arreglo viaja en cada fila de mensaje que
 * la pantalla lee, así que cada pico de más se paga en todas las consultas del
 * hilo, no sólo al reproducir.
 */
export const PICOS_DE_ONDA = 48;

/**
 * La forma del audio, de 0 a 100, para dibujarla SIN bajar el archivo.
 *
 * Se normaliza contra el pico más alto de la propia grabación y no contra 1.0:
 * casi nadie le grita al teléfono, así que en escala absoluta toda nota de voz
 * sería una línea plana del 8%. Normalizada, un susurro y un grito se ven
 * parecido — que es exactamente lo que se quiere de una miniatura.
 *
 * El silencio devuelve ceros de verdad; que una barra vacía igual se vea es
 * decisión de quien la pinta, no de este cálculo.
 */
export function calcularOnda(
  muestras: Float32Array | readonly number[],
  picos: number = PICOS_DE_ONDA,
): number[] {
  const total = muestras.length;
  const cantidad = Math.max(1, Math.floor(picos));
  if (total === 0) return new Array<number>(cantidad).fill(0);

  const crudos = new Array<number>(cantidad).fill(0);
  let maximo = 0;

  for (let i = 0; i < cantidad; i += 1) {
    const desde = Math.floor((i * total) / cantidad);
    const hasta = Math.max(desde + 1, Math.floor(((i + 1) * total) / cantidad));
    let pico = 0;
    for (let j = desde; j < hasta && j < total; j += 1) {
      const valor = Math.abs(muestras[j] ?? 0);
      if (valor > pico) pico = valor;
    }
    crudos[i] = pico;
    if (pico > maximo) maximo = pico;
  }

  if (maximo <= 0) return crudos.map(() => 0);
  return crudos.map((valor) => Math.min(100, Math.round((valor / maximo) * 100)));
}

/** ¿Este arreglo se puede guardar como `adjunto.onda`? Corre en el servidor. */
export function esOndaValida(valor: unknown): valor is number[] {
  return (
    Array.isArray(valor) &&
    valor.length > 0 &&
    valor.length <= 128 &&
    valor.every(
      (pico) => typeof pico === "number" && Number.isInteger(pico) && pico >= 0 && pico <= 100,
    )
  );
}

/** `7000` → `"0:07"`. Nunca negativo, nunca `NaN` en pantalla. */
export function formatearDuracion(ms: number): string {
  const seguros = Number.isFinite(ms) && ms > 0 ? ms : 0;
  const totalSegundos = Math.floor(seguros / 1000);
  const minutos = Math.floor(totalSegundos / 60);
  const segundos = totalSegundos % 60;
  return `${minutos}:${String(segundos).padStart(2, "0")}`;
}

/**
 * Las cuatro velocidades que pidió el cliente, en el orden del ciclo.
 *
 * Arranca en 1 y sube antes de bajar: quien toca el botón casi siempre quiere
 * ir MÁS RÁPIDO (escuchar un audio largo de alguien que habla despacio). Poner
 * 0,75 en segundo lugar obligaría a dar tres toques para llegar a 1,5.
 */
export const VELOCIDADES_DE_REPRODUCCION = [1, 1.5, 2, 0.75] as const;

export type VelocidadDeReproduccion = (typeof VELOCIDADES_DE_REPRODUCCION)[number];

export function siguienteVelocidad(actual: number): VelocidadDeReproduccion {
  const indice = VELOCIDADES_DE_REPRODUCCION.findIndex((v) => v === actual);
  return VELOCIDADES_DE_REPRODUCCION[
    (indice + 1) % VELOCIDADES_DE_REPRODUCCION.length
  ];
}

/** `1.5` → `"1,5×"`. Coma decimal: el público de esta app no escribe 1.5. */
export function etiquetaDeVelocidad(velocidad: number): string {
  const texto = Number.isInteger(velocidad)
    ? String(velocidad)
    : String(velocidad).replace(".", ",");
  return `${texto}×`;
}
