/**
 * ¿El slug de una PISTA DEL CLIENTE (`?t=`, cookie `cl-tenant`) es una comunidad
 * de verdad? Consulta a la base, con caché en memoria — hermano de
 * `./domain-lookup`, que hace lo mismo para el `Host`.
 *
 * POR QUÉ EXISTE ESTE ARCHIVO (bug reproducido en vivo, 2026-08-24)
 * -----------------------------------------------------------------
 * `?t=` tenía DOS significados que chocaban:
 *
 *   1. Para el proxy es la pista de comunidad de dev, y si coincidía con el slug
 *      servido se PERSISTÍA en la cookie `cl-tenant` por 30 días.
 *   2. Para el perfil es el parámetro de PESTAÑA: `profileTabHref()` genera
 *      `/perfil?t=fotos`, `?t=seguidores`, `?t=resenas`…
 *
 * Y `resolveTenantSlug` acepta cualquier slug que no esté en
 * `RESERVED_BRAND_SLUGS` — a propósito, para que una comunidad recién creada
 * resuelva sin deploy. O sea que "fotos" pasaba el filtro tal cual. Resultado:
 * un click en la pestaña Fotos del perfil (o una URL suelta tipo
 * `/negocios?t=ofertas`) dejaba `cl-tenant=fotos`, y a partir de ahí TODA la app
 * resolvía a una comunidad inexistente. Las secciones se veían VACÍAS **sin un
 * solo error a la vista**, y la única salida era borrar la cookie a mano.
 *
 * LA REGLA QUE LO CIERRA
 * ----------------------
 * Una pista del cliente se honra **sólo si la base confirma que ese slug es una
 * comunidad**. Nada más cambia: el parámetro se sigue llamando `?t=` (renombrarlo
 * habría tocado el playbook de tenants, la guía de dominios y el manual de súper
 * admin sin arreglar nada que esto no arregle) y una comunidad nacida por
 * `scripts/new-tenant.mjs` sigue resolviendo sin tocar código, porque la fuente
 * de verdad es la FILA, no un mapa hardcodeado. Chequear contra `DOMAIN_TENANTS`
 * o contra `DEFAULT_TENANTS` habría sido más barato y habría reabierto
 * exactamente el problema que documenta `RESERVED_BRAND_SLUGS` en `./resolve`.
 *
 * De yapa cierra el segundo síntoma: como la pista sin confirmar ya no llega a
 * `routing.slug`, el proxy nunca vuelve a escribir una cookie basura. Y las que
 * ya están escritas se descartan solas (`discardCookie`).
 *
 * COSTO EN PRODUCCIÓN: CERO. `clientTenantHintsAllowed()` es false en prod y en
 * previews, así que `confirmClientTenantHints()` corta antes de consultar. Esto
 * vive y respira sólo en local y en los tests, que es donde `?t=` existe.
 *
 * Sobre la caché: mismas decisiones que `./domain-lookup` y por las mismas
 * razones (el proxy corre en runtime Node desde Next 16, así que un `Map` de
 * módulo sobrevive entre requests; `unstable_cache` no aplica ahí). La única
 * diferencia deliberada es que acá NO hay stale-on-error: con la base caída no
 * se honra la pista, pero tampoco se borra la cookie — ver `decideClientHints`.
 */

import { clientTenantHintsAllowed, RESERVED_BRAND_SLUGS } from "./resolve";

/**
 * - `exists`  → la base confirmó que hay una comunidad con ese slug.
 * - `missing` → la base CONTESTÓ y no hay ninguna. Es un veredicto.
 * - `invalid` → no puede ser una comunidad (mal formado, vacío, reservado de
 *               marca). Se sabe sin preguntar, así que no se pregunta.
 * - `unknown` → no se pudo consultar (env sin configurar, red, timeout, 5xx).
 *               NO es un veredicto y nunca se trata como tal.
 */
export type TenantSlugStatus = "exists" | "missing" | "invalid" | "unknown";

/** Transporte: devuelve los slugs que la base conoce para la consulta. */
export type TenantSlugFetcher = (slug: string) => Promise<string[]>;

