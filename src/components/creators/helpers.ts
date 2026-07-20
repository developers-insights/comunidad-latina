import type { Json } from "@/lib/types/database.types";

/**
 * Helpers puros del Creator Marketplace. Sin dependencias de servidor: se usan
 * desde Server Components y client components por igual.
 */

// ---------------------------------------------------------------------------
// Fotos de portfolio (bucket público post-media, path {tenant}/{user}/portfolio-…)
// ---------------------------------------------------------------------------

/** Path de storage → URL pública del bucket post-media. URL absoluta se respeta. */
export function creatorPhotoUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  return `${base}/storage/v1/object/public/post-media/${path}`;
}

export function firstPortfolioUrl(photos: string[] | null | undefined): string | null {
  const first = photos?.find((photo) => photo && photo.trim().length > 0);
  return first ? creatorPhotoUrl(first) : null;
}

// ---------------------------------------------------------------------------
// Reputación del creador (score de crédito): estrellas + trabajos
// ---------------------------------------------------------------------------

/** rating_avg → "4.8" (una decimal) o null si todavía no tiene reseñas. */
export function formatRating(avg: number | null | undefined): string | null {
  if (avg === null || avg === undefined) return null;
  const n = Number(avg);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n.toFixed(1);
}

// ---------------------------------------------------------------------------
// attrs del aviso (creator_gig)
// ---------------------------------------------------------------------------

export interface GigAttrs {
  category: string | null;
  deliverables: string | null;
  deadlineDays: number | null;
  urgent: boolean;
}

function asFiniteNumber(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

export function parseGigAttrs(attrs: Json): GigAttrs {
  const record =
    attrs !== null && typeof attrs === "object" && !Array.isArray(attrs)
      ? (attrs as Record<string, unknown>)
      : {};
  return {
    category: typeof record.category === "string" ? record.category : null,
    deliverables: typeof record.deliverables === "string" ? record.deliverables : null,
    deadlineDays: asFiniteNumber(record.deadline_days),
    urgent: record.urgent === true,
  };
}
