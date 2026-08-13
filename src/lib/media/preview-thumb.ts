/**
 * UNA MINIATURA CHICA PARA MUCHAS COPIAS.
 *
 * El carrusel de filtros pinta la MISMA foto 16 veces, cada una con un `filter`
 * distinto. Si las 16 apuntan al `blob:` original, el navegador tiene que
 * rasterizar 16 veces una imagen que puede ser de 12 megapíxeles para
 * mostrarla en un cuadrito de 72 px — en un teléfono de gama media eso se
 * siente al deslizar.
 *
 * Acá se dibuja UNA sola vez a `THUMB_SIZE` y se devuelve un `data:` que las 16
 * comparten. El filtro se sigue aplicando con CSS encima de esa miniatura: lo
 * que cambia es cuántos píxeles hay que filtrar, no cómo.
 *
 * NO REEMPLAZA A `bake-photo.ts`. Esto es sólo para las miniaturas del
 * selector; la vista previa grande y el archivo que se publica siguen saliendo
 * del original a resolución completa.
 *
 * NUNCA LANZA. Si algo falla (canvas sin contexto, imagen que no decodifica,
 * un `blob:` ya revocado) devuelve `null` y quien llama sigue usando la URL
 * original: peor rendimiento, misma foto. Un error acá no puede dejar a nadie
 * sin poder elegir un filtro.
 */

/** Lado largo de la miniatura, en px CSS. Cubre 72 px de chip en pantallas 3x. */
export const THUMB_SIZE = 216;

export async function makePreviewThumb(
  src: string,
  size: number = THUMB_SIZE,
): Promise<string | null> {
  if (typeof document === "undefined" || !src) return null;

  try {
    const image = await loadImage(src);
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    if (!width || !height) return null;

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    // Recorte cuadrado centrado: el chip muestra la foto con `object-cover`, así
    // que guardar los bordes que igual no se ven sería peso al pedo.
    const side = Math.min(width, height);
    canvas.width = size;
    canvas.height = size;
    ctx.drawImage(
      image,
      (width - side) / 2,
      (height - side) / 2,
      side,
      side,
      0,
      0,
      size,
      size,
    );

    return canvas.toDataURL("image/jpeg", 0.8);
  } catch (error) {
    console.warn(
      "[preview-thumb] no se pudo achicar la vista previa, se usa la original:",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("No se pudo decodificar la vista previa"));
    image.src = src;
  });
}
