import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getViewerFormatDate } from "@/lib/time/viewer-zone";
import { firstPhotoUrl } from "@/components/listings/helpers";
import {
  distribucion,
  resumenDeStats,
  supabaseSinTipar,
  type ResenaVista,
  type ResumenPuntaje,
} from "@/lib/resenas";

/**
 * Lectura de reseñas para la ficha de un aviso (negocio o profesional).
 *
 * Vive acá y no en cada página porque las dos verticales muestran exactamente
 * lo mismo: si la query se copia, se desincroniza. Es el mismo criterio con el
 * que los guardados viven en el módulo FEED y los consumen las demás pantallas.
 *
 * ── POR QUÉ NO HAY N+1 ──────────────────────────────────────────────────────
 * El promedio NO se calcula acá: se lee de `listing_review_stats`, que un
 * trigger mantiene al día (0093). Los autores se resuelven con UN `in (…)` sobre
 * los ids de la página, no con una consulta por reseña.
 *
 * ── NADA DE ESTO ES BLOQUEANTE ──────────────────────────────────────────────
 * Si alguna consulta falla, la sección cae a vacío y la ficha se sigue viendo —
 * el mismo trato que ya tienen seguidores y publicaciones. Los errores se
 * loguean; no hay ningún `catch` mudo.
 */

const RESENAS_POR_PAGINA = 20;

export interface ResenasDeAviso {
  resumen: ResumenPuntaje;
  reparto: { puntaje: number; cantidad: number; porcentaje: number }[];
  resenas: ResenaVista[];
  /** Mi reseña, si dejé una: alimenta el modo edición del formulario. */
  propia: { id: string; puntaje: number; texto: string | null } | null;
  /** Quien mira administra el aviso (dueño o equipo del negocio, 0031). */
  administraElAviso: boolean;
}

const VACIO: ResenasDeAviso = {
  resumen: { promedio: null, cantidad: 0 },
  reparto: [],
  resenas: [],
  propia: null,
  administraElAviso: false,
};

interface FilaResena {
  id: string;
  author_id: string;
  entity_listing_id: string | null;
  rating: number;
  body: string | null;
  owner_reply: string | null;
  owner_reply_at: string | null;
  created_at: string;
}

export async function fetchResenasDeAviso(
  client: SupabaseClient | unknown,
  listingId: string,
  viewerId: string | null,
): Promise<ResenasDeAviso> {
  const supabase = supabaseSinTipar(client);

  const [statsResult, resenasResult, administraResult, formatDate] = await Promise.all([
    supabase
      .from("listing_review_stats")
      .select("rating_avg, rating_count")
      .eq("listing_id", listingId)
      .maybeSingle(),
    supabase
      .from("listing_reviews")
      .select(
        "id, author_id, entity_listing_id, rating, body, owner_reply, owner_reply_at, created_at",
      )
      .eq("listing_id", listingId)
      .order("created_at", { ascending: false })
      .limit(RESENAS_POR_PAGINA),
    // Sin sesión no se pregunta: la RPC exige `authenticated` y la respuesta ya
    // se sabe.
    viewerId
      ? supabase.rpc("puedo_administrar_aviso", { p_listing: listingId })
      : Promise.resolve({ data: false, error: null }),
    getViewerFormatDate(),
  ]);

  if (resenasResult.error) {
    console.warn("[resenas] no se pudieron leer las reseñas del aviso", {
      listingId,
      code: resenasResult.error.code,
    });
    return VACIO;
  }
  if (statsResult.error) {
    console.warn("[resenas] no se pudo leer el resumen de puntaje", {
      listingId,
      code: statsResult.error.code,
    });
  }
  if (administraResult.error) {
    console.warn("[resenas] no se pudo resolver si administra el aviso", {
      listingId,
      code: administraResult.error.code,
    });
  }

  const filas = (resenasResult.data ?? []) as FilaResena[];

  // Autores en UNA sola consulta. `profiles` tiene lectura pública acotada por
  // columnas (0058), así que se piden exactamente las tres que se muestran.
  const autorIds = [...new Set(filas.map((fila) => fila.author_id))];
  const autores = new Map<string, { nombre: string; avatar: string | null }>();

  if (autorIds.length > 0) {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, display_name, avatar_url")
      .in("id", autorIds);

    if (error) {
      console.warn("[resenas] no se pudieron leer los autores", { code: error.code });
    }
    for (const perfil of data ?? []) {
      autores.set(perfil.id as string, {
        nombre: (perfil.display_name as string | null) ?? "Miembro de la comunidad",
        avatar: (perfil.avatar_url as string | null) ?? null,
      });
    }
  }

  /**
   * Las fichas que firmaron reseñas, en UNA consulta (0117). La RLS de
   * `listings` ya limita a lo publicado: una ficha despublicada no resuelve y su
   * reseña vuelve a verse a nombre de la persona, que es quien la escribió.
   */
  const fichaIds = [
    ...new Set(filas.map((fila) => fila.entity_listing_id).filter(Boolean)),
  ] as string[];
  const fichas = new Map<string, { nombre: string; avatar: string | null }>();
  if (fichaIds.length > 0) {
    const { data, error } = await supabase
      .from("listings")
      .select("id, title, photos")
      .in("id", fichaIds);
    if (error) {
      console.warn("[resenas] no se pudieron leer las fichas que firman", {
        code: error.code,
      });
    }
    for (const ficha of data ?? []) {
      fichas.set(ficha.id as string, {
        nombre: (ficha.title as string | null) ?? "Un negocio de la comunidad",
        avatar: firstPhotoUrl(ficha.photos as string[] | null),
      });
    }
  }

  const resenas: ResenaVista[] = filas.map((fila) => {
    const autor = autores.get(fila.author_id);
    const ficha = fila.entity_listing_id ? fichas.get(fila.entity_listing_id) : undefined;
    return {
      id: fila.id,
      autorId: fila.author_id,
      esDeNegocio: Boolean(ficha),
      autorNombre: ficha?.nombre ?? autor?.nombre ?? "Miembro de la comunidad",
      autorAvatar: ficha ? ficha.avatar : autor?.avatar ?? null,
      puntaje: fila.rating,
      texto: fila.body,
      fecha: formatDate(fila.created_at, { style: "long" }),
      respuesta: fila.owner_reply,
      respuestaFecha: fila.owner_reply_at
        ? formatDate(fila.owner_reply_at, { style: "long" })
        : null,
      esMia: Boolean(viewerId) && fila.author_id === viewerId,
    };
  });

  const propiaFila = viewerId ? filas.find((fila) => fila.author_id === viewerId) : undefined;
  const resumen = resumenDeStats(
    statsResult.data as { rating_avg: string | null; rating_count: number } | null,
  );

  /**
   * El reparto se arma con lo que se trajo, así que sólo se muestra cuando la
   * página cubre TODAS las reseñas. Con más de 20 sería el reparto de lo
   * visible presentado como el del negocio, que es una cifra falsa con cara de
   * dato. El promedio grande, en cambio, siempre sale de la tabla agregada:
   * ese sí cuenta todas.
   */
  const repartoCompleto = filas.length >= resumen.cantidad;

  return {
    resumen,
    reparto: repartoCompleto ? distribucion(filas.map((fila) => fila.rating)) : [],
    resenas,
    propia: propiaFila
      ? { id: propiaFila.id, puntaje: propiaFila.rating, texto: propiaFila.body }
      : null,
    administraElAviso: administraResult.data === true,
  };
}
