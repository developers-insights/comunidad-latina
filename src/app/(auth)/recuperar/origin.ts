import { getSiteUrl } from "@/lib/email/templates";
import { lookupTenantDomain, normalizeHost } from "@/lib/tenant/domain-lookup";
import { KNOWN_TENANT_DOMAINS } from "@/lib/tenant/resolve";

/**
 * Resuelve el origin público (esquema + host) para armar los enlaces ABSOLUTOS
 * que viajan por correo: el `redirectTo` del reset de contraseña y, sobre todo,
 * el `/confirmar?token_hash=…` que abre sesión de una.
 *
 * POR QUÉ HAY UNA ALLOWLIST Y NO SE CONFÍA EN EL HEADER (auditoría 2026-08-02)
 * ---------------------------------------------------------------------------
 * Antes esto devolvía `x-forwarded-host` (o `host`) tal cual venía. Eso es
 * host-header poisoning de manual, y acá el premio es grande: quien logre colar
 * un host propio recibe EN SU DOMINIO el enlace de confirmación de una cuenta
 * ajena — un token de un solo uso que abre sesión sin pedir la contraseña. O
 * sea, toma de cuenta.
 *
 * El código anterior lo sabía y lo dejaba anotado como "⚠️ SUPUESTO VERCEL: la
 * plataforma normaliza esos headers". Puede ser cierto hoy en Vercel, pero es
 * una garantía de infraestructura ajena, escrita en un comentario, sosteniendo
 * el flujo de auth entero. La allowlist convierte ese supuesto en un control:
 * si el host del request no es de los nuestros no se usa, y el correo sigue
 * saliendo con la URL canónica del deploy en vez de no salir.
 *
 * Qué se acepta:
 *  - los dominios propios de los tenants (`KNOWN_TENANT_DOMAINS`),
 *  - los hosts que calcula la plataforma (`VERCEL_PROJECT_PRODUCTION_URL`,
 *    `VERCEL_URL`, `VERCEL_BRANCH_URL`) — así los previews siguen andando,
 *  - el host de `NEXT_PUBLIC_SITE_URL`,
 *  - localhost / 127.0.0.1 en cualquier puerto, SÓLO fuera de Vercel (dev).
 *
 * Lo legítimo no cambia: el enlace sigue volviendo al MISMO host donde la
 * persona se registró, siempre que ese host sea nuestro.
 *
 * =============================================================================
 * POR QUÉ CONSULTA LA BASE (auditoría 2026-08-13)
 * =============================================================================
 * `KNOWN_TENANT_DOMAINS` sale de `DOMAIN_TENANTS`, el mapa HARDCODEADO. Desde
 * la migración 0060 los dominios se dan de alta en `public.tenant_domains`
 * desde el panel admin, sin commit ni deploy. Con sólo el mapa, una comunidad
 * con dominio recién dado de alta recibía sus correos de confirmación y de
 * reset apuntando al host canónico de Vercel. Por eso se le pregunta a la misma
 * fuente que el proxy, reusando `lookupTenantDomain` (caché de 300s, timeout de
 * 1,5s y stale-on-error de 24h ya resueltos ahí).
 *
 * Hasta 2026-09 convivía una versión síncrona sin la consulta; se borró cuando
 * los cuatro call sites pasaron a `await resolveOriginAsync(...)`.
 *
 * EL FALLO SIGUE SIENDO FAIL-CLOSED. La base sólo puede AGREGAR hosts, nunca
 * sacar el corte: si no contesta, o contesta que el host no existe, la
 * respuesta es la misma que antes (el host no se honra y el correo sale con la
 * URL canónica del deploy). Un origin permisivo en un mail de reset es un
 * redirect abierto con un token de sesión adentro; de ahí no se sale por
 * degradación.
 */

