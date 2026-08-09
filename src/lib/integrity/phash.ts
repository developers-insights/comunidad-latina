/**
 * =============================================================================
 * HUELLA PERCEPTUAL — el núcleo PURO de Content Integrity
 * =============================================================================
 *
 * Sin I/O, sin Supabase, sin `sharp`, sin DOM. Entra una matriz de luminancia y
 * sale una cadena de bits; nada más. Que sea puro es lo que lo hace testeable
 * de verdad: el "near-duplicate se detecta" se prueba acá, con dos matrices,
 * sin levantar una base ni decodificar un JPEG.
 *
 * -----------------------------------------------------------------------------
 * QUÉ ALGORITMO Y POR QUÉ
 * -----------------------------------------------------------------------------
 * pHash clásico por DCT: 32×32 en gris → DCT-II 2D → se conserva el bloque 8×8
 * de BAJA frecuencia → cada coeficiente se compara contra la mediana → 64 bits.
 *
 * La gracia está en el bloque de baja frecuencia: ahí vive la ESTRUCTURA de la
 * imagen (dónde está lo claro y lo oscuro), no el detalle. Por eso sobrevive a
 * recomprimir, reescalar, cambiar de formato o ajustar el brillo —las tres
 * cosas que hacen que el SHA-256 cambie por completo— y por eso una foto
 * distinta da una huella distinta.
 *
 * -----------------------------------------------------------------------------
 * FORMATO DE SALIDA: CADENA DE '0' Y '1', NO UN NÚMERO
 * -----------------------------------------------------------------------------
 * La columna de la base es `bit(64)` / `bit(256)` (migración 0061) y PostgREST
 * la habla como texto de ceros y unos. Un `bigint` de 64 bits no sobrevive a
 * `number` en JS sin perder precisión, y `BigInt` no serializa a JSON. La
 * cadena es exactamente lo que la base espera y no pierde un solo bit.
 *
 * -----------------------------------------------------------------------------
 * LO QUE ESTE MÓDULO NO ES
 * -----------------------------------------------------------------------------
 * Una prueba de autoría. Dos huellas cercanas dicen "estas dos imágenes se
 * parecen", nada más — no dicen quién la hizo, ni si hay licencia, ni si hay
 * infracción. Todo el copy del panel de moderación está escrito con esa
 * limitación adelante, y no es una formalidad: es el pliego.
 */

/** Lado de la matriz de luminancia que entra al DCT. */
export const LUMA_SIZE = 32;

/** Lado del bloque de baja frecuencia que se conserva. */
export const PHASH_BLOCK = 8;

/** Ancho de la huella de imagen, en bits. Espeja `content_assets.phash bit(64)`. */
export const PHASH_BITS = PHASH_BLOCK * PHASH_BLOCK;

/**
 * Cuántos fotogramas entran en la huella de video.
 *
 * 4 no es un número redondo elegido al azar: `content_assets.video_phash` es
 * `bit(256)` y 256 / 64 = 4. El largo FIJO es lo que permite indexar el video
 * con el mismo HNSW que la imagen en vez de necesitar una tabla hija y un join
 * por comparación (razón textual de la migración 0061).
 */
export const VIDEO_FRAMES = 4;

/** Ancho de la huella de video, en bits. Espeja `video_phash bit(256)`. */
export const VIDEO_PHASH_BITS = VIDEO_FRAMES * PHASH_BITS;

/**
 * Tabla de cosenos del DCT-II, calculada una vez por proceso.
 *
 * Solo se necesitan las PHASH_BLOCK primeras frecuencias: el resto del espectro
 * se descarta igual, así que calcularlo sería tirar ciclos. Con esto el DCT 2D
 * separable cuesta 2·32·32·8 ≈ 16k multiplicaciones — despreciable al lado de
 * decodificar la imagen.
 */
const COS = (() => {
  const table = new Float64Array(LUMA_SIZE * PHASH_BLOCK);
  for (let x = 0; x < LUMA_SIZE; x += 1) {
    for (let u = 0; u < PHASH_BLOCK; u += 1) {
      table[x * PHASH_BLOCK + u] = Math.cos(((2 * x + 1) * u * Math.PI) / (2 * LUMA_SIZE));
    }
  }
  return table;
})();

