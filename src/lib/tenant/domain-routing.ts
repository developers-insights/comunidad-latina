/**
 * La DECISIÓN del proxy, en una función pura.
 *
 * `./domain-lookup` hace el I/O (RPC + caché) y `src/middleware.ts` aplica el
 * resultado sobre el `NextResponse`. Acá vive lo único que puede estar
 * sutilmente mal — la regla — para poder testearla sin un solo mock, igual que
 * `./match` hace con la divergencia tenant-del-request ↔ tenant-del-usuario.
 *
 * Las cuatro salidas posibles y su porqué:
 *
 *  - `serve`   → seguí normal con este slug.
 *  - `redirect`→ el host es un alias; el canónico del tenant es otro. Se
 *                redirige preservando path y query (308: conserva el método y
 *                le dice a los buscadores que es permanente).
 *  - `unknown-domain` → la base CONTESTÓ que este host no sirve contenido:
 *                no registrado, `suspended`, `archived` o tenant pausado. Los
 *                cuatro son indistinguibles a propósito (0060). Respuesta: 404
 *                con una página propia, `no-store` y `noindex`. NO un 500, y
 *                sobre todo NO la comunidad por defecto: servirle a
 *                `dominiosuspendido.com` el contenido de otra comunidad sería
 *                exactamente el bug que el `status` viene a cerrar.
 *  - `unavailable-domain` → la base NO contestó y nadie sabe qué es este host:
 *                no es de la plataforma, no está en el respaldo `DOMAIN_TENANTS`
 *                y no hay caché rancio. Respuesta: 503 + `Retry-After`. Elegir
 *                503 y no "la comunidad por defecto" es la misma decisión que ya
 *                documenta `classifyTenantMatch` para `tenant-unavailable`: ante
 *                una caída de infra nunca afirmamos de más. Servir la comunidad
 *                equivocada en el dominio de un cliente es peor que un error
 *                honesto y temporal.
 */

import {
  DEFAULT_TENANT_SLUG,
  domainFallbackSlug,
  isActiveCommunitySlug,
} from "./resolve";
import type { TenantDomainLookup } from "./domain-lookup";

export type TenantRoutingSource =
  /** La base resolvió el host. */
  | "db"
  /** La base no contestó pero teníamos su respuesta anterior en caché. */
  | "stale"
  /** Host de la plataforma (deploy compartido, preview, localhost). */
  | "platform"
  /** Respaldo: `DOMAIN_TENANTS` o las pistas de dev, con la base caída. */
  | "fallback";

export type TenantRouting =
  | { kind: "serve"; slug: string; source: TenantRoutingSource }
  | { kind: "redirect"; location: string }
  | { kind: "unknown-domain" }
  | { kind: "unavailable-domain" };

export interface TenantRoutingInput {
  /** Host YA normalizado (`normalizeHost`). */
  hostname: string;
  /** `isPlatformHost(hostname)`. */
  isPlatform: boolean;
  /** Resultado de `lookupTenantDomain`. */
  lookup: TenantDomainLookup;
  /**
   * Lo que devuelve el resolver histórico `resolveTenantSlug(...)`: respaldo
   * `DOMAIN_TENANTS` + pistas de dev (`?cl-tenant=`, cookie `cl-tenant`) +
   * comunidad por defecto.
   * Se calcula afuera para que esta función siga siendo pura.
   */
  hintSlug: string;
  method: string;
  pathname: string;
  /** Query string CON el `?`, tal como la da `nextUrl.search`. */
  search: string;
}

/**
 * Un slug reservado de marca/legal (`RESERVED_BRAND_SLUGS`) NUNCA se sirve como
 * comunidad pública — tampoco si vino de la base.
 *
 * Sin este clamp, cargar `comunidadlatina.com` en `tenant_domains` habría
 * revertido en silencio una decisión de marca que se tomó a mano y por escrito
 * (specimen de marca registrada en curso; ver el comentario de
 * `RESERVED_BRAND_SLUGS` en `./resolve`). La base es la fuente de verdad del
 * MAPEO host→tenant, no de qué tenants son públicos.
 */