/** Hosts que la plataforma o la config declaran como propios. */
function configuredHosts(): string[] {
  const raw = [
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
    process.env.VERCEL_URL,
    process.env.VERCEL_BRANCH_URL,
    process.env.NEXT_PUBLIC_SITE_URL,
  ];

  const hosts: string[] = [];
  for (const value of raw) {
    const trimmed = value?.trim();
    if (!trimmed) continue;
    try {
      // Las env de Vercel vienen SIN esquema ("mi-app.vercel.app"); la del sitio
      // viene con esquema. `new URL` con base sintética cubre las dos formas.
      hosts.push(new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`).host);
    } catch {
      // Env mal formada: se ignora en vez de romper el registro.
    }
  }
  return hosts;
}

function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

/**
 * Loopback + mapa hardcodeado de tenants + hosts que declara la plataforma.
 * No consulta la base: es el respaldo cuando la base no puede consultarse.
 */
function isKnownOriginHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  if (!normalized) return false;

  const hostname = normalized.split(":")[0];
  // En Vercel nadie legítimo llega por loopback: honrarlo sólo serviría para
  // que un header forjado deje un enlace a localhost dentro de un correo.
  if (isLoopback(hostname)) {
    return process.env.VERCEL_ENV !== "production" && process.env.VERCEL_ENV !== "preview";
  }
  if (KNOWN_TENANT_DOMAINS.has(hostname)) return true;

  return configuredHosts().some((known) => known.toLowerCase() === normalized);
}

/**
 * Lo mismo, más los dominios que existen SÓLO en `public.tenant_domains` —
 * los que se dieron de alta desde el panel admin después del último deploy.
 *
 * El orden importa y es deliberado: primero lo que ya se sabe sin red (así un
 * host de la plataforma o de dev nunca depende de que la base conteste), y sólo
 * si no se lo conoce se pregunta. Un `unknown`, un `unavailable` o un `skipped`
 * devuelven `false`, que es el mismo `false` de siempre: la base puede sumar
 * hosts propios, nunca aflojar el corte.
 */
export async function isAllowedOriginHostAsync(host: string): Promise<boolean> {
  if (isKnownOriginHost(host)) return true;

  const hostname = normalizeHost(host);
  if (!hostname) return false;

  const lookup = await lookupTenantDomain(hostname);
  return lookup.status === "match";
}

/** El host del request, si vino. `x-forwarded-host` primero, como el proxy. */
function requestHost(headers: Headers): string | null {
  return headers.get("x-forwarded-host")?.trim() || headers.get("host")?.trim() || null;
}

/** La URL canónica del deploy, sin barra final. Misma que usan los templates. */
function canonicalOrigin(): string {
  return getSiteUrl().replace(/\/+$/, "");
}

/**
 * `esquema://host` para un host YA validado.
 *
 * El esquema se acota a http|https: un `x-forwarded-proto` arbitrario no puede
 * convertirse en el prefijo de una URL que después se pinta como <a href>
 * dentro de un correo.
 */
function originFor(headers: Headers, host: string): string {
  const proto = headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const scheme =
    proto === "http" || proto === "https"
      ? proto
      : isLoopback(host.split(":")[0])
        ? "http"
        : "https";
  return `${scheme}://${host}`;
}

/**
 * El origin público validado del request. Ante cualquier duda (host ajeno,
 * base caída con host desconocido) devuelve la URL canónica del deploy.
 */
export async function resolveOriginAsync(headers: Headers): Promise<string> {
  const host = requestHost(headers);
  if (!host) return canonicalOrigin();
  return (await isAllowedOriginHostAsync(host)) ? originFor(headers, host) : canonicalOrigin();
}

/**
 * Lo mismo para un Route Handler: primero los headers (como el proxy), y si no
 * trae ninguno, el host de `request.url` — siempre pasando por la allowlist.
 * Detrás de un proxy propio `request.url` puede ser el host interno; por eso
 * no se usa su origin a secas para armar un redirect.
 */
export async function resolveRequestOrigin(request: Request): Promise<string> {
  const headers = new Headers(request.headers);
  if (!requestHost(headers)) {
    const url = new URL(request.url);
    headers.set("host", url.host);
    if (!headers.get("x-forwarded-proto")) {
      headers.set("x-forwarded-proto", url.protocol.replace(/:$/, ""));
    }
  }
  return resolveOriginAsync(headers);
}
