import type { MetadataRoute } from "next";
import { lookupTenantDomain, normalizeHost } from "@/lib/tenant/domain-lookup";
import { domainFallbackSlug } from "@/lib/tenant/resolve";

/**
 * robots.txt (módulo PRODUCTION READINESS).
 *
 * Indexable: landing, guías SEO y los directorios públicos (propiedades,
 * profesionales, eventos, escudo). Todo lo que es privado o de sesión queda
 * fuera del índice — no por seguridad (eso lo da RLS/auth), sino para que
 * Google no gaste crawl budget ni muestre pantallas de login en resultados.
 *
 * POR QUÉ ESTA RUTA ES DINÁMICA (auditoría 2026-08-13)
 * ---------------------------------------------------------------------------
 * Un `robots.js` es "a special Route Handler that is cached by default unless
 * it uses a Request-time API or dynamic config option"
 * (node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/
 * 01-metadata/robots.md). Cacheado quiere decir horneado EN EL BUILD, y eso es
 * justamente lo que hay que evitar: la lista de dominios que se sirven vive en
 * `public.tenant_domains` y se edita desde el panel admin, sin deploy. Si esta
 * ruta se prerenderizara, un dominio dado de alta hoy seguiría con
 * `Disallow: /` hasta el próximo deploy — el bug que este archivo viene a
 * cerrar, con otra cara. `dynamic = "force-dynamic"` la deja resolver por
 * request; el costo es un RPC por host cada 5 minutos, porque
 * `lookupTenantDomain` ya cachea en memoria.
 */
export const dynamic = "force-dynamic";

function baseUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

/**
 * ¿Este deploy se indexa?
 *
 * Antes esto se decidía contra `INDEXABLE_HOSTS`, cuatro hosts escritos a mano
 * en este archivo. El problema no era la lista: era que el panel admin
 * (`app/admin/global/dominios/actions.ts`) da de alta dominios EN LA TABLA
 * `tenant_domains`, no en el código. El dominio nuevo se servía perfecto —el
 * proxy sí lee la base desde la migración 0060— pero su `robots.txt` decía
 * `Disallow: /`, o sea la comunidad entera fuera de Google, y nadie se enteraba
 * hasta semanas después. Ahora la pregunta se la hacemos a la misma fuente que
 * el proxy, reusando `lookupTenantDomain` (que ya trae caché de 300s, timeout
 * de 1,5s y stale-on-error de 24h — no hay una segunda consulta).
 *
 * ⚠️ SIGUE SIENDO FAIL-CLOSED, Y ESO NO SE AFLOJA. Un `robots.txt` permisivo
 * por error es contenido duplicado indexado en un preview compitiéndole al
 * dominio real, y eso no se deshace pidiéndolo. Entonces:
 *
 *   · `match`       → la base dice que este host sirve una comunidad activa →
 *                     se indexa. Es el caso que el arreglo destraba.
 *   · `unknown`     → la base CONTESTÓ y no hay fila (no registrado, suspendido,
 *                     archivado, tenant pausado) → NO se indexa.
 *   · `skipped`     → host efímero de la plataforma (`*.vercel.app`), localhost
 *                     o algo sin forma de hostname → NO se indexa. Es
 *                     exactamente el caso de un preview.
 *   · `unavailable` → la base NO contestó. Acá NO se abre la puerta: el único
 *                     respaldo es el mapa hardcodeado `DOMAIN_TENANTS` (vía
 *                     `domainFallbackSlug`), igual que hace el proxy en
 *                     `decideTenantRouting`. Un host que no está en ese mapa se
 *                     queda sin indexar hasta que la base vuelva. Perder unas
 *                     horas de crawl es reversible; indexar de más, no.
 */
async function isIndexable(): Promise<boolean> {
  let hostname: string;
  try {
    hostname = normalizeHost(new URL(baseUrl()).hostname);
  } catch {
    return false; // NEXT_PUBLIC_SITE_URL mal formada → no indexar (fail-closed).
  }

  const lookup = await lookupTenantDomain(hostname);
  switch (lookup.status) {
    case "match":
      return true;
    case "unavailable":
      return domainFallbackSlug(hostname) !== null;
    case "unknown":
    case "skipped":
      return false;
  }
}

export default async function robots(): Promise<MetadataRoute.Robots> {
  // Demo / preview / local / dominio que la base no reconoce → nada de
  // crawling, y sin sitemap que seguir.
  if (!(await isIndexable())) {
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