function clampToPublicCommunity(slug: string): string {
  return isActiveCommunitySlug(slug) ? slug : DEFAULT_TENANT_SLUG;
}

/**
 * ¿El canónico es otro host? Sólo entonces se redirige.
 *
 * Cortafuegos contra bucles, en orden:
 *  1. `primaryDomain` viene normalizado por la base (trigger de 0060) y
 *     `hostname` por `normalizeHost`, que espeja ese mismo trigger. La
 *     comparación es entre iguales, así que llegar al canónico apaga la
 *     condición y el segundo request ya no redirige.
 *  2. Nunca se redirige un host de la plataforma: un preview de Vercel o
 *     localhost jamás debe saltar al dominio de producción de un cliente.
 *  3. Sólo GET/HEAD: un 308 sobre un POST reenviaría el cuerpo a otro host.
 *     Un alias sirve los métodos con escritura en su propio host, sin saltar.
 *  4. Sólo cuando el slug de la base sobrevivió al clamp de marca: si el
 *     canónico apunta a un tenant reservado, redirigir sería llevar al
 *     visitante a un sitio que igual no se le va a mostrar.
 */
function shouldRedirectToCanonical(
  input: TenantRoutingInput,
  primaryDomain: string,
  clamped: boolean,
): boolean {
  if (clamped) return false;
  if (input.isPlatform) return false;
  if (input.method !== "GET" && input.method !== "HEAD") return false;
  return primaryDomain !== "" && primaryDomain !== input.hostname;
}

export function decideTenantRouting(input: TenantRoutingInput): TenantRouting {
  const { lookup } = input;

  if (lookup.status === "match") {
    const slug = clampToPublicCommunity(lookup.slug);
    const clamped = slug !== lookup.slug;
    const primaryDomain = lookup.primaryDomain ?? "";

    if (shouldRedirectToCanonical(input, primaryDomain, clamped)) {
      // https fijo: los dominios propios entran por Vercel, que emite el
      // certificado al darlos de alta. Los únicos hosts que hoy podrían hablar
      // http son los de la plataforma, y esos ya quedaron afuera arriba.
      return {
        kind: "redirect",
        location: `https://${primaryDomain}${input.pathname}${input.search}`,
      };
    }

    return { kind: "serve", slug, source: lookup.stale ? "stale" : "db" };
  }

  if (lookup.status === "skipped") {
    // Host efímero de la plataforma o sin forma de hostname: nunca fue un
    // dominio propio, así que manda el comportamiento histórico.
    return { kind: "serve", slug: input.hintSlug, source: "platform" };
  }

  if (lookup.status === "unknown") {
    // La base habló. En un host de la plataforma "no hay fila" es lo NORMAL
    // (el deploy compartido no está en `tenant_domains` y no tiene por qué
    // estarlo) → se sigue con el comportamiento de siempre. En un dominio
    // propio, en cambio, "no hay fila" es la respuesta correcta y definitiva.
    return input.isPlatform
      ? { kind: "serve", slug: input.hintSlug, source: "platform" }
      : { kind: "unknown-domain" };
  }

  // lookup.status === "unavailable": la base no contestó.
  if (input.isPlatform) {
    return { kind: "serve", slug: input.hintSlug, source: "fallback" };
  }
  const backup = domainFallbackSlug(input.hostname);
  if (backup) {
    // Acá y en ningún otro lado se usa `DOMAIN_TENANTS`: respaldo, no fuente.
    return { kind: "serve", slug: clampToPublicCommunity(backup), source: "fallback" };
  }
  return { kind: "unavailable-domain" };
}

/* -------------------------------------------------------------------------- */
/* Páginas de error del proxy                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Se sirven desde el proxy y no desde una ruta de `app/` porque en estos dos
 * casos NO HAY TENANT: no se puede renderizar el shell (que empieza por
 * `getTenant()`) sin decidir antes una comunidad, que es justamente lo que no
 * sabemos. Son páginas autocontenidas, sin assets, y no reflejan el `Host` —
 * ese valor lo elige el cliente y meterlo en el HTML sería regalar un XSS.
 */
