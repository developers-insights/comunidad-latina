import "server-only";

/**
 * =============================================================================
 * HUELLA ACÚSTICA — punto de extensión, NO implementado (y por qué)
 * =============================================================================
 *
 * El pliego pide fingerprint de audio "cuando corresponda". Hoy no corresponde,
 * y esta es la razón completa en vez de un TODO:
 *
 * 1. NO HAY CAMINO RAZONABLE SIN BINARIO PESADO. Una huella acústica de calidad
 *    (Chromaprint/AcoustID es el estándar de hecho) necesita decodificar la
 *    pista y calcular un cromagrama. Las dos implementaciones serias son
 *    `fpcalc` (libchromaprint, binario nativo) y ffmpeg — 70+ MB cada una. Eso
 *    no entra cómodo en una función serverless, que es donde corre esto.
 * 2. NO HAY MEDIO CON AUDIO PROPIO EN LA PLATAFORMA. Las superficies que hoy
 *    suben archivos son fotos y videos cortos. Nadie sube un audio suelto, así
 *    que una huella acústica hoy no tendría contra qué compararse.
 * 3. LA COLUMNA YA EXISTE Y ESTÁ INDEXADA. `content_assets.audio_phash bit(256)`
 *    con su índice HNSW está creada en la 0061, y `find_similar_content` ya
 *    tiene su rama de búsqueda por audio. O sea que el día que haya un
 *    extractor, lo único que falta escribir es la función de abajo: ni
 *    migración, ni cambio de contrato, ni reindexado.
 *
 * CUÁNDO SÍ CORRESPONDERÍA: si aparece un módulo de audio (notas de voz
 * publicables, podcasts) o si un worker de transcodificación con ffmpeg pasa a
 * existir para otra cosa. Ahí el trabajo es implementar `audioPhash256` con la
 * misma forma que `videoPhashFromEncodedFrames`: entra el medio, sale una
 * cadena de 256 bits, y el resto del pipeline no se entera.
 *
 * MIENTRAS TANTO, LA HONESTIDAD DEL NULL: `audio_phash = NULL` significa "no se
 * analizó", nunca "no tiene coincidencias" (lo dice el comentario de la columna
 * en la 0061). Ningún cartel del panel de moderación puede decir que un video
 * "no coincide en audio" — porque nadie miró.
 */

/**
 * Huella acústica de 256 bits. Devuelve null SIEMPRE: no hay extractor.
 *
 * Existe para que el pipeline tenga un solo lugar donde preguntar por el audio
 * y para que enchufar el extractor real sea cambiar el cuerpo de esta función.
 */
// El parámetro no se usa HOY y se conserva igual: es la firma que el extractor
// real va a necesitar, y cambiarla después obligaría a tocar a todos los que
// llamen. Mejor una firma estable con un cuerpo honesto.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function audioPhash256(_media: Uint8Array): Promise<string | null> {
  return null;
}

/** ¿Hay extractor de audio disponible? Hoy no. Lo lee el panel para no mentir. */
export const isAudioFingerprintAvailable = false;
