/**
 * Resolución Host → tenant CONTRA LA BASE (migración 0060), con caché en memoria.
 *
 * POR QUÉ EXISTE ESTE ARCHIVO
 * ---------------------------
 * El contrato con el cliente exige "sumar otro dominio sin reconstruir el
 * código". Hasta 0060 el middleware resolvía el host contra `DOMAIN_TENANTS`,
 * un mapa hardcodeado en `./resolve` — o sea que un dominio nuevo eran un
 * commit, un review y un deploy. Desde acá la FUENTE DE VERDAD es
 * `public.tenant_domains`, vía el RPC `public.resolve_tenant_domain(host)`.
 * `DOMAIN_TENANTS` sigue vivo, pero degradado a RESPALDO: sólo se mira cuando
 * la base no contesta (ver `./domain-routing`).
 *
 * POR QUÉ NO SE USA `unstable_cache` (la caché que ya existe para `tenants`)
 * -------------------------------------------------------------------------
 * `fetchTenantRow` (en `./resolve`) sí usa `unstable_cache` con tag "tenants" y
 * 300s, y está bien ahí: corre dentro de un render de Server Component. Este
 * lookup corre en el PROXY (ex middleware), y ahí esa herramienta no existe:
 *   - Next 16 documenta explícitamente que `fetch` con `options.cache`,
 *     `next.revalidate` o `next.tags` NO TIENE EFECTO en Proxy
 *     (node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md).
 *   - `unstable_cache` necesita un scope de render/request para colgar la
 *     entrada y para que `revalidateTag` la alcance; el proxy corre antes de
 *     que ese scope exista.
 * Lo que SÍ tenemos desde Next 16: el proxy corre en el runtime de **Node.js**
 * por defecto (antes Edge), así que un `Map` a nivel de módulo sobrevive entre
 * requests dentro de la misma instancia caliente. Eso es exactamente lo que
 * hace falta acá: el mapa host→tenant cambia rarísimo, y una instancia caliente
 * amortiza el RPC entre miles de requests. Un cold start paga UN round-trip.
 *
 * Elecciones de la caché, y el porqué de cada una:
 *   - TTL positivo 300s: mismo número que la caché de `tenants` — la marca y el
 *     dominio de una comunidad cambian con la misma (baja) frecuencia.
 *   - TTL negativo 60s: más corto A PROPÓSITO. El caso que el contrato quiere
 *     que sea rápido es "acabo de dar de alta el dominio, ¿ya funciona?".
 *     Cachear un "no existe" cinco minutos convertiría el alta en una espera
 *     inexplicable.
 *   - Stale-on-error 24h: si la base se cae, el último match CONOCIDO se sigue
 *     sirviendo. Es mejor respaldo que `DOMAIN_TENANTS`, porque cubre también
 *     los dominios dados de alta DESPUÉS del último deploy — justo los que el
 *     mapa hardcodeado no puede conocer. Un "desconocido" viejo NO se sirve
 *     rancio: con la base caída no vamos a estrenar un 404.
 *   - Single-flight por host: una ráfaga de requests sobre un host frío dispara
 *     UN solo RPC, no N.
 *   - Tope de 500 entradas con desalojo FIFO: el `Host` lo elige el cliente. Sin
 *     tope, mandar hosts al azar hace crecer el Map sin límite. Además los hosts
 *     que no tienen forma de hostname, y los efímeros de Vercel, ni siquiera
 *     llegan a consultarse (`shouldSkipLookup`).
 *   - Timeout duro de 1.5s: el proxy está en el camino crítico de TODO request.
 *     Si la base tarda más que eso, se degrada (ver `./domain-routing`) en vez
 *     de colgar la página.
 */

/** Fila que devuelve `public.resolve_tenant_domain(text)` (migración 0060). */
export interface TenantDomainRow {
  tenant_id: string;
  tenant_slug: string;
  tenant_name: string;
  matched_domain: string;
  is_primary: boolean;
  primary_domain: string | null;
}

export type TenantDomainLookup =
  | {
      status: "match";
      tenantId: string;
      slug: string;
      name: string;
      matchedDomain: string;
      isPrimary: boolean;
      /** Canónico del tenant. `null` si el tenant no tiene primario activo. */
      primaryDomain: string | null;
      /** `true` cuando se sirvió del caché rancio porque la base no contestó. */
      stale: boolean;
    }
  /**
   * La base CONTESTÓ y no hay fila: dominio no registrado, `suspended`,
   * `archived`, o tenant pausado. Los cuatro son indistinguibles a propósito
   * (ver el comentario del RPC en 0060) — la app no aprende cuál fue, y un
   * tercero tampoco.
   */
  | { status: "unknown" }
  /** No se pudo consultar (env sin configurar, red, timeout, 5xx). */
  | { status: "unavailable" }
  /** Host sin forma de hostname o efímero de la plataforma: no se consulta. */
  | { status: "skipped" };

