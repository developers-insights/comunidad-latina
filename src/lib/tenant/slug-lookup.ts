/**
 * ¿EXISTE esta comunidad? — verificación de la PISTA DE DESARROLLO, y de nada más.
 *
 * ── EL BUG QUE ESTE ARCHIVO EXISTE PARA MATAR ────────────────────────────────
 * `resolveTenantSlug` acepta a propósito CUALQUIER slug que no esté reservado
 * de marca: ese es el contrato que permite que una comunidad recién creada por
 * `scripts/new-tenant.mjs` resuelva sin tocar código ni desplegar. El precio de
 * ese contrato es que un slug con un error de tipeo —o uno que nunca fue un
 * slug, como la pestaña `ofertas` que hasta el 2026-08-24 se colaba por `?t=`—
 * también pasa. Y cuando pasa, `getTenant()` no encuentra la fila, degrada al
 * fallback (§7) y la app entera se ve VACÍA: sin filas, sin error, sin pista.
 * El repo ya tenía la degradación elegante; lo que le faltaba era la parte de
 * DECIRLO.
 *
 * Este módulo no cambia el contrato: sigue pasando cualquier slug. Lo que hace
 * es preguntarle a la base, UNA vez y sólo en desarrollo, si ese slug es una
 * comunidad de verdad, para que el proxy pueda contestar una página que
 * explique qué pasó en vez de un feed en blanco.
 *
 * ── POR QUÉ SÓLO EN DESARROLLO ───────────────────────────────────────────────
 * Porque las pistas del cliente sólo viven ahí (`clientTenantHintsAllowed()`).
 * En producción y en previews el tenant sale del Host, y ese camino ya tiene su
 * propia respuesta honesta para un dominio que no conoce: el 404 de
 * `UNKNOWN_DOMAIN_PAGE`. Meter esta consulta en el camino caliente de
 * producción sería pagar un round-trip por request para cubrir un caso que ahí
 * no puede ocurrir.
 *
 * ── DECISIONES DE LA CONSULTA ────────────────────────────────────────────────
 *  · `fetch` plano contra PostgREST, con la clave ANÓNIMA: `tenants` tiene
 *    SELECT para `anon` y su policy de lectura es pública (es la misma puerta
 *    que ya usa `fetchTenantRow` en `./resolve`). No hace falta `service_role`
 *    en el proxy, y no se le va a dar.
 *  · `select=slug` y nada más: sólo interesa si la fila existe.
 *  · Timeout duro, igual que `./domain-lookup`. Una base lenta no puede colgar
 *    el dev server.
 *  · Ante CUALQUIER falla devuelve `unavailable`, nunca `unknown`. La diferencia
 *    importa: `unknown` corta la navegación con una página de error, así que
 *    sólo se afirma cuando la base CONTESTÓ que no hay fila. Con la base caída
 *    se sigue de largo y manda la degradación de siempre.
 */

export type TenantSlugLookup =
  /** La base contestó y la comunidad existe. */
  | "known"
  /** La base contestó y NO hay fila con ese slug. */
  | "unknown"
  /** No se pudo preguntar (env sin configurar, red, timeout, 5xx). */
  | "unavailable";

export type TenantSlugFetcher = (slug: string) => Promise<boolean>;

const LOOKUP_TIMEOUT_MS = 1_500;
/** Corto a propósito: en dev se crean comunidades y se quiere verlas al toque. */
const TTL_MS = 30_000;
const MAX_ENTRIES = 100;

async function fetchViaRest(slug: string): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error("supabase-not-configured");

  const endpoint =
    `${url.replace(/\/$/, "")}/rest/v1/tenants` +
    `?select=slug&slug=eq.${encodeURIComponent(slug)}&limit=1`;

  const response = await fetch(endpoint, {
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${anonKey}`,
      accept: "application/json",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`tenants: HTTP ${response.status}`);

  const payload: unknown = await response.json();
  return Array.isArray(payload) && payload.length > 0;
}

const cache = new Map<string, { known: boolean; freshUntil: number }>();
const inFlight = new Map<string, Promise<TenantSlugLookup>>();

/**
 * ¿La comunidad `slug` existe? NUNCA lanza.
 *
 * `fetcher` se inyecta en los tests; en runtime va contra PostgREST.
 */
export async function lookupTenantSlug(
  slug: string,
  fetcher: TenantSlugFetcher = fetchViaRest,
): Promise<TenantSlugLookup> {
  if (!slug) return "unavailable";

  const now = Date.now();
  const cached = cache.get(slug);
  if (cached && now < cached.freshUntil) return cached.known ? "known" : "unknown";

  const pending = inFlight.get(slug);
  if (pending) return pending;

  const task = (async (): Promise<TenantSlugLookup> => {
    try {
      const known = await fetcher(slug);
      if (!cache.has(slug) && cache.size >= MAX_ENTRIES) {
        // FIFO: `Map` conserva el orden de inserción.
        const oldest = cache.keys().next();
        if (!oldest.done) cache.delete(oldest.value);
      }
      cache.set(slug, { known, freshUntil: Date.now() + TTL_MS });
      return known ? "known" : "unknown";
    } catch {
      return "unavailable";
    } finally {
      inFlight.delete(slug);
    }
  })();

  inFlight.set(slug, task);
  return task;
}

/** Sólo para tests: la caché es de módulo y sobrevive entre casos. */
export function __resetTenantSlugCache(): void {
  cache.clear();
  inFlight.clear();
}
