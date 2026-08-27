/**
 * QUÉ FOTO SE PUEDE ELEGIR DEL DISCO — y qué se le dice a alguien cuando no.
 *
 * Pedido del cliente (2026-08-26): "el mismo problema con los videos grandes o
 * el tipo de formato de video pasa con las imágenes". El video ya acepta
 * cualquier cosa porque sube directo a Mux, que transcodifica; la foto rebotaba
 * por dos puertas distintas —el TIPO y el PESO— y las dos estaban mal puestas.
 *
 * ═══ EL CAMINO QUE SE ELIGIÓ, Y POR QUÉ NO LOS OTROS DOS ════════════════════
 *
 * Había tres opciones sobre la mesa: convertir en el cliente, subir directo al
 * bucket como el video, o subir los topes. Se eligió CONVERTIR EN EL CLIENTE —
 * que además es lo que la app ya hacía sin decirlo.
 *
 *  · SUBIR DIRECTO AL BUCKET (el patrón de la 0116, video por Mux) resuelve un
 *    problema que acá NO existe. Ese patrón está para que un archivo grande no
 *    tenga que pasar por el body de una server action. Pero la foto que viaja
 *    NUNCA es la que se eligió: `bakePhoto` recomprime SIEMPRE a 1600 px de
 *    lado largo y JPEG ~0.85, o sea 250–800 KB, la haya editado alguien o no.
 *    Lo que viaja ya es chico. Y hay un costo concreto: saltear el body es
 *    saltear el horneado, y con él el filtro, el texto, los emojis y el
 *    recorte, que se quemAN en los píxeles justamente antes de subir. Sería
 *    romper la feature para resolver un problema que no está.
 *
 *  · SUBIR LOS TOPES DEL SERVIDOR sería mover el número equivocado.
 *    `MAX_PHOTO_BYTES` (2 MB) y `MAX_TOTAL_PHOTO_BYTES` (10 MB) miden lo que
 *    LLEGA —el archivo ya horneado— y cierran contra el `bodySizeLimit` de
 *    `next.config.ts` (ver el docblock de post-media-limits.ts). Tocarlos
 *    obliga a mover la cadena entera para dejar pasar algo que igual se iba a
 *    recomprimir. No se tocó ni uno.
 *
 *  · LO QUE SÍ SE MOVIÓ es la puerta del NAVEGADOR, que es la única que estaba
 *    rechazando fotos reales: el tipo (faltaba HEIC/HEIF, que es el default de
 *    cualquier iPhone) y el peso al elegir (5 MB, que deja afuera una foto de
 *    48 MP). Ver `MAX_PICKED_PHOTO_BYTES` en post-media-limits.ts.
 *
 * ═══ HEIC: ACEPTARLO NO ALCANZA ═════════════════════════════════════════════
 *
 * Safari e iOS decodifican HEIC nativamente, así que ahí `createImageBitmap` lo
 * abre y el horneado lo entrega como JPEG — el servidor nunca ve un HEIC.
 * Chrome en Android NO puede decodificarlo, y es un caso muy real: alguien
 * saca la foto con el iPhone, se la manda a un familiar, y ese familiar publica
 * desde Android.
 *
 * Ahí el archivo tiene que rebotar, pero rebotar CONTÁNDOLO: sin esta prueba,
 * el HEIC pasaba la puerta del tipo, moría dentro de `bakePhoto` —que devuelve
 * el original cuando no puede hornear— y terminaba rechazado por el servidor
 * con un código genérico. La persona veía "no se pudo publicar la foto" sobre
 * una foto que se ve perfecta en su galería. Por eso se prueba a decodificar
 * ANTES de aceptarla, y por eso el motivo distingue "este navegador no puede
 * con HEIC" de "esta imagen está rota".
 */

// ---------------------------------------------------------------------------
// Formatos aceptados
// ---------------------------------------------------------------------------

/**
 * Tipos MIME que el navegador puede ofrecer para una foto.
 *
 * Los tres primeros son los de siempre y los ÚNICOS que puede recibir el
 * servidor (`PHOTO_TYPES` en app/(app)/feed/actions.ts). HEIC/HEIF entran
 * únicamente en esta puerta: el horneado los convierte a JPEG antes de que
 * viajen, así que la frontera del servidor no cambia ni hace falta tocarla.
 */
export const PHOTO_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  // Algunas cámaras y galerías reportan la variante de secuencia.
  "image/heic-sequence",
  "image/heif-sequence",
] as const;

/**
 * Extensiones que valen cuando el navegador NO informa el tipo. Pasa de verdad:
 * varios pickers de Android y algunos gestores de archivos entregan HEIC con
 * `file.type` vacío, y mirar sólo el MIME rechazaba el archivo antes de darle
 * una oportunidad.
 */