/* -------------------------------------------------------------------------- */
/* Normalización                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Normaliza el host EXACTAMENTE como lo hace la base.
 *
 * El orden importa y espeja `app.normalize_tenant_domain()` y el propio RPC
 * (0060): minúsculas → sin espacios → sin puerto → sin punto final. Si esta
 * función y el trigger divergen, `Host: DOMINICANOS.COM.` deja de resolver (o,
 * peor, resuelve distinto que la clave del caché).
 */
export function normalizeHost(host: string | null | undefined): string {
  return (host ?? "")
    .trim()
    .toLowerCase()
    .replace(/:[0-9]+$/, "")
    .replace(/\.$/, "");
}

/**
 * Misma forma que el CHECK `tenant_domains_domain_format` de 0060. Un host que
 * no pasa esto NO PUEDE existir en la tabla, así que consultarlo es un
 * round-trip garantizado a cero filas — y el `Host` lo elige el cliente.
 */
const HOSTNAME_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;

/**
 * Hosts efímeros de la plataforma: cada deploy de Vercel estrena hostname. Si
 * se consultaran, cada preview gastaría una entrada de caché y un RPC para
 * llegar siempre a "no existe" — y ninguno de esos hosts va a ser nunca el
 * dominio de un tenant.
 */
function isEphemeralPlatformHost(hostname: string): boolean {
  return hostname.endsWith(".vercel.app") || hostname.endsWith(".vercel.sh");
}

/** ¿Vale la pena preguntarle a la base por este host? */
export function shouldSkipLookup(hostname: string): boolean {
  return hostname === "" || !HOSTNAME_RE.test(hostname) || isEphemeralPlatformHost(hostname);
}

/**
 * Hosts de la PLATAFORMA: nunca sirven un 404 de "dominio desconocido" ni se
 * redirigen a un canónico.
 *
 * Es la red de contención más importante de este cambio. El host real de
 * producción hoy es `comunidad-latina-sigma.vercel.app` y NO está (ni tiene por
 * qué estar) en `tenant_domains`: si lo tratáramos como "dominio desconocido",
 * este cambio bajaría producción entera. Lo mismo con cada preview y con
 * localhost.
 *
 * `TENANT_PLATFORM_HOSTS` (lista separada por comas) es la válvula de escape
 * operativa: si mañana el deploy vive en un host que no matchea ninguna regla,
 * se agrega ahí desde el panel de Vercel — variable de entorno, no un commit.
 * Que sea env y no código es deliberado: el objetivo de todo este archivo es
 * que operar dominios no exija desplegar.
 */
export function isPlatformHost(hostname: string): boolean {
  if (hostname === "") return true;
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname === "::1" ||
    hostname.endsWith(".local")
  ) {
    return true;
  }
  if (isEphemeralPlatformHost(hostname)) return true;

  const extra = process.env.TENANT_PLATFORM_HOSTS;
  if (extra) {
    for (const raw of extra.split(",")) {
      if (normalizeHost(raw) === hostname) return true;
    }
  }
  return false;
}

/* -------------------------------------------------------------------------- */
/* Transporte                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Consulta el RPC. Lanza si no se pudo consultar; devuelve `[]` si la base
 * contestó "no hay fila" (que NO es un error, es una respuesta).
 */
export type TenantDomainFetcher = (hostname: string) => Promise<TenantDomainRow[]>;

const LOOKUP_TIMEOUT_MS = 1_500;

/**
 * `fetch` plano contra PostgREST en vez del cliente de Supabase, a propósito:
 *   - control explícito del timeout (`AbortSignal.timeout`), que es lo único
 *     que impide que una base lenta cuelgue TODOS los requests;
 *   - cero construcción de cliente por request en el camino caliente;
 *   - la respuesta se valida a mano más abajo, que es lo que corresponde con un
 *     payload de red en la pieza más sensible del repo.
 * El RPC es `security invoker` y anon tiene `execute` (0060), así que la clave
 * anónima alcanza — no hace falta `service_role` en el proxy.
 */