function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${title}</title>
<style>
:root{color-scheme:light dark}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:2rem;
font:16px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;
background:Canvas;color:CanvasText}
main{max-width:32rem;text-align:center}
h1{font-size:1.375rem;line-height:1.3;margin:0 0 .75rem;font-weight:600}
p{margin:0;opacity:.75}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.9em}
</style>
</head>
<body><main><h1>${title}</h1><p>${body}</p></main></body>
</html>`;
}

export interface ProxyErrorPage {
  status: number;
  html: string;
  headers: Record<string, string>;
}

const BASE_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "x-robots-tag": "noindex, nofollow",
};

/**
 * 404 para dominio desconocido, suspendido o archivado. Un solo mensaje para
 * los tres: la base los devuelve indistinguibles a propósito, y el copy no
 * puede filtrar lo que el RPC se cuida de no contar.
 */
export const UNKNOWN_DOMAIN_PAGE: ProxyErrorPage = {
  status: 404,
  headers: BASE_HEADERS,
  html: page(
    "Acá todavía no hay una comunidad",
    "Esta dirección no está mostrando ninguna comunidad en este momento. Si llegaste desde un enlace, revisá que esté bien escrito.",
  ),
};

/** 503 mientras no podemos saber a qué comunidad pertenece este dominio. */
export const DOMAIN_UNAVAILABLE_PAGE: ProxyErrorPage = {
  status: 503,
  headers: { ...BASE_HEADERS, "retry-after": "30" },
  html: page(
    "No pudimos cargar esta comunidad",
    "Es un problema nuestro, no tuyo. Probá de nuevo en un minuto.",
  ),
};

/**
 * Escapa lo que se interpola en el HTML de arriba.
 *
 * El slug llega ya saneado por `sanitizeSlug` (`[a-z0-9-]{1,40}`), así que hoy
 * no puede traer nada peligroso. Se escapa igual: la garantía vive en OTRO
 * archivo, y el día que ese regex se afloje nadie va a venir a mirar acá. Es
 * la misma razón por la que estas páginas nunca reflejan el `Host`.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * LA PISTA DE DESARROLLO APUNTA A UNA COMUNIDAD QUE NO EXISTE.
 *
 * Sólo se sirve en desarrollo, que es donde las pistas del cliente están
 * habilitadas (`clientTenantHintsAllowed()`), y sólo cuando la base CONTESTÓ
 * que no hay fila con ese slug (ver `./slug-lookup`).
 *
 * Existe porque el modo de falla anterior era el peor posible: la app entera se
 * veía vacía, sin un solo error, y la causa —una cookie `cl-tenant` de 30 días
 * escrita por un `?t=ofertas` que en realidad era el nombre de una pestaña— era
 * literalmente inadivinable. Un error honesto y ruidoso a los tres segundos
 * vale más que una app muda.
 *
 * El proxy que sirve esta página BORRA además la cookie, así que recargar
 * alcanza para volver a la normalidad. El texto lo dice, porque una acción que
 * ya pasó y no se cuenta no le sirve a nadie.
 */
export function unknownTenantHintPage(slug: string): ProxyErrorPage {
  const seguro = escapeHtml(slug);
  return {
    status: 404,
    headers: BASE_HEADERS,
    html: page(
      `No existe la comunidad “${seguro}”`,
      `La pista de desarrollo pedía la comunidad <code>${seguro}</code> y en la base no hay ninguna con ese nombre. ` +
        `Sin esto la app se vería entera vacía y sin errores, que es peor. ` +
        `Ya te borré la cookie <code>cl-tenant</code>: recargá y volvés a la comunidad por defecto. ` +
        `Si querías otra, la pista se pasa como <code>?cl-tenant=&lt;slug&gt;</code> — ` +
        `<code>?t=</code> es el parámetro de las PESTAÑAS de cada módulo y no toca el tenant.`,
    ),
  };
}
