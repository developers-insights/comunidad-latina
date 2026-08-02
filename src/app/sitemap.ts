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
 *
 * ⚠️ SIN TENANT NO SE PUBLICA NADA DINÁMICO (auditoría 2026-08-02). Antes el
 * `.eq("tenant_id", …)` se aplicaba sólo SI el lookup de `tenants` había
 * devuelto fila; si fallaba o venía `null`, las queries salían SIN FILTRAR y el
 * sitemap le entregaba a Google las guías y propiedades de TODAS las comunidades
 * mezcladas bajo un mismo dominio. El fallback correcto ante un tenant que no
 * resuelve es no publicar nada dinámico — nunca "publicar todo": de las dos
 * degradaciones posibles, una pierde SEO por un rato y la otra filtra el
 * contenido de una comunidad en el dominio de otra, y encima ante un buscador
 * que lo indexa.
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

  // `/` NO va en el sitemap: hoy responde 307 a /entrar (decisión de producto,
  // ver el bloque `redirects` de next.config.ts — la landing dejó de ser la
  // puerta de entrada). Entregarle a Google una URL con prioridad máxima que
  // redirige es gastar crawl budget en un salto, y el destino real (/entrar) es
  // un formulario de login sin nada que indexar. La prioridad 1 pasa a /guias,
  // que es el contenido con el que este producto se posiciona de verdad.
  // Si algún día vuelve la landing (borrar ese bloque de redirects), su entrada
  // vuelve acá.
  const staticEntries: MetadataRoute.Sitemap = [
    { url: `${base}/guias`, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/propiedades`, lastModified: now, changeFrequency: "daily", priority: 0.9 },
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

    // Sin tenant resuelto (DB caída, seed pendiente, slug renombrado) no hay con
    // qué acotar las queries de abajo: se publica SÓLO lo fijo. Ver la cabecera
    // — la alternativa era emitir el contenido de todas las comunidades juntas.
    if (!tenant) return staticEntries;

    // Guías publicadas — contenido SEO, mitad del presupuesto como máximo.
    const { data: guides } = await supabase
      .from("guides")
      .select("slug, updated_at")
      .eq("tenant_id", tenant.id)
      .eq("status", "published")
      .order("updated_at", { ascending: false })
      .limit(Math.floor(budget / 2));

    for (const guide of guides ?? []) {
      dynamicEntries.push({
        url: `${base}/guias/${guide.slug}`,
        lastModified: new Date(guide.updated_at),
        changeFrequency: "monthly",
        priority: 0.8,
      });
    }

    // Propiedades publicadas — el resto del presupuesto.
    const { data: listings } = await supabase
      .from("listings")
      .select("id, updated_at")
      .eq("tenant_id", tenant.id)
      .eq("kind", "property")
      .eq("status", "published")
      .order("updated_at", { ascending: false })
      .limit(budget - dynamicEntries.length);

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
