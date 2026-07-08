import type { MetadataRoute } from "next";

/**
 * robots.txt (módulo PRODUCTION READINESS).
 *
 * Indexable: landing, guías SEO y los directorios públicos (propiedades,
 * profesionales, eventos, escudo). Todo lo que es privado o de sesión queda
 * fuera del índice — no por seguridad (eso lo da RLS/auth), sino para que
 * Google no gaste crawl budget ni muestre pantallas de login en resultados.
 */

function baseUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

/**
 * Solo los dominios REALES del producto se indexan (los mismos de DOMAIN_TENANTS
 * en `lib/tenant/resolve.ts`). Un deploy de demo en `*.vercel.app`, un preview o
 * localhost, jamás: indexarlos generaría contenido duplicado que le compite al
 * dominio real — justo el SEO que motiva la lectura cross-tenant de `listings_select`.
 */
const INDEXABLE_HOSTS = new Set([
  "dominicanos.com",
  "www.dominicanos.com",
  "comunidadlatina.com",
  "www.comunidadlatina.com",
]);

function isIndexable(): boolean {
  try {
    return INDEXABLE_HOSTS.has(new URL(baseUrl()).hostname.toLowerCase());
  } catch {
    return false; // NEXT_PUBLIC_SITE_URL mal formada → no indexar (fail-closed).
  }
}

export default function robots(): MetadataRoute.Robots {
  // Demo / preview / local → nada de crawling, y sin sitemap que seguir.
  if (!isIndexable()) {
    return { rules: [{ userAgent: "*", disallow: "/" }] };
  }

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/admin",
          "/api/",
          "/mensajes",
          "/perfil",
          "/notificaciones",
          "/publicar",
          "/~offline",
        ],
      },
    ],
    sitemap: `${baseUrl()}/sitemap.xml`,
  };
}
