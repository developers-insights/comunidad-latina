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
// Selección de fotos (composers de perfil de creador y de publicar trabajo)
// ---------------------------------------------------------------------------

export const PHOTO_MAX_COUNT = 6;
// Límite GENEROSO a propósito: la foto se recomprime en el cliente a webp
// ≤1600px antes de subir (preparePhoto), así que el peso del archivo crudo NO
// es lo que termina en Storage. 8 MB rechazaba fotos normales de celular (que
// hoy pesan 8–20 MB) y el usuario veía "no se marca ninguna".
export const PHOTO_MAX_BYTES = 40 * 1024 * 1024;

export interface PhotoSelection {
  accepted: File[];
  tooMany: boolean;
  tooBig: boolean;
}

/**
 * Decide, de forma pura, qué archivos entran (tope de cantidad + peso máximo).
 *
 * IMPORTANTE: el caller DEBE pasar un array ya materializado — típicamente
 * `Array.from(input.files)` — y hacerlo de forma SÍNCRONA, nunca el `FileList`
 * vivo del input. Al elegir una foto, el input se limpia (`value = ""`) enseguida,
 * y un `FileList` vivo leído más tarde (p. ej. dentro de un updater diferido de
 * React) ya vendría vacío: ese era el bug de "elijo foto y no se marca ninguna".
 */
export function selectPhotos(
  files: File[],
  currentCount: number,
  maxCount = PHOTO_MAX_COUNT,
  maxBytes = PHOTO_MAX_BYTES,
): PhotoSelection {
  const accepted: File[] = [];
  let tooMany = false;
  let tooBig = false;
  for (const file of files) {
    if (currentCount + accepted.length >= maxCount) {
      tooMany = true;
      break;
    }
    if (file.size > maxBytes) {
      tooBig = true;
      continue;
    }
    accepted.push(file);
  }
  return { accepted, tooMany, tooBig };
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
  };
}

/**
 * "Urgente" = entrega en 7 días o menos (§ feedback cliente 2026-07-24).
 *
 * DECISIÓN: antes "urgente" era un toggle manual (attrs.urgent) desacoplado de
 * la fecha de entrega — un aviso podía marcarse urgente pidiendo 60 días, o pedir
 * 2 días sin destacarse. Ahora se DERIVA de `deadline_days ≤ 7`: el chip "Urgente"
 * y el marco featured reflejan lo que el aviso realmente pide. Se quitó el switch
 * del form y ya no se persiste `attrs.urgent` (ver creadores/actions.ts). Fuente
 * única de la regla para la lista, el detalle y cualquier consumidor futuro.
 */
export const URGENT_DEADLINE_DAYS = 7;

export function isUrgentDeadline(deadlineDays: number | null | undefined): boolean {
  return (
    deadlineDays !== null && deadlineDays !== undefined && deadlineDays <= URGENT_DEADLINE_DAYS
  );
}
