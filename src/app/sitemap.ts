import type { MetadataRoute } from "next";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database.types";
import { DEFAULT_TENANT_SLUG } from "@/lib/tenant/resolve";

/**
 * sitemap.xml dinámico (módulo PRODUCTION READINESS).
 *
 * Cubre el tenant DEFAULT (dominicanos — el sitemap se sirve por dominio y hoy
 * hay un dominio de producción). Incluye las páginas públicas fijas + cada
 * guía publicada + cada propiedad publicada, con lastModified real.
 *
 * Cliente: supabase-js "pelado" con la anon key, SIN cookies — un sitemap no
 * tiene usuario y las policies RLS de contenido publicado permiten lectura
 * anónima (igual que la landing). Evitamos cookies()/headers() a propósito
 * para que la ruta no dependa de request context.
 *
 * Degradación elegante: si la DB no responde, devolvemos solo las URLs fijas
 * — un sitemap corto es infinitamente mejor que un 500 ante Googlebot.
 */

/** Tope de URLs — el protocolo permite 50k, pero cortamos ANTES de acercarnos. */
const MAX_URLS = 1000;

function baseUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

function anonClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = baseUrl();
  const now = new Date();

  const staticEntries: MetadataRoute.Sitemap = [
    { url: `${base}/`, lastModified: now, changeFrequency: "daily", priority: 1 },
    { url: `${base}/guias`, lastModified: now, changeFrequency: "weekly", priority: 0.9 },
    { url: `${base}/propiedades`, lastModified: now, changeFrequency: "daily", priority: 0.9 },
    { url: `${base}/escudo`, lastModified: now, changeFrequency: "weekly", priority: 0.8 },
    { url: `${base}/profesionales`, lastModified: now, changeFrequency: "weekly", priority: 0.7 },
    { url: `${base}/eventos`, lastModified: now, changeFrequency: "daily", priority: 0.7 },
  ];

  const supabase = anonClient();
  if (!supabase) return staticEntries;

  const dynamicEntries: MetadataRoute.Sitemap = [];
  const budget = MAX_URLS - staticEntries.length;

  try {
    // Tenant default: el id real lo da la DB (el fallback local usa placeholders).
    const { data: tenant } = await supabase
      .from("tenants")
      .select("id")
      .eq("slug", DEFAULT_TENANT_SLUG)
      .maybeSingle();

    // Guías publicadas — contenido SEO, mitad del presupuesto como máximo.
    const guidesQuery = supabase
      .from("guides")
      .select("slug, updated_at")
      .eq("status", "published")
      .order("updated_at", { ascending: false })
      .limit(Math.floor(budget / 2));
    const { data: guides } = tenant
      ? await guidesQuery.eq("tenant_id", tenant.id)
      : await guidesQuery;

    for (const guide of guides ?? []) {
      dynamicEntries.push({
        url: `${base}/guias/${guide.slug}`,
        lastModified: new Date(guide.updated_at),
        changeFrequency: "monthly",
        priority: 0.8,
      });
    }

    // Propiedades publicadas — el resto del presupuesto.
    const listingsQuery = supabase
      .from("listings")
      .select("id, updated_at")
      .eq("kind", "property")
      .eq("status", "published")
      .order("updated_at", { ascending: false })
      .limit(budget - dynamicEntries.length);
    const { data: listings } = tenant
      ? await listingsQuery.eq("tenant_id", tenant.id)
      : await listingsQuery;

    for (const listing of listings ?? []) {
      dynamicEntries.push({
        url: `${base}/propiedades/${listing.id}`,
        lastModified: new Date(listing.updated_at),
        changeFrequency: "weekly",
        priority: 0.6,
      });
    }
  } catch {
    // DB caída o seed pendiente: sitemap corto pero válido.
  }

  return [...staticEntries, ...dynamicEntries].slice(0, MAX_URLS);
}
