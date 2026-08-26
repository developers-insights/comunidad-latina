import "server-only";

import Mux from "@mux/mux-node";

/**
 * =============================================================================
 * MUX — cliente del SDK y los ajustes con los que nace cada asset
 * =============================================================================
 *
 * ⚠️ SERVER-ONLY. Acá viven las credenciales de la API de Mux. Jamás importar
 * este archivo desde un client component; para armar URLs de reproducción está
 * `./urls`, que es puro y client-safe.
 */

let cliente: Mux | null = null;

/**
 * Cliente perezoso y memoizado.
 *
 * ⚠️ LANZA si falta una credencial, Y ESO ES LO CORRECTO: quien llama tiene que
 * haber chequeado `isMuxConfigured` antes. Un cliente "tolerante" que se
 * construye igual movería la falla al primer request contra Mux, o sea un 502
 * genérico en vez del 503 honesto de "esto todavía no está configurado" — y esa
 * diferencia es exactamente la que hace que un env mal armado se descubra en
 * producción y no en el deploy.
 */
export function getMux(): Mux {
  if (cliente) return cliente;

  const tokenId = process.env.MUX_TOKEN_ID;
  const tokenSecret = process.env.MUX_TOKEN_SECRET;
  if (!tokenId || !tokenSecret) {
    throw new Error(
      "Mux no está configurado. Faltan MUX_TOKEN_ID y/o MUX_TOKEN_SECRET en .env.local. " +
        "Antes de llamar a getMux() hay que chequear isMuxConfigured (lib/config/services.ts).",
    );
  }

  cliente = new Mux({ tokenId, tokenSecret });
  return cliente;
}

/**
 * Ajustes con los que se crea TODO asset de la comunidad.
 *
 * ── `playback_policies: ["public"]` ─────────────────────────────────────────
 * Público, no firmado. El contenido del feed ya es público —hoy mismo se sirve
 * desde un bucket público— así que firmar la reproducción sería emitir un JWT
 * por cada play para custodiar algo que no está custodiado. (En el proyecto de
 * donde viene este patrón el contenido son cursos pagos y ahí sí va `signed`;
 * copiar eso acá sería copiar el paywall de otro producto.)
 *
 * `playback_policies` y no `playback_policy`: el segundo está deprecado en el
 * SDK v15.
 *
 * ── NO HAY `mp4_support`, Y ES UNA DECISIÓN DE PLATA ────────────────────────
 * Una rendición MP4 estática se almacena y se paga POR SIEMPRE, aunque nadie la
 * pida. Para reproducir no hace falta: para eso está el HLS. En el proyecto de
 * referencia existe un `mp4_support: "audio-only"` que sirve para pasarle el
 * audio a Whisper; acá no hay transcripción, así que sería costo puro.
 *
 * ── `video_quality: "basic"` ────────────────────────────────────────────────
 * El escalón más barato de Mux, y el correcto para video de comunidad grabado
 * con un celular: la calidad de la fuente es el techo real, y pagar `plus` no
 * mejora un video que ya venía comprimido por WhatsApp. Reemplaza a
 * `encoding_tier`, deprecado en el SDK v15.
 *
 * ── `max_resolution_tier: "1080p"` ──────────────────────────────────────────
 * El MÍNIMO que Mux acepta (no existe un tier de 720p). Es el tope de lo que se
 * almacena; lo que de verdad mueve la factura de entrega se limita del lado del
 * reproductor.
 *
 * `passthrough` no está acá porque es por-subida: lo pone la ruta con el id de
 * la publicación.
 */
export const MUX_NEW_ASSET_SETTINGS = {
  playback_policies: ["public"],
  video_quality: "basic",
  max_resolution_tier: "1080p",
} as const;

/**
 * Cuánto vale la URL de subida antes de darse por vencida (segundos).
 *
 * Una hora para EMPEZAR a subir. No es el tope de la subida: UpChunk manda el
 * archivo en pedazos y lo que cuenta es haber arrancado dentro de la ventana.
 * Una hora es de sobra para elegir un archivo y confirmarlo, y acota cuántas
 * URLs de subida vivas puede juntar alguien que abre el composer en bucle.
 */
export const MUX_UPLOAD_TIMEOUT_SECONDS = 60 * 60;
