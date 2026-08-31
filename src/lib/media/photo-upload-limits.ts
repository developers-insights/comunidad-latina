/**
 * FORMATO DE FOTO AL ELEGIR — fuente ÚNICA para el composer, mismo patrón que
 * `video-upload-limits.ts` (catálogo + funciones de chequeo PURAS, sin DOM,
 * importables desde un `"use client"` y testeables sin navegador).
 *
 * POR QUÉ EXISTE ESTE ARCHIVO. `PHOTO_TYPES` vivía como una constante suelta
 * dentro de `post-composer.tsx`, y el atributo `accept` del `<input>` era un
 * STRING APARTE escrito a mano (`"image/jpeg,image/png,image/webp"`) — dos
 * copias de la misma lista, exactamente el patrón que ya mordió a este repo
 * dos veces (`MAX_PHOTOS` en `post-media-limits.ts`, el catálogo de video en
 * `video-upload-limits.ts`). Acá vive una sola vez.
 *
 * EL BUG QUE ESTE MÓDULO CIERRA (reporte del cliente, agosto 2026): "problema
 * con... el tipo de formato... con las imágenes". Es EL MISMO bug del `.mov`
 * de video, nunca replicado a fotos: `PHOTO_TYPES` no incluía HEIC/HEIF, el
 * formato NATIVO de la cámara de iPhone desde iOS 11 (Ajustes › Cámara ›
 * Formatos › "Alta eficiencia"). Una foto sacada con la configuración de
 * fábrica del teléfono se rechazaba con un toast genérico que no explicaba
 * nada — a diferencia del de video, que sí decía qué hacer.
 *
 * ─── POR QUÉ NO SE ACEPTA HEIC/HEIF DIRECTAMENTE (decisión, no descuido) ────
 *
 * `bake-photo.ts` decodifica con `<canvas>` (`createImageBitmap` o `<img>`), y
 * HEIC sólo decodifica nativo ahí en Safari — Chrome, Firefox y la mayoría de
 * Android no. Si `PHOTO_TYPES` aceptara HEIC sin más, un archivo que no
 * decodifica caería al fallback de `bakePhoto` (publicar el archivo TAL CUAL
 * llegó, pensado para cuando falla un FILTRO, no la decodificación entera): la
 * publicación saldría "bien" y quedaría con una foto rota para toda la
 * comunidad — ningún navegador fuera de Safari muestra un `.heic` en un
 * `<img>`. Es un bug peor que el que se quiere arreglar, y en silencio.
 *
 * Tampoco se agrega una librería de conversión (heic2any y afines cargan un
 * WASM de varios cientos de KB, típicamente 1 MB+) sin evidencia real de que
 * haga falta: no hay forma de verificar desde este repo qué tan seguido un
 * archivo HEIC llega hasta acá SIN que Safari ya lo haya convertido a JPEG
 * solo (ver abajo), y el bundle del feed es una preocupación activa de otro
 * frente en esta misma tanda de cambios.
 *
 * TAMPOCO SE AGREGA `"image/heic"` AL `accept` DEL INPUT. Parece lo obvio,
 * pero hacerlo puede EMPEORAR el caso más común: Safari en iPhone, al elegir
 * una foto HEIC desde la librería de Fotos con el formato en "Automático"
 * (el default de fábrica desde iOS 11), la entrega YA CONVERTIDA a JPEG — así
 * que la mayoría de las fotos de iPhone que llegan hasta el composer HOY YA
 * son JPEG sin que el composer haga nada. Reportado en Safari 17+: declarar
 * `image/heic` en `accept` puede hacer que el picker interprete "el destino
 * SÍ sabe leer HEIC" y entregue el archivo CRUDO en vez de convertirlo — es
 * decir, sumar el MIME al `accept` puede romper el camino que hoy funciona
 * solo, para "arreglar" uno que hoy es la excepción. (No se pudo verificar
 * con un dispositivo real desde este entorno — la fuente es documentación y
 * foros de desarrolladores de Apple citados en el reporte de esta tarea, no
 * una prueba propia; por eso la decisión es la más conservadora: no tocar el
 * `accept`.)
 *
 * LA SALIDA REAL: detectar el HEIC/HEIF que se cuela pese a todo eso —cámara
 * en "Actual" en vez de "Automático", captura directa por `capture`, un
 * Android con la cámara en HEIF (común en gama media/alta), un `.heic` que
 * llegó por WhatsApp/AirDrop y se sube desde una compu sin picker de Fotos que
 * convierta nada— y explicarle a la persona QUÉ es y CÓMO evitarlo la próxima
 * vez, en vez del genérico "no es JPG/PNG/WebP" que no significa nada para
 * quien sacó la foto con la cámara de siempre. Ver `photoWrongType` /
 * `photoHeicTitle` en `@/components/feed/copy.ts`.
 *
 * Si el toast de HEIC sigue apareciendo seguido después de este cambio (hay
 * telemetría real, no una corazonada), ahí sí se justifica evaluar una
 * librería de conversión con datos en la mano.
 */

/** Formatos que el composer acepta publicar. El servidor (`feed/actions.ts`) valida los mismos tres — ver la nota de integración en el reporte de esta tarea: hoy los mantiene en una copia propia. */
export const PHOTO_TYPES: readonly string[] = ["image/jpeg", "image/png", "image/webp"];

/** Valor de `accept` del `<input type="file">` de fotos. Generado desde `PHOTO_TYPES` — nunca a mano, para que no se separen en silencio (era exactamente ese el bug). */
export const PHOTO_ACCEPT_ATTR = PHOTO_TYPES.join(",");

/** ¿Este `file.type` es uno de los que el composer publica? */
export function isAcceptedPhotoType(file: { type: string }): boolean {
  return PHOTO_TYPES.includes(file.type);
}

// ---------------------------------------------------------------------------
// Detección de HEIC/HEIF — sólo para MENSAJE, nunca para aceptar el archivo
// ---------------------------------------------------------------------------

/**
 * Alias MIME reales de HEIC/HEIF. Las variantes "-sequence" son ráfaga/Live
 * Photo — mismo contenedor, mismo problema de decodificación.
 */
const HEIC_MIME_TYPES = new Set([
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
]);

const HEIC_EXTENSIONS = new Set(["heic", "heif"]);

/**
 * ¿Este archivo ES HEIC/HEIF? Primero el MIME; si no matchea (algunos Android
 * reportan vacío o `application/octet-stream` para este formato, mismo gotcha
 * que ya documenta `video-upload-limits.ts`), cae al nombre de archivo — una
 * foto de iPhone sin convertir se llama `IMG_1234.HEIC`.
 *
 * Se usa SÓLO para elegir el mensaje correcto en `selectPhotos`
 * (`post-composer.tsx`): un HEIC nunca pasa a `accepted`, sea cual sea el
 * resultado de esta función.
 */
export function isHeicPhoto(file: { type: string; name: string }): boolean {
  const mime = file.type.trim().toLowerCase();
  if (HEIC_MIME_TYPES.has(mime)) return true;
  const dotIndex = file.name.lastIndexOf(".");
  if (dotIndex === -1) return false;
  const extension = file.name.slice(dotIndex + 1).toLowerCase();
  return HEIC_EXTENSIONS.has(extension);
}