async function fetchViaRest(hostname: string): Promise<TenantDomainRow[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error("supabase-not-configured");

  const response = await fetch(`${url.replace(/\/$/, "")}/rest/v1/rpc/resolve_tenant_domain`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${anonKey}`,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({ p_host: hostname }),
    // Ver la nota de arriba: en Proxy las opciones de caché de `fetch` no
    // tienen efecto, la caché de verdad es el Map de este módulo.
    cache: "no-store",
    signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
  });

  if (!response.ok) throw new Error(`resolve_tenant_domain: HTTP ${response.status}`);

  const payload: unknown = await response.json();
  // El fetcher es SÓLO transporte; la validación del contenido vive en
  // `toMatch`, que corre para cualquier fetcher (incluidos los de los tests).
  return Array.isArray(payload) ? (payload as TenantDomainRow[]) : [];
}

/**
 * Validación defensiva de la fila: el payload viene de la red y gobierna qué
 * comunidad ve el visitante. Una fila sin slug o sin id no es un match a medias
 * — es "no hay match", y así se trata.
 */
function toMatch(value: unknown): Omit<CachedMatch, "stale"> | null {
  if (value === null || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const slug = typeof raw.tenant_slug === "string" ? raw.tenant_slug : "";
  const tenantId = typeof raw.tenant_id === "string" ? raw.tenant_id : "";
  if (!slug || !tenantId) return null;
  return {
    status: "match",
    tenantId,
    slug,
    name: typeof raw.tenant_name === "string" && raw.tenant_name ? raw.tenant_name : slug,
    matchedDomain: typeof raw.matched_domain === "string" ? raw.matched_domain : "",
    isPrimary: raw.is_primary === true,
    primaryDomain:
      typeof raw.primary_domain === "string" && raw.primary_domain.length > 0
        ? normalizeHost(raw.primary_domain)
        : null,
  };
}

/* -------------------------------------------------------------------------- */
/* Caché                                                                      */
/* -------------------------------------------------------------------------- */

const POSITIVE_TTL_MS = 5 * 60_000;
const NEGATIVE_TTL_MS = 60_000;
const STALE_GRACE_MS = 24 * 60 * 60_000;
const MAX_ENTRIES = 500;

type CachedMatch = Extract<TenantDomainLookup, { status: "match" }>;

interface CacheEntry {
  /** `null` = la base dijo "no hay fila" para este host. */
  match: Omit<CachedMatch, "stale"> | null;
  freshUntil: number;
  staleUntil: number;
}

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<TenantDomainLookup>>();

function remember(hostname: string, match: CacheEntry["match"]): void {
  const now = Date.now();
  if (!cache.has(hostname) && cache.size >= MAX_ENTRIES) {
    // FIFO: `Map` conserva el orden de inserción, así que la primera clave es
    // la más vieja. Suficiente para un mapa que en la práctica tiene decenas de
    // entradas y cuyo único riesgo es el spam de `Host`.
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(hostname, {
    match,
    freshUntil: now + (match ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS),
    staleUntil: now + STALE_GRACE_MS,
  });
}

function fromEntry(entry: CacheEntry, stale: boolean): TenantDomainLookup {
  return entry.match ? { ...entry.match, stale } : { status: "unknown" };
}

/**
 * Resuelve el host contra la base, con caché. NUNCA lanza: toda falla se
 * traduce a `unavailable` (o a un match rancio) para que la decisión de qué
 * hacer con eso viva en un solo lugar, `./domain-routing`.
 */
export async function lookupTenantDomain(
  host: string | null | undefined,
  fetcher: TenantDomainFetcher = fetchViaRest,
): Promise<TenantDomainLookup> {
  const hostname = normalizeHost(host);
  if (shouldSkipLookup(hostname)) return { status: "skipped" };

  const now = Date.now();
  const cached = cache.get(hostname);
  if (cached && now < cached.freshUntil) return fromEntry(cached, false);

  const pending = inFlight.get(hostname);
  if (pending) return pending;

  const task = (async (): Promise<TenantDomainLookup> => {
    try {
      const rows = await fetcher(hostname);
      const match = toMatch(rows[0]);
      remember(hostname, match);
      return match ? { ...match, stale: false } : { status: "unknown" };
    } catch {
      // La base no contestó. Si teníamos un MATCH conocido, se sigue sirviendo
      // rancio: un dominio que ayer resolvía no deja de existir porque la base
      // tosa. Un "desconocido" viejo, en cambio, NO se sirve — con la base
      // caída no estrenamos un 404 (§ degradación elegante: nunca convertir un
      // error de infra en "estás en la comunidad equivocada").
      const stale = cache.get(hostname);
      if (stale?.match && Date.now() < stale.staleUntil) return { ...stale.match, stale: true };
      return { status: "unavailable" };
    } finally {
      inFlight.delete(hostname);
    }
  })();

  inFlight.set(hostname, task);
  return task;
}

/** Sólo para tests: la caché es de módulo y sobrevive entre casos. */
export function __resetTenantDomainCache(): void {
  cache.clear();
  inFlight.clear();
}