const PHOTO_EXTENSIONS = [
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".heic",
  ".heif",
] as const;

/** Valor del `accept` del input. Incluye extensiones por lo mismo de arriba. */
export const PHOTO_FILE_ACCEPT = [...PHOTO_MIME_TYPES, ...PHOTO_EXTENSIONS].join(",");

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot).toLowerCase();
}

/** ¿Es una foto de un formato que sabemos manejar? MIME primero, nombre después. */
export function isAcceptedPhotoFile(file: { type: string; name: string }): boolean {
  const type = file.type.toLowerCase();
  if ((PHOTO_MIME_TYPES as readonly string[]).includes(type)) return true;
  // Un `type` presente y NO reconocido es un no: un `.pdf` renombrado a `.jpg`
  // no se cuela por la puerta del nombre.
  if (type.startsWith("image/")) return false;
  if (type) return false;
  return (PHOTO_EXTENSIONS as readonly string[]).includes(extensionOf(file.name));
}

/**
 * ¿Este archivo es HEIC/HEIF? Decide QUÉ mensaje se muestra cuando no se puede
 * decodificar: "tu navegador no puede con este formato" es accionable, "la
 * imagen está dañada" sobre una foto que se ve bien en la galería es mentira.
 */
export function looksLikeHeic(file: { type: string; name: string }): boolean {
  const type = file.type.toLowerCase();
  if (type.includes("heic") || type.includes("heif")) return true;
  if (type) return false;
  const ext = extensionOf(file.name);
  return ext === ".heic" || ext === ".heif";
}

// ---------------------------------------------------------------------------
// El veredicto
// ---------------------------------------------------------------------------

/**
 * Por qué una foto elegida no entra.
 *  · `type`        — no es una imagen de un formato que manejemos.
 *  · `size`        — pesa más de lo que el navegador puede decodificar sin
 *                    quedarse sin memoria (ver MAX_PICKED_PHOTO_BYTES).
 *  · `heic`        — es HEIC/HEIF y ESTE navegador no sabe abrirlo (Chrome en
 *                    Android). El archivo está bien; el navegador no puede.
 *  · `decode`      — es un formato aceptado pero la imagen no se pudo abrir:
 *                    archivo cortado, descarga a medias, extensión mentirosa.
 */
export type PhotoInputRejection = "type" | "size" | "heic" | "decode";

export type PhotoInputCheck = { ok: true } | { ok: false; reason: PhotoInputRejection };

/**
 * Puerta SIN DOM: tipo y peso. Se corre primero porque es instantánea y no
 * gasta memoria — decodificar una foto de 20 MB para después rechazarla por
 * peso sería trabajo tirado.
 */
export function checkPickedPhoto(
  file: { type: string; name: string; size: number },
  maxBytes: number,
): PhotoInputCheck {
  if (!isAcceptedPhotoFile(file)) return { ok: false, reason: "type" };
  if (file.size > maxBytes) return { ok: false, reason: "size" };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// La prueba de decodificación (toca el navegador)
// ---------------------------------------------------------------------------

/**
 * ¿Puede ESTE navegador abrir esta imagen? Es la única forma honesta de saber
 * si un HEIC va a poder publicarse: no hay una consulta de capacidades que
 * responda por el decodificador de imágenes, así que se prueba.
 *
 * Barato: `createImageBitmap` decodifica una sola vez y se cierra enseguida.
 * Fuera del navegador (SSR, tests de nodo) devuelve `ok` — la puerta real es
 * la del navegador y no tiene sentido inventar un veredicto sin decodificador.
 *
 * NUNCA lanza: el fallo es un veredicto, no una excepción que alguien tenga que
 * atrapar dos capas más arriba.
 */
export async function probePhotoDecodable(file: File): Promise<PhotoInputCheck> {
  if (typeof createImageBitmap !== "function") {
    // Navegador viejo sin `createImageBitmap`: el horneado igual tiene su
    // camino con `<img>`, así que no se rechaza nada acá. Si tampoco puede,
    // `bakePhoto` avisa y se publica el original.
    return { ok: true };
  }
  try {
    const bitmap = await createImageBitmap(file);
    bitmap.close();
    return { ok: true };
  } catch (error) {
    // Nada de `catch {}` mudo: queda el motivo real en consola para poder
    // entender un reporte, y arriba se devuelve el veredicto que se muestra.
    console.error(
      `[photo-input] no se pudo decodificar "${file.name}" (${file.type || "sin tipo"}):`,
      error instanceof Error ? error.message : error,
    );
    return { ok: false, reason: looksLikeHeic(file) ? "heic" : "decode" };
  }
}
