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

export default function robots(): MetadataRoute.Robots {
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
