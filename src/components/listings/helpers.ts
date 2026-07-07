import type { Json } from "@/lib/types/database.types";
import type { TrustLevel } from "@/components/trust";
import type { TrustSignal } from "@/components/trust";
import { formatMoney } from "@/lib/utils";

// Gramática de señales de confianza: FUENTE ÚNICA en @/lib/trust/signals.
// Se re-exportan acá para no romper los imports existentes de @/components/listings.
export { toTrustLevel, buildTrustSignals } from "@/lib/trust/signals";

/**
 * Helpers puros del módulo VIVIENDA. Sin dependencias de servidor:
 * usables desde Server Components y client components por igual.
 */

// ---------------------------------------------------------------------------
// Fotos (bucket público listing-photos)
// ---------------------------------------------------------------------------

/** Imagen local de respaldo cuando un aviso no tiene fotos. */
export const FALLBACK_PHOTO = "/images/hero-vivienda.png";

/**
 * Path de storage → URL pública del bucket listing-photos.
 * Si ya es una URL absoluta (seed/API), se respeta tal cual.
 */
export function listingPhotoUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  return `${base}/storage/v1/object/public/listing-photos/${path}`;
}

export function firstPhotoUrl(photos: string[] | null | undefined): string | null {
  const first = photos?.find((p) => p && p.trim().length > 0);
  return first ? listingPhotoUrl(first) : null;
}

/**
 * ¿El src puede pasar por next/image? Solo assets locales o del Storage de
 * Supabase (host en el allowlist de next.config). URLs externas de seed/API
 * quedan en <img> — next/image lanzaría en runtime con un host desconocido.
 */
export function isOptimizableSrc(src: string): boolean {
  if (src.startsWith("/")) return true;
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
  return base.length > 0 && src.startsWith(`${base}/`);
}

// ---------------------------------------------------------------------------
// Precio
// ---------------------------------------------------------------------------

const PERIOD_SUFFIX: Record<string, string> = {
  hour: "/hora",
  day: "/día",
  week: "/semana",
  month: "/mes",
  year: "/año",
  one_time: "",
};

export function formatListingPrice(
  amount: number | null,
  currency: string,
  period: string | null,
  locale = "es-US",
): string | null {
  if (amount === null || amount === undefined) return null;
  const money = formatMoney(Number(amount), { locale, currency });
  const suffix = period ? (PERIOD_SUFFIX[period] ?? "") : "";
  return `${money}${suffix}`;
}

// ---------------------------------------------------------------------------
// attrs de propiedad
// ---------------------------------------------------------------------------

export interface PropertyAttrs {
  bedrooms: number | null;
  bathrooms: number | null;
  sqft: number | null;
}

function asFiniteNumber(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

export function parsePropertyAttrs(attrs: Json): PropertyAttrs {
  const record =
    attrs !== null && typeof attrs === "object" && !Array.isArray(attrs)
      ? (attrs as Record<string, unknown>)
      : {};
  return {
    bedrooms: asFiniteNumber(record.bedrooms),
    bathrooms: asFiniteNumber(record.bathrooms),
    sqft: asFiniteNumber(record.sqft),
  };
}

// ---------------------------------------------------------------------------
// Trust Score del publicador
// ---------------------------------------------------------------------------
// `toTrustLevel` y `buildTrustSignals` viven en @/lib/trust/signals (fuente
// única) y se re-exportan al tope de este archivo.

/** Nombre de pila para el TrustScoreSheet ("Trust Score de Rosa"). */
export function firstNameOf(displayName: string): string {
  return displayName.trim().split(/\s+/)[0] ?? displayName;
}

// ---------------------------------------------------------------------------
// Keyset pagination (cursor created_at|id)
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Timestamp ISO-8601 canónico (como lo emite PostgREST en created_at):
 * `2026-07-06T12:34:56[.ffffff][Z|±HH[:MM]]`. ESTRICTO a propósito — el
 * valor se interpola dentro de un filtro `.or()` de PostgREST, así que solo
 * pasa un charset cerrado (dígitos, T, :, ., Z, ±). Nada de comillas ni
 * separadores raros que puedan romper la sintaxis del filtro.
 */
const ISO_TIMESTAMP_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}(?::?\d{2})?)?$/;

export function encodeCursor(createdAt: string, id: string): string {
  return encodeURIComponent(`${createdAt}|${id}`);
}

export function decodeCursor(
  raw: string | undefined,
): { createdAt: string; id: string } | null {
  if (!raw) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  const [createdAt, id] = decoded.split("|");
  if (!createdAt || !id) return null;
  if (!ISO_TIMESTAMP_RE.test(createdAt) || !UUID_RE.test(id)) return null;
  if (Number.isNaN(new Date(createdAt).getTime())) return null;
  return { createdAt, id };
}

// ---------------------------------------------------------------------------
// Datos que las cards y el detalle reciben ya resueltos (server → UI)
// ---------------------------------------------------------------------------

/** Publicador con cuenta (created_by) y su Trust Score resuelto en batch. */
export interface MemberPublisher {
  type: "member";
  profileId: string;
  displayName: string;
  avatarUrl: string | null;
  score: number;
  level: TrustLevel;
  signals: TrustSignal[];
}

/** Publicador externo de seed legal (publisher_name, sin cuenta). */
export interface ExternalPublisher {
  type: "external";
  name: string;
}

export type PublisherView = MemberPublisher | ExternalPublisher | null;

/** Verificación vinculada al listing (SOLO si hay found_active). */
export interface VerificationView {
  registry: string;
  registryUrl: string | null;
  licenseNumber: string | null;
  /** Fecha del check ya formateada ("6 de julio de 2026"). */
  dateLabel: string;
}