/**
 * Mismo alfabeto que el CHECK de `tenants.slug` y que `sanitizeSlug` en
 * `./resolve`: un slug que no pasa esto no puede existir en la tabla, así que
 * consultarlo sería un round-trip garantizado a cero filas.
 */
const SLUG_RE = /^[a-z0-9-]{1,40}$/;

function normalizeSlug(value: string | null | undefined): string | null {
  if (!value) return null;
  const candidate = value.trim().toLowerCase();
  if (!SLUG_RE.test(candidate)) return null;
  // Un slug reservado de marca nunca se sirve como comunidad pública
  // (`isActiveCommunitySlug`), así que confirmarlo contra la base sería gastar
  // una consulta para llegar igual a "no".
  return RESERVED_BRAND_SLUGS.has(candidate) ? null : candidate;
}

/* -------------------------------------------------------------------------- */
/* Transporte                                                                 */
/* -------------------------------------------------------------------------- */

const LOOKUP_TIMEOUT_MS = 1_500;

/**
 * `fetch` plano contra PostgREST, por las mismas tres razones que
 * `fetchViaRest` en `./domain-lookup`: timeout explícito, cero construcción de
 * cliente en el camino caliente, y validación a mano de un payload de red.
 *
 * La clave anónima alcanza: `fetchTenantRow` (en `./resolve`) ya lee `tenants`
 * con anon y sin cookies para CUALQUIER visitante — la fila del tenant es
 * pública. Acá se pide una sola columna, la que se va a comparar.
 */
