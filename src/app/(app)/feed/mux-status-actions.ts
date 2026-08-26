"use server";

import { createClient } from "@/lib/supabase/server";
import { parseMuxStatus, type MuxStatus } from "@/lib/media/mux-video";

/**
 * =============================================================================
 * "¿YA ESTÁ LISTO ESE VIDEO?" — la única pregunta que hace el feed mientras Mux
 * transcodifica
 * =============================================================================
 *
 * Después de subir, Mux TARDA: de unos segundos a varios minutos. La publicación
 * no se queda esperando (sale igual, con la tarjeta en estado "preparando"), así
 * que alguien tiene que enterarse de cuándo terminó. Esta action es ese alguien.
 *
 * ── POR QUÉ UNA SERVER ACTION Y NO UN ENDPOINT ──────────────────────────────
 * Porque no hace falta un endpoint. Es una consulta de lectura que ya tiene su
 * sesión y su RLS resueltas por el mismo camino que el resto del feed, y una
 * ruta nueva bajo `/api` sería una superficie pública más para mantener,
 * versionar y auditar a cambio de nada.
 *
 * ── RECIBE UNA LISTA, NO UN ID ──────────────────────────────────────────────
 * Y ese es el punto entero. El patrón obvio —el del panel de admin de Poncho,
 * que es de donde sale esta idea— es un `setInterval` de 4 s por componente. En
 * un panel donde se edita UNA lección eso es correcto. En un feed no: ocho
 * tarjetas procesando serían ocho consultas cada cuatro segundos, sobre
 * teléfonos de gama media y 4G, para preguntar ocho veces lo mismo.
 *
 * Acá el cliente junta TODOS los videos que está esperando y pregunta por todos
 * de una (ver `mux-status-poll.ts`, que es quien agrupa). Una consulta por
 * tanda, sin importar cuántas tarjetas haya en pantalla.
 *
 * ── NO AUTORIZA NADA, Y NO PUEDE FILTRAR NADA ───────────────────────────────
 * Devuelve tres campos que la tarjeta ya iba a recibir igual cuando el post
 * apareciera listo, y la consulta pasa por RLS como cualquier otra: si el
 * viewer no puede ver ese post, no vuelve la fila. Un id inventado no devuelve
 * nada; una lista de ids ajenos tampoco. Lo peor que puede hacer alguien con
 * esto es preguntar por publicaciones que ya podía ver.
 *
 * ── NUNCA TIRA ──────────────────────────────────────────────────────────────
 * Una falla acá no puede voltear el feed: es un sondeo de fondo sobre contenido
 * que YA está en pantalla. Cualquier error —red, permisos, o que las columnas de
 * Mux todavía no existan en esta base— devuelve un mapa vacío, la tarjeta se
 * queda mostrando "preparando" (que es la verdad) y la próxima tanda reintenta.
 */

/** Techo de ids por consulta. Más que esto no hay en pantalla ni scrolleando. */
const MAX_IDS_POR_TANDA = 40;

export interface MuxStatusRow {
  status: MuxStatus | null;
  playbackId: string | null;
  /** posts.mux_duration_seconds — la duración REAL, medida por Mux. */
  durationSeconds: number | null;
}

export async function fetchMuxStatusesAction(
  postIds: string[],
): Promise<Record<string, MuxStatusRow>> {
  const ids = [...new Set(postIds.filter((id) => typeof id === "string" && id.length > 0))].slice(
    0,
    MAX_IDS_POR_TANDA,
  );
  if (ids.length === 0) return {};

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("posts")
      .select("id, mux_status, mux_playback_id, mux_duration_seconds")
      .in("id", ids);

    if (error || !data) return {};

    const resultado: Record<string, MuxStatusRow> = {};
    for (const fila of data as unknown as Array<Record<string, unknown>>) {
      const id = typeof fila.id === "string" ? fila.id : null;
      if (!id) continue;
      const duracion = fila.mux_duration_seconds;
      resultado[id] = {
        status: parseMuxStatus(fila.mux_status),
        playbackId: typeof fila.mux_playback_id === "string" ? fila.mux_playback_id : null,
        durationSeconds: typeof duracion === "number" && Number.isFinite(duracion) ? duracion : null,
      };
    }
    return resultado;
  } catch {
    // Incluye el caso de una base donde las columnas de Mux todavía no están:
    // el sondeo simplemente no descubre nada y la tarjeta sigue en "preparando".
    return {};
  }
}
