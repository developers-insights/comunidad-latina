import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { formatListingPrice } from "@/components/listings/helpers";
import { fetchBlockedIds } from "@/app/(app)/feed/queries";
import {
  LISTING_VIDEO_CARD_CAP_SECONDS,
  LISTING_VIDEO_COLUMNS,
  toListingVideoView,
  type ListingVideoRow,
  type ListingVideoView,
} from "@/lib/media/listing-video-policy";
import { listingViewHref } from "@/lib/monetization/href";

export interface AvisoConVideoLargo {
  id: string;
  kind: string;
  title: string;
  priceLabel: string | null;
  areaLabel: string | null;
  publisherName: string | null;
  detailHref: string;
  video: ListingVideoView;
}

type Fila = ListingVideoRow & {
  kind: string;
  title: string;
  price_amount: number | null;
  price_currency: string | null;
  price_period: string | null;
  area_label: string | null;
  created_by: string | null;
  publisher_name: string | null;
};

const COLUMNAS = `id, kind, title, price_amount, price_currency, price_period, area_label, created_by, publisher_name, ${LISTING_VIDEO_COLUMNS}`;

function aModelo(fila: Fila, locale: string): AvisoConVideoLargo | null {
  const video = toListingVideoView(fila);
  if (!video?.fullVideoHref) return null;
  return {
    id: fila.id,
    kind: fila.kind,
    title: fila.title,
    priceLabel: formatListingPrice(
      fila.price_amount,
      fila.price_currency ?? "USD",
      fila.price_period,
      locale,
    ),
    areaLabel: fila.area_label,
    publisherName: fila.publisher_name,
    detailHref: listingViewHref(fila.kind, fila.id),
    video,
  };
}

/**
 * Los avisos con video largo que se ven enteros: publicados, premium y de más
 * de 90 s. Nunca lanza — si la 0160 no está aplicada, la sección no aparece.
 */
export async function fetchAvisosConVideoLargo({
  supabase,
  tenantId,
  viewerId,
  locale,
  limit = 12,
  excludeId = null,
}: {
  supabase: unknown;
  tenantId: string;
  viewerId: string | null;
  locale: string;
  limit?: number;
  excludeId?: string | null;
}): Promise<AvisoConVideoLargo[]> {
  const client = supabase as SupabaseClient;
  const [blocked, respuesta] = await Promise.all([
    fetchBlockedIds(supabase as never, viewerId),
    client
      .from("listings")
      .select(COLUMNAS)
      .eq("tenant_id", tenantId)
      .eq("status", "published")
      .eq("tier", "premium")
      .not("video_path", "is", null)
      .gt("video_duration_seconds", LISTING_VIDEO_CARD_CAP_SECONDS)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit + 1),
  ]);

  if (respuesta.error) {
    console.warn("[videos-largos] no se pudieron leer los avisos con video", {
      code: respuesta.error.code,
    });
    return [];
  }

  return ((respuesta.data ?? []) as unknown as Fila[])
    .filter((fila) => fila.id !== excludeId)
    .filter((fila) => !fila.created_by || !blocked.has(fila.created_by))
    .map((fila) => aModelo(fila, locale))
    .filter((item): item is AvisoConVideoLargo => item !== null)
    .slice(0, limit);
}

export async function fetchAvisoConVideoLargo({
  supabase,
  tenantId,
  viewerId,
  listingId,
  locale,
}: {
  supabase: unknown;
  tenantId: string;
  viewerId: string | null;
  listingId: string;
  locale: string;
}): Promise<AvisoConVideoLargo | null> {
  const { data, error } = await (supabase as SupabaseClient)
    .from("listings")
    .select(COLUMNAS)
    .eq("tenant_id", tenantId)
    .eq("id", listingId)
    .eq("status", "published")
    .maybeSingle();
  if (error || !data) return null;
  const fila = data as unknown as Fila;
  if (fila.created_by) {
    const blocked = await fetchBlockedIds(supabase as never, viewerId);
    if (blocked.has(fila.created_by)) return null;
  }
  return aModelo(fila, locale);
}
