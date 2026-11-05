/**
 * La URL pública del sitio, en un solo lugar.
 *
 * ── EL BUG ───────────────────────────────────────────────────────────────────
 * Había 38 copias de `process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"`
 * (o con el dominio escrito a mano). Con la env ausente, un deploy real armaba
 * enlaces a la máquina de nadie: la vuelta de un pago de Stripe, un correo, un
 * enlace de verificación. No fallaba nada: el usuario recibía un enlace muerto.
 *
 * ── POR QUÉ HAY DOS FUNCIONES Y NO UNA ───────────────────────────────────────
 * "Fallar fuerte" no puede significar lo mismo en todos lados:
 *
 *   · `requireSiteUrl()` LANZA en producción. Es para lo que corre al atender
 *     un request y se va a otro lado: acciones de servidor, route handlers,
 *     correos, Stripe. Ahí un enlace malo no se nota hasta que alguien lo toca;
 *     una excepción cae en el log y en Sentry en el primer intento.
 *
 *   · `siteUrlForMetadata()` NUNCA lanza. Es para lo que se evalúa al IMPORTAR
 *     un módulo o al prerenderizar: `metadataBase`, canonicals, JSON-LD, robots,
 *     sitemap. Muchas de esas constantes viven en el nivel superior del módulo,
 *     así que un `throw` ahí tira `next build` entero si la env falta en ese
 *     momento, y en runtime tira TODA página que importe el módulo, incluidas
 *     las legales. Una etiqueta `og:url` con el dominio canónico es un error
 *     menor; un sitio caído por una etiqueta, no. Cae al dominio canónico, nunca
 *     a localhost, y lo deja escrito en el log (una vez por proceso).
 *
 * La regla, que `site-url.test.ts` hace cumplir: `requireSiteUrl()` se llama
 * adentro de una función que corre en un request, jamás en el nivel superior.
 *
 * ── QUÉ CUENTA COMO "PRODUCCIÓN" ─────────────────────────────────────────────
 * Cualquier deploy: `NODE_ENV=production` o `VERCEL_ENV` presente, igual que
 * `isPagosDemoPermitido` en `config/services.ts`. Los previews de Vercel son
 * deploys, pero ahí la plataforma da un host válido (`VERCEL_URL`) y usarlo es
 * mejor que romper una prueba. En producción no se usa ese host: es efímero y
 * no pertenece a ningún tenant, así que tampoco es una salida aceptable.
 *
 * Ojo: Next incrusta `NEXT_PUBLIC_*` al compilar. Corregir la env en Vercel pide
 * un redeploy para que surta efecto.
 */

const DEV_SITE_URL = "http://localhost:3000";

/** Respaldo de la metadata. Mismo host que carga la app de iPhone. */
export const CANONICAL_SITE_URL = "https://www.comunidadlatina.com";

export class SiteUrlConfigError extends Error {
  constructor(motivo: string) {
    super(
      `[site-url] ${motivo}. Definí NEXT_PUBLIC_SITE_URL con la URL pública del sitio (por ejemplo ${CANONICAL_SITE_URL}) y volvé a desplegar.`,
    );
    this.name = "SiteUrlConfigError";
  }
}

function isDeployed(): boolean {
  return process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL_ENV);
}

function isLocalHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "0.0.0.0" ||
    hostname === "[::1]" ||
    /^127\./.test(hostname)
  );
}

/** La env normalizada, o `null` si falta o no es una URL http(s). */
function readConfiguredUrl(): URL | null {
  const raw = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

function withoutTrailingSlash(url: URL): string {
  return url.href.replace(/\/+$/, "");
}

/**
 * La URL pública para armar enlaces absolutos, sin barra final.
 *
 * @throws {SiteUrlConfigError} en producción, si la env falta, está mal formada
 * o apunta a una máquina local.
 */
export function requireSiteUrl(): string {
  const configured = readConfiguredUrl();

  if (!isDeployed()) {
    return configured ? withoutTrailingSlash(configured) : DEV_SITE_URL;
  }

  if (configured && !isLocalHostname(configured.hostname)) {
    return withoutTrailingSlash(configured);
  }

  const vercelEnv = process.env.VERCEL_ENV;
  const deployHost = process.env.VERCEL_URL?.trim();
  if (vercelEnv && vercelEnv !== "production" && deployHost) {
    return `https://${deployHost}`;
  }

  throw new SiteUrlConfigError(
    configured
      ? `NEXT_PUBLIC_SITE_URL apunta a una máquina local (${configured.hostname}) en producción`
      : "NEXT_PUBLIC_SITE_URL falta o está mal formada en producción",
  );
}

let warned = false;

/** Para metadata y todo lo que se evalúa en el build. Nunca lanza. */
export function siteUrlForMetadata(): string {
  try {
    return requireSiteUrl();
  } catch (error) {
    if (!warned) {
      warned = true;
      console.error(error instanceof Error ? error.message : error);
    }
    return CANONICAL_SITE_URL;
  }
}

/** Sólo para tests: el aviso es una vez por proceso. */
export function __resetSiteUrlWarning(): void {
  warned = false;
}
