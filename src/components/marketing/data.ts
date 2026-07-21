import "server-only";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import type { Database, Tables } from "@/lib/types/database.types";
import { GUIDE_COVERS } from "./copy";
import type { GuideCardData } from "./guide-card";
import type { ListingMiniData } from "./listing-mini-card";

/**
 * Data access del módulo marketing. Todo con el cliente server (anon key +
 * cookies) → RLS aplica; ante cualquier error devolvemos vacío y la página
 * degrada elegante (secciones que se ocultan, nunca un error crudo).
 */

export type GuideRow = Pick<
  Tables<"guides">,
  | "id"
  | "slug"
  | "title"
  | "summary"
  | "body_md"
  | "topics"
  | "reading_minutes"
  | "sources"
  | "published_at"
  | "updated_at"
  | "city"
>;

const GUIDE_COLUMNS =
  "id,slug,title,summary,body_md,topics,reading_minutes,sources,published_at,updated_at,city";

/** ~200 palabras/min para guías sin reading_minutes cargado. */
export function estimateReadingMinutes(bodyMd: string): number {
  const words = bodyMd.split(/\s+/).filter(Boolean).length;
  return Math.max(2, Math.round(words / 200));
}

export function toGuideCardData(row: GuideRow): GuideCardData {
  return {
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    topics: row.topics ?? [],
    readingMinutes: row.reading_minutes ?? estimateReadingMinutes(row.body_md),
    cover: GUIDE_COVERS[row.slug] ?? null,
  };
}

/**
 * Cliente anon SIN cookies para las lecturas CACHEADAS de guías (patrón
 * fetchTenantRow): headers()/cookies() no se permiten dentro de un scope de
 * unstable_cache, y las guías published son PÚBLICAS por RLS (0007_social:
 * `status = 'published'` es legible por anon). Devuelve null si falta config.
 */
function anonGuidesClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return createServerClient<Database>(url, anonKey, {
    cookies: { getAll: () => [], setAll: () => {} },
  });
}

/**
 * Guías published CACHEADAS entre requests por (tenantId, limit). Las guías
 * published cambian rarísimo → 600s con tag "guides". La cache key incluye el
 * tenantId (globales tenant_id null + las del tenant) → JAMÁS se sirve el
 * catálogo de un tenant a otro. Invalidación on-demand:
 * revalidateTag("guides", "max") cuando exista una mutación de guías.
 */
const fetchPublishedGuidesCached = unstable_cache(
  async (tenantId: string, limit: number | null): Promise<GuideRow[]> => {
    const supabase = anonGuidesClient();
    if (!supabase) return [];
    let query = supabase
      .from("guides")
      .select(GUIDE_COLUMNS)
      .eq("status", "published")
      .or(`tenant_id.is.null,tenant_id.eq.${tenantId}`)
      .order("published_at", { ascending: false, nullsFirst: false });
    if (limit) query = query.limit(limit);

    const { data, error } = await query;
    if (error) return [];
    return data ?? [];
  },
  ["published-guides"],
  { revalidate: 600, tags: ["guides"] },
);

/** Guías published del tenant actual + globales (tenant_id null), recientes primero. */
export const fetchPublishedGuides = cache(async (limit?: number): Promise<GuideRow[]> => {
  try {
    // getTenant() (cacheado) se resuelve AFUERA del scope de cache: lee headers,
    // que unstable_cache no permite adentro. El tenantId entra como argumento.
    const tenant = await getTenant();
    return await fetchPublishedGuidesCached(tenant.id, limit ?? null);
  } catch {
    return [];
  }
});

/** Una guía published por slug (global o del tenant) CACHEADA por (tenantId, slug). */
const fetchGuideBySlugCached = unstable_cache(
  async (tenantId: string, slug: string): Promise<GuideRow | null> => {
    const supabase = anonGuidesClient();
    if (!supabase) return null;
    const { data, error } = await supabase
      .from("guides")
      .select(GUIDE_COLUMNS)
      .eq("status", "published")
      .eq("slug", slug)
      .or(`tenant_id.is.null,tenant_id.eq.${tenantId}`)
      .limit(1)
      .maybeSingle();
    if (error) return null;
    return data;
  },
  ["guide-by-slug"],
  { revalidate: 600, tags: ["guides"] },
);

/** Una guía published por slug (global o del tenant), o null. */
export const fetchGuideBySlug = cache(async (slug: string): Promise<GuideRow | null> => {
  try {
    const tenant = await getTenant();
    return await fetchGuideBySlugCached(tenant.id, slug);
  } catch {
    return null;
  }
});

/** Fuente oficial de una guía (jsonb `sources`), parseada a la defensiva. */
export interface GuideSource {
  label: string;
  url: string;
  checkedAt: string | null;
}

export function parseGuideSources(raw: unknown): GuideSource[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item): GuideSource[] => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const url = typeof record.url === "string" ? record.url : null;
    if (!url || !/^https?:\/\//i.test(url)) return [];
    const label =
      (typeof record.label === "string" && record.label) ||
      (typeof record.name === "string" && record.name) ||
      url;
    const checkedAt = typeof record.checked_at === "string" ? record.checked_at : null;
    return [{ label, url, checkedAt }];
  });
}

/** URL pública de una foto de listing (bucket listing-photos) o passthrough http(s). */
function photoPublicUrl(path: string | undefined): string | null {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return base ? `${base}/storage/v1/object/public/listing-photos/${path}` : null;
}

/**
 * Propiedades published recientes del tenant + su verificación found_active
 * (si existe — si no, AUSENCIA de banda, jamás un badge negativo §11).
 */
export const fetchRecentProperties = cache(
  async (limit = 4): Promise<ListingMiniData[]> => {
    try {
      const tenant = await getTenant();
      const supabase = await createClient();
      const { data, error } = await supabase
        .from("listings")
        .select(
          "id,title,price_amount,price_currency,price_period,area_label,photos,publisher_kind",
        )
        .eq("tenant_id", tenant.id)
        .eq("kind", "property")
        .eq("status", "published")
        .order("published_at", { ascending: false, nullsFirst: false })
        .limit(limit);
      if (error || !data || data.length === 0) return [];

      const ids = data.map((row) => row.id);
      const verificationByListing = new Map<string, { registry: string; checkedAt: string }>();
      const { data: checks } = await supabase
        .from("verification_checks")
        .select("subject_id,registry,checked_at")
        .eq("subject_kind", "listing")
        .eq("result", "found_active")
        .in("subject_id", ids);
      for (const check of checks ?? []) {
        if (check.subject_id && !verificationByListing.has(check.subject_id)) {
          verificationByListing.set(check.subject_id, {
            registry: check.registry,
            checkedAt: check.checked_at,
          });
        }
      }

      return data.map((row) => ({
        id: row.id,
        title: row.title,
        priceAmount: row.price_amount,
        priceCurrency: row.price_currency,
        pricePeriod: row.price_period,
        areaLabel: row.area_label,
        photoUrl: photoPublicUrl(row.photos?.[0]),
        publisherKind: row.publisher_kind,
        verification: verificationByListing.get(row.id) ?? null,
      }));
    } catch {
      return [];
    }
  },
);
