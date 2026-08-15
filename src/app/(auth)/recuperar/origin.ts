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
 *  - localhost / 127.0.0.1 en cualquier puerto, para dev.
 *
 * Lo legítimo no cambia: el enlace sigue volviendo al MISMO host donde la
 * persona se registró, siempre que ese host sea nuestro.
 *
 * =============================================================================
 * POR QUÉ HAY UNA VERSIÓN SÍNCRONA Y OTRA ASÍNCRONA (auditoría 2026-08-13)
 * =============================================================================
 * `KNOWN_TENANT_DOMAINS` sale de `DOMAIN_TENANTS`, el mapa HARDCODEADO. Desde
 * la migración 0060 los dominios se dan de alta en `public.tenant_domains`
 * desde el panel admin, sin commit ni deploy — y el propio comentario de
 * `DOMAIN_TENANTS` dice "NO hay que agregar acá los dominios nuevos". Resultado
 * medido: una comunidad con dominio recién dado de alta se servía perfecto (el
 * proxy sí lee la base) pero sus correos de confirmación y de reset salían
 * apuntando al host canónico de Vercel en vez de a SU dominio. Nadie lo nota
 * hasta que alguien no encuentra el enlace.
 *
 * El arreglo es preguntarle a la misma fuente que el proxy, reusando
 * `lookupTenantDomain` (caché de 300s, timeout de 1,5s y stale-on-error de 24h
 * ya resueltos ahí — no se escribe una segunda consulta). Pero esa consulta es
 * ASÍNCRONA y `resolveOrigin` lo llaman cuatro server actions que hoy la usan
 * sin `await`. Entonces conviven dos:
 *
 *   · `resolveOrigin` / `isAllowedOriginHost` — síncronas, la allowlist de
 *     siempre (mapa hardcodeado + hosts de la plataforma + loopback). Es el
 *     camino que se usa HOY.
 *   · `resolveOriginAsync` / `isAllowedOriginHostAsync` — las mismas más la
 *     consulta a `tenant_domains`. Es el camino correcto.
 *
 * ⏳ PENDIENTE, y es de una palabra: cambiar los cuatro call sites a
 * `await resolveOriginAsync(...)` — `src/app/(auth)/actions.ts` (319, 360, 489)
 * y `src/app/(auth)/oauth-actions.ts` (78), las cuatro dentro de funciones ya
 * async. Cuando eso pase, las versiones síncronas se borran.
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
 * ¿Este `host[:port]` es uno de los nuestros SEGÚN LO QUE SABE EL CÓDIGO?
 * Loopback + mapa hardcodeado de tenants + hosts que declara la plataforma.
 *
 * No consulta la base: es el respaldo del que `isAllowedOriginHostAsync` parte,
 * y el que se usa cuando la base no puede consultarse.
 */
export function isAllowedOriginHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  if (!normalized) return false;

  const hostname = normalized.split(":")[0];
  if (isLoopback(hostname)) return true;
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
  if (isAllowedOriginHost(host)) return true;

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

/** Versión síncrona: sólo la allowlist del código. Ver el bloque de arriba. */
export function resolveOrigin(headers: Headers): string {
  const host = requestHost(headers);
  // Host ausente o ajeno → la URL canónica del deploy.
  return host && isAllowedOriginHost(host) ? originFor(headers, host) : canonicalOrigin();
}

/**
 * Versión que además reconoce los dominios cargados en `tenant_domains`.
 *
 * Es la que corresponde usar: sin ella, una comunidad con dominio propio dado
 * de alta desde el panel recibe sus correos de confirmación apuntando al host
 * de Vercel. Misma degradación que la síncrona ante cualquier duda.
 */
export async function resolveOriginAsync(headers: Headers): Promise<string> {
  const host = requestHost(headers);
  if (!host) return canonicalOrigin();
  return (await isAllowedOriginHostAsync(host)) ? originFor(headers, host) : canonicalOrigin();
}
