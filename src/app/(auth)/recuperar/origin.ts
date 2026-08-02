import { getSiteUrl } from "@/lib/email/templates";
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

/** ¿Este `host[:port]` es uno de los nuestros? */
export function isAllowedOriginHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  if (!normalized) return false;

  const hostname = normalized.split(":")[0];
  if (isLoopback(hostname)) return true;
  if (KNOWN_TENANT_DOMAINS.has(hostname)) return true;

  return configuredHosts().some((known) => known.toLowerCase() === normalized);
}

export function resolveOrigin(headers: Headers): string {
  const host = headers.get("x-forwarded-host")?.trim() || headers.get("host")?.trim();

  if (host && isAllowedOriginHost(host)) {
    const proto = headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
    // El esquema también se acota a http|https: un `x-forwarded-proto`
    // arbitrario no puede convertirse en el prefijo de una URL que después se
    // pinta como <a href> dentro de un correo.
    const scheme =
      proto === "http" || proto === "https"
        ? proto
        : isLoopback(host.split(":")[0])
          ? "http"
          : "https";
    return `${scheme}://${host}`;
  }

  // Host ausente o ajeno → la URL canónica del deploy (misma lógica que usan
  // los templates de correo, sin duplicarla acá).
  return getSiteUrl().replace(/\/+$/, "");
}
