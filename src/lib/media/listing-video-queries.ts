import type { SupabaseClient } from "@supabase/supabase-js";
import {
  LISTING_VIDEO_COLUMNS,
  toListingVideoView,
  type ListingVideoRow,
  type ListingVideoView,
} from "./listing-video-policy";

export interface VideoGuardado {
  path: string;
  posterPath: string | null;
  seconds: number;
}

/**
 * El video y el tier de UN aviso, para la hoja de edición. `null` si la
 * consulta falla (0160 sin aplicar): la hoja sigue editando texto y fotos.
 */
export async function fetchVideoDeAviso(
  supabase: unknown,
  listingId: string,
): Promise<{ tier: string | null; video: VideoGuardado | null } | null> {
  const { data, error } = await (supabase as SupabaseClient)
    .from("listings")
    .select(LISTING_VIDEO_COLUMNS)
    .eq("id", listingId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as Omit<ListingVideoRow, "id">;
  const video =
    row.video_path && typeof row.video_duration_seconds === "number"
      ? {
          path: row.video_path,
          posterPath: row.video_poster_path ?? null,
          seconds: row.video_duration_seconds,
        }
      : null;
  return { tier: row.tier ?? null, video };
}

/**
 * Los videos de una página de avisos, en UNA consulta aparte y no dentro del
 * SELECT de cada módulo: el feed trae sus avisos por RPC (`feed_listings_page`,
 * con columnas fijas) y cada grilla tiene su propio SELECT. Así todas las
 * superficies resuelven el video igual.
 *
 * Nunca lanza: si la consulta falla (p. ej. la 0160 todavía no está aplicada)
 * la página se pinta con fotos, como antes.
 */
export async function fetchListingVideos(
  supabase: unknown,
  listingIds: readonly string[],
): Promise<Map<string, ListingVideoView>> {
  const videos = new Map<string, ListingVideoView>();
  const ids = [...new Set(listingIds.filter(Boolean))];
  if (ids.length === 0) return videos;

  const { data, error } = await (supabase as SupabaseClient)
    .from("listings")
    .select(`id, ${LISTING_VIDEO_COLUMNS}`)
    .in("id", ids)
    .not("video_path", "is", null);

  if (error) {
    console.warn("[avisos] no se pudieron leer los videos de la página", { code: error.code });
    return videos;
  }

  for (const row of (data ?? []) as ListingVideoRow[]) {
    const view = toListingVideoView(row);
    if (view) videos.set(row.id, view);
  }
  return videos;
}