/** Mediana de una copia ordenada. `values` no se modifica. */
function median(values: Float64Array): number {
  const sorted = Float64Array.from(values).sort();
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Huella perceptual de 64 bits de una matriz de luminancia 32×32 (valores 0-255).
 *
 * El bit del coeficiente DC (índice 0) se fuerza a '0' en vez de compararlo
 * contra la mediana. El DC es el brillo PROMEDIO de la imagen: es siempre
 * varios órdenes de magnitud mayor que el resto, así que su bit valdría 1
 * absolutamente siempre y no aportaría información — pero además hace que la
 * mediana se calcule sobre los 63 coeficientes restantes, que es donde está la
 * señal. Un bit constante es un bit que no discrimina; mejor que sea constante
 * a propósito y no por accidente.
 *
 * @throws RangeError si la matriz no es de LUMA_SIZE² valores.
 */
export function phash64(luma: ArrayLike<number>): string {
  if (luma.length !== LUMA_SIZE * LUMA_SIZE) {
    throw new RangeError(
      `phash64 espera ${LUMA_SIZE * LUMA_SIZE} valores de luminancia, recibió ${luma.length}`,
    );
  }

  // DCT separable, paso 1: por filas, quedándonos con las 8 primeras frecuencias.
  const rows = new Float64Array(LUMA_SIZE * PHASH_BLOCK);
  for (let y = 0; y < LUMA_SIZE; y += 1) {
    const rowOffset = y * LUMA_SIZE;
    for (let u = 0; u < PHASH_BLOCK; u += 1) {
      let sum = 0;
      for (let x = 0; x < LUMA_SIZE; x += 1) {
        sum += luma[rowOffset + x] * COS[x * PHASH_BLOCK + u];
      }
      rows[y * PHASH_BLOCK + u] = sum;
    }
  }

  // Paso 2: por columnas sobre el resultado anterior → bloque 8×8.
  const coefficients = new Float64Array(PHASH_BITS);
  for (let u = 0; u < PHASH_BLOCK; u += 1) {
    for (let v = 0; v < PHASH_BLOCK; v += 1) {
      let sum = 0;
      for (let y = 0; y < LUMA_SIZE; y += 1) {
        sum += rows[y * PHASH_BLOCK + u] * COS[y * PHASH_BLOCK + v];
      }
      coefficients[u * PHASH_BLOCK + v] = sum;
    }
  }

  const withoutDc = coefficients.subarray(1);
  const threshold = median(withoutDc);

  let bits = "0"; // DC: constante a propósito (ver el docblock).
  for (let i = 1; i < PHASH_BITS; i += 1) {
    bits += coefficients[i] > threshold ? "1" : "0";
  }
  return bits;
}

/**
 * Huella de video: las huellas de los fotogramas muestreados, concatenadas.
 *
 * Si llegan MENOS de VIDEO_FRAMES fotogramas se repite el último hasta llenar
 * los 256 bits. No es un relleno cosmético: la columna es `bit(256)` y el
 * operador de Hamming exige ancho fijo, así que un video de un solo fotograma
 * útil (un clip cortísimo, o un muestreo que falló a la mitad) tiene que
 * producir una huella válida igual. Repetir el último es la opción que menos
 * distorsiona la distancia entre dos videos parecidos.
 *
 * Devuelve null sin fotogramas: eso NO es "video limpio", es "no se pudo
 * analizar", y quien llama tiene que tratarlo como tal.
 */
export function videoPhash256(frames: ArrayLike<number>[]): string | null {
  if (frames.length === 0) return null;

  const hashes: string[] = [];
  for (const frame of frames.slice(0, VIDEO_FRAMES)) {
    hashes.push(phash64(frame));
  }
  const last = hashes[hashes.length - 1];
  while (hashes.length < VIDEO_FRAMES) hashes.push(last);

  return hashes.join("");
}

/**
 * Distancia de Hamming entre dos huellas: cuántos bits difieren.
 *
 * Es la MISMA métrica que el operador `extensions.<~>` de pgvector que usa la
 * base, y tiene que serlo: si la app y la base midieran distinto, el umbral
 * elegido en un lado significaría otra cosa en el otro.
 *
 * @throws RangeError si las huellas no tienen el mismo ancho — comparar una
 * huella de imagen contra una de video no es "muy distintas", es un bug.
 */
export function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length) {
    throw new RangeError(
      `distancia de Hamming entre huellas de distinto ancho (${a.length} vs ${b.length})`,
    );
  }
  let distance = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) distance += 1;
  }
  return distance;
}

/** ¿Es una cadena de bits del ancho pedido? */
export function isBitString(value: unknown, bits: number): value is string {
  return typeof value === "string" && value.length === bits && /^[01]+$/.test(value);
}

/**
 * Normaliza lo que devuelve PostgREST para una columna `bit(N)`.
 *
 * Los tipos generados la tipan `unknown` (no hay equivalente en TS para `bit`),
 * así que toda lectura pasa por acá en vez de castearse a mano en cada llamada.
 * Devuelve null ante cualquier cosa que no sea una cadena de bits del ancho
 * esperado — incluido el NULL legítimo de "todavía no se analizó".
 */
export function readBitString(value: unknown, bits: number): string | null {
  return isBitString(value, bits) ? value : null;
}
