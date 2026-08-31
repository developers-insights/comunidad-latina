/**
 * CARGAR LOS EMOJIS DE IMAGEN PARA EL CANVAS.
 *
 * Vive acá y no en `photo-overlay.ts` porque ese módulo no tiene DOM por
 * decisión explícita (su cabecera lo dice): define catálogos y cuentas puras
 * que corren igual en la vista previa, en el horneado y en un test sin
 * navegador. Esto es lo contrario — es puro DOM — así que se separa.
 *
 * ─── POR QUÉ `crossOrigin = "anonymous"` NO ES OPCIONAL ─────────────────────
 * Ésta es la trampa entera de esta feature, y falla de la peor manera posible.
 *
 * Los archivos viven en el bucket público de Supabase, que es OTRO ORIGEN. Si
 * se dibuja en el canvas una imagen de otro origen cargada SIN CORS, el canvas
 * queda "tainted": no lanza nada al dibujar, pero el `canvas.toBlob()` de
 * `bake-photo.ts` tira `SecurityError`. Y ese error lo captura el `catch` de
 * `bakePhoto`, que hace lo correcto para el caso que conocía —devolver el
 * archivo ORIGINAL— con lo cual la persona publica la foto SIN el recorte, SIN
 * el filtro y SIN el texto. Un emoji decorativo se llevaría puesta la edición
 * entera.
 *
 * Con `crossOrigin = "anonymous"` el navegador pide CORS de verdad; el
 * endpoint público de Supabase Storage responde con `Access-Control-Allow-
 * Origin`. Si por lo que sea no lo hiciera, la imagen falla al CARGAR —acá,
 * antes de tocar el canvas— y el horneado sigue sin ese emoji, con todo lo
 * demás intacto. El modo de fallar pasa de "se pierde la edición completa" a
 * "falta un dibujo", que es la degradación que corresponde.
 *
 * Nunca rechaza: devuelve el mapa de lo que SÍ se pudo cargar y quien llama
 * decide. Un `Promise.all` que rechaza dejaría la publicación colgada por un
 * adorno.
 */

/** Cuánto se espera una imagen antes de publicar sin ella. */
const LOAD_TIMEOUT_MS = 8000;

/**
 * Descarga (o toma de la caché del navegador) las imágenes que hagan falta.
 * Deduplica por URL: el mismo emoji puesto tres veces sobre la foto es una
 * sola descarga.
 *
 * @returns Mapa `url → <img>` con SÓLO las que cargaron bien.
 */
export async function loadStickerImages(
  urls: readonly string[],
): Promise<Map<string, HTMLImageElement>> {
  const unicas = [...new Set(urls.filter(Boolean))];
  const cargadas = new Map<string, HTMLImageElement>();
  if (unicas.length === 0 || typeof document === "undefined") return cargadas;

  const resultados = await Promise.all(
    unicas.map(async (url) => ({ url, image: await loadStickerImage(url) })),
  );
  for (const { url, image } of resultados) {
    if (image) cargadas.set(url, image);
  }
  return cargadas;
}

/** Una sola imagen. `null` si no cargó — nunca lanza. */
export function loadStickerImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    // Antes del `src`: cambiar `crossOrigin` con la carga ya empezada no
    // re-emite el pedido, y quedaría una imagen sin CORS que ensucia el canvas.
    image.crossOrigin = "anonymous";
    image.decoding = "async";

    let listo = false;
    const terminar = (valor: HTMLImageElement | null) => {
      if (listo) return;
      listo = true;
      clearTimeout(reloj);
      resolve(valor);
    };

    // Una imagen que nunca resuelve dejaría la publicación esperando para
    // siempre: hay un tope y se publica sin ese dibujo.
    const reloj = setTimeout(() => {
      console.error("[emojis] la imagen tardó demasiado y se publica sin ella:", url);
      terminar(null);
    }, LOAD_TIMEOUT_MS);

    image.onload = () => terminar(image);
    image.onerror = () => {
      // Log y no silencio: el caso típico es un `storage_path` que apunta a un
      // archivo que no está, y si no queda dicho se investiga desde cero.
      console.error("[emojis] no se pudo cargar el emoji y se publica sin él:", url);
      terminar(null);
    };
    image.src = url;
  });
}