async function fetchViaRest(slug: string): Promise<string[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error("supabase-not-configured");

  const endpoint = `${url.replace(/\/$/, "")}/rest/v1/tenants?select=slug&limit=1&slug=eq.${encodeURIComponent(slug)}`;
  const response = await fetch(endpoint, {
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${anonKey}`,
      accept: "application/json",
    },
    // En Proxy las opciones de caché de `fetch` no tienen efecto: la caché de
    // verdad es el Map de este módulo (ver el encabezado de `./domain-lookup`).
    cache: "no-store",
    signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
  });

  if (!response.ok) throw new Error(`tenants?slug: HTTP ${response.status}`);

  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) return [];
  return payload
    .map((row) =>
      row !== null && typeof row === "object" && typeof (row as { slug?: unknown }).slug === "string"
        ? (row as { slug: string }).slug
        : "",
    )
    .filter(Boolean);
}

/* -------------------------------------------------------------------------- */
/* Caché                                                                      */
/* -------------------------------------------------------------------------- */

const POSITIVE_TTL_MS = 5 * 60_000;
/**
 * El "no existe" se cachea más corto A PROPÓSITO, igual que en
 * `./domain-lookup`: el caso que tiene que ser rápido es "acabo de crear la
 * comunidad, ¿ya la puedo ver con `?t=`?".
 */
const NEGATIVE_TTL_MS = 60_000;
/**
 * El slug lo elige quien visita (`?t=` es un parámetro de URL). Sin tope, una
 * ráfaga de slugs al azar hace crecer el Map sin límite. Desalojo FIFO: `Map`
 * conserva el orden de inserción.
 */
const MAX_ENTRIES = 200;

interface CacheEntry {
  exists: boolean;
  freshUntil: number;
}

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<TenantSlugStatus>>();

function remember(slug: string, exists: boolean): void {
  if (!cache.has(slug) && cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(slug, {
    exists,
    freshUntil: Date.now() + (exists ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS),
  });
}

/**
 * ¿Hay una comunidad con este slug? NUNCA lanza: toda falla se traduce a
 * `unknown`, para que la decisión de qué hacer con eso viva en un solo lugar
 * (`decideClientHints`).
 *
 * `unknown` NO se cachea: una base que tosió un segundo no puede dejar pegado
 * un "no sé" durante minutos.
 */
export async function lookupTenantSlug(
  slug: string | null | undefined,
  fetcher: TenantSlugFetcher = fetchViaRest,
): Promise<TenantSlugStatus> {
  const candidate = normalizeSlug(slug);
  if (candidate === null) return "invalid";

  const cached = cache.get(candidate);
  if (cached && Date.now() < cached.freshUntil) return cached.exists ? "exists" : "missing";

  const pending = inFlight.get(candidate);
  if (pending) return pending;

  const task = (async (): Promise<TenantSlugStatus> => {
    try {
      const rows = await fetcher(candidate);
      // Validación defensiva: el payload viene de la red y decide qué comunidad
      // ve quien mira. Sólo cuenta una fila cuyo slug sea EXACTAMENTE el pedido.
      const exists = rows.includes(candidate);
      remember(candidate, exists);
      return exists ? "exists" : "missing";
    } catch {
      return "unknown";
    } finally {
      inFlight.delete(candidate);
    }
  })();

  inFlight.set(candidate, task);
  return task;
}

/** Sólo para tests: la caché es de módulo y sobrevive entre casos. */
export function __resetTenantSlugCache(): void {
  cache.clear();
  inFlight.clear();
}

/* -------------------------------------------------------------------------- */
/* La regla                                                                   */
/* -------------------------------------------------------------------------- */

export interface ClientTenantHints {
  /** `?t=` CONFIRMADO como comunidad, o `null`. */
  tParam: string | null;
  /** Cookie `cl-tenant` CONFIRMADA como comunidad, o `null`. */
  cookie: string | null;
  /**
   * La cookie hay que BORRARLA: la base contestó que ese slug no es una
   * comunidad, o el valor ni siquiera puede serlo.
   */
  discardCookie: boolean;
}

export interface ClientHintsInput {
  tParam: string | null;
  tStatus: TenantSlugStatus;
  cookie: string | null;
  cookieStatus: TenantSlugStatus;
}

/**
 * La regla, en una función pura — para poder testearla sin un solo mock, igual
 * que `decideTenantRouting` hace con la decisión del proxy.
 *
 * Dos asimetrías que parecen detalles y no lo son:
 *
 *  - Una pista se honra SÓLO con `exists`. `unknown` (base caída) no alcanza:
 *    honrar un slug sin confirmar es justamente lo que rompía.
 *  - Pero la cookie se borra SÓLO con un veredicto (`missing` / `invalid`),
 *    NUNCA con `unknown`. Con la base caída no se puede condenar una cookie
 *    legítima: es el mismo criterio que el 503 de `./domain-routing` y que
 *    `classifyTenantMatch` — ante una caída de infra nunca afirmamos de más.
 *    Quien está laburando en local con la base tosiendo pierde el `?t=` por un
 *    rato; no pierde su comunidad para siempre.
 */
export function decideClientHints(input: ClientHintsInput): ClientTenantHints {
  const cookieCondenada =
    input.cookie !== null &&
    input.cookie !== "" &&
    (input.cookieStatus === "missing" || input.cookieStatus === "invalid");

  return {
    tParam: input.tStatus === "exists" ? input.tParam : null,
    cookie: input.cookieStatus === "exists" ? input.cookie : null,
    discardCookie: cookieCondenada,
  };
}

/**
 * El pegamento que usa el proxy: confirma las dos pistas contra la base y
 * aplica la regla.
 *
 * En producción (y en previews) corta ANTES de consultar: ahí
 * `clientTenantHintsAllowed()` ya ignora las pistas, así que preguntarle a la
 * base sería gastar un round-trip en el camino crítico de cada request para
 * llegar a un resultado que igual se descarta.
 */
export async function confirmClientTenantHints(
  tParam: string | null,
  cookie: string | null,
  fetcher?: TenantSlugFetcher,
): Promise<ClientTenantHints> {
  if (!clientTenantHintsAllowed()) {
    return { tParam: null, cookie: null, discardCookie: false };
  }

  const [tStatus, cookieStatus] = await Promise.all([
    lookupTenantSlug(tParam, fetcher),
    lookupTenantSlug(cookie, fetcher),
  ]);

  return decideClientHints({ tParam, tStatus, cookie, cookieStatus });
}
