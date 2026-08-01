import { cache } from "react";
import { unstable_cache } from "next/cache";
import { headers } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/lib/types/database.types";

/** Forma canónica del tenant que consume toda la app. */
export type Tenant = {
  id: string;
  slug: string;
  name: string;
  brandHex: string;
  logoUrl: string | null;
  locale: string;
  currency: string;
  modules: Record<string, boolean>;
  /**
   * `tenants.modules_soon` (migración 0041): el TERCER estado de un módulo.
   * Misma forma que `modules` y hermana suya, nunca su reemplazo — el contrato
   * de los tres estados, y el default de la clave ausente, viven en
   * `@/components/shell/module-access` y en ningún otro lado.
   *
   * Vacío `{}` cuando la columna trae basura: sin `modules_soon` nadie queda en
   * "muy pronto", que es la degradación correcta (el on/off de `modules` sigue
   * mandando igual).
   */
  modulesSoon: Record<string, boolean>;
  theme: Record<string, unknown> | null;
  /**
   * `true` cuando la fila NO vino de la DB y `id` es un placeholder (DB caída,
   * seed pendiente, slug inexistente). Sirve para pintar branding igual —
   * degradación elegante §7 — pero JAMÁS para comparar contra el `tenant_id`
   * del JWT: ver `classifyTenantMatch` en `./match`.
   */
  isFallback: boolean;
};

export const TENANT_COOKIE = "cl-tenant";
export const TENANT_SLUG_HEADER = "x-tenant-slug";
export const TENANT_ID_HEADER = "x-tenant-id";
export const DEFAULT_TENANT_SLUG = "dominicanos";

/**
 * Módulos del tenant de fallback: NINGUNA clave, o sea TODO activo.
 *
 * No está vacío por pereza — vacío ES la forma de decir "todo prendido", porque
 * el default de una clave ausente es "activo" (`moduleAvailability` en
 * @/components/shell/module-access, que es donde vive esa decisión y la única
 * donde vive). Antes esto era una lista escrita a mano con las 9 claves de
 * entonces, y envejeció mal: cuando llegaron `empleos` y `videos` nadie la
 * actualizó, así que un tenant en fallback mostraba la app CON DOS SECCIONES
 * MENOS. Una lista que hay que mantener sincronizada con MODULE_KEYS es una
 * lista que se va a desincronizar; no tenerla es la única forma de que no pase.
 *
 * Y es lo que corresponde: el fallback se usa cuando la DB no contesta o el seed
 * no corrió. Un tenant en fallback muestra la plataforma COMPLETA —degradación
 * elegante §7— porque una DB caída no puede parecerse a un lanzamiento por
 * etapas.
 */
const DEFAULT_MODULES: Record<string, boolean> = {};

/**
 * Fallback de `modules_soon`: NADIE en "muy pronto".
 *
 * Es lo correcto justamente porque el fallback se usa cuando la DB no contesta:
 * en ese escenario todo está activo, así que un módulo marcado "muy pronto" acá
 * jamás se leería (el estado "muy pronto" solo existe sobre lo apagado).
 */
const DEFAULT_MODULES_SOON: Record<string, boolean> = {};

/**
 * Fallback hardcodeado para dev / degradación elegante: si la DB no responde
 * o aún no está sembrada, la app igual renderiza con estos tenants.
 * Los `id` son placeholders — cuando la DB responde, SIEMPRE gana su id real.
 */
export const DEFAULT_TENANTS: Record<string, Tenant> = {
  dominicanos: {
    id: "00000000-0000-4000-8000-000000000001", // placeholder — el id real lo da la DB
    slug: "dominicanos",
    name: "Dominicanos",
    brandHex: "#1A5EDB",
    logoUrl: null,
    locale: "es-US",
    currency: "USD",
    modules: DEFAULT_MODULES,
    modulesSoon: DEFAULT_MODULES_SOON,
    theme: null,
    isFallback: true,
  },
  comunidadlatina: {
    id: "00000000-0000-4000-8000-000000000002", // placeholder — el id real lo da la DB
    slug: "comunidadlatina",
    name: "Comunidad Latina",
    brandHex: "#C2410C",
    logoUrl: null,
    locale: "es-US",
    currency: "USD",
    modules: DEFAULT_MODULES,
    modulesSoon: DEFAULT_MODULES_SOON,
    theme: null,
    isFallback: true,
  },
};

/** Dominios de producción → slug. El middleware matchea contra esto sin tocar la DB. */
const DOMAIN_TENANTS: Record<string, string> = {
  "dominicanos.com": "dominicanos",
  "www.dominicanos.com": "dominicanos",
  "comunidadlatina.com": "comunidadlatina",
  "www.comunidadlatina.com": "comunidadlatina",
};

/**
 * Slugs reservados de MARCA/legal — NUNCA se resuelven como comunidad pública,
 * aunque tengan su propia fila en `tenants` y su propio dominio en
 * `DOMAIN_TENANTS`.
 *
 * Hoy es solo `comunidadlatina`: es la MARCA y el panel de administración, con
 * una razón puntual de negocio detrás (specimen de marca registrada en curso,
 * PLAN_MAESTRO §11.1 — "uso GENUINO, no una transacción manufacturada") — el
 * cliente jamás debe verla como si fuera una comunidad más. Decisión original:
 * commit `d293119` (2026-07-09).
 *
 * Cualquier slug que NO esté en este set se resuelve DINÁMICAMENTE contra la
 * fila real de `tenants` (`getTenant()`, cacheada) apenas existe, sin tocar
 * este archivo — ese es el contrato que permite nacer una comunidad nueva
 * (`scripts/new-tenant.mjs`) sin reprogramar. Antes este set funcionaba al
 * revés (allowlist de UN solo slug activo): eso "resolvía" bien a
 * `comunidadlatina`, pero de yapa clampeaba a la comunidad por defecto a
 * CUALQUIER tenant nuevo — ninguna comunidad nacida después de `dominicanos`
 * iba a ser alcanzable ni siquiera con `?t=<slug>` sin editar este archivo y
 * redeployar, que es exactamente el "todavía hay que reprogramar" que el
 * playbook de nacimiento de tenant (`docs/PLAYBOOK-TENANT.md`) viene a cerrar.
 * Sumar un slug ACÁ sigue siendo una decisión de marca/legal explícita sobre
 * UN tenant puntual — no un paso rutinario del alta.
 *
 * NO afecta al panel de admin: /admin usa el `tenant_id` del JWT, no este
 * (src/app/admin/guard.ts) — un global_admin siempre pudo administrar
 * `comunidadlatina` aunque el público no la vea como comunidad.
 *
 * Dominio propio (`DOMAIN_TENANTS`) sigue siendo un paso aparte: ese mapa es
 * un atajo de performance para resolver Host→slug en el middleware SIN pegarle
 * a la DB (`resolveTenantSlug` es pura y sync — la llama `src/middleware.ts`
 * sin `await`). Una comunidad nueva sin dominio propio ya funciona hoy vía
 * `?t=<slug>` (dev/preview) o el dominio compartido de Vercel; sumar SU
 * dominio propio ahí es el único paso de código que le queda al alta cuando
 * además quiere un dominio custom — ver "lo que sigue obligando a tocar
 * código" en el playbook.
 */
export const RESERVED_BRAND_SLUGS = new Set<string>(["comunidadlatina"]);

/**
 * ¿Este slug puede resolver como comunidad pública (no está reservado de
 * marca/legal)? El nombre es historia (era "¿está en el allowlist de
 * activas?"); el contrato hoy es el inverso: todo pasa salvo lo reservado.
 */
export function isActiveCommunitySlug(slug: string | null | undefined): boolean {
  return typeof slug === "string" && slug.length > 0 && !RESERVED_BRAND_SLUGS.has(slug);
}

function sanitizeSlug(value: string | null | undefined): string | null {
  if (!value) return null;
  const candidate = value.trim().toLowerCase();
  return /^[a-z0-9-]{1,40}$/.test(candidate) ? candidate : null;
}

/**
 * Resuelve el slug del tenant a partir del request. Función PURA (la usa el
 * middleware sin tocar la DB) — por eso NO puede consultar `tenants` para
 * decidir si un slug "existe de verdad"; esa parte la resuelve `getTenant()`
 * más abajo (cacheada), con degradación elegante si no hay fila.
 *
 * - Producción: el dominio manda (dominicanos.com → 'dominicanos'). Dominios
 *   fuera de `DOMAIN_TENANTS` (comunidad nueva sin dominio propio todavía) no
 *   entran acá — siguen resolviendo por `?t=`/cookie más abajo.
 * - Dev / previews / dominio sin mapear: `?t=<slug>` > cookie `cl-tenant` >
 *   'dominicanos'.
 */
export function resolveTenantSlug(
  host: string | null,
  searchParamT?: string | null,
  cookieT?: string | null,
): string {
  const hostname = (host ?? "").split(":")[0].toLowerCase();
  const fromDomain = DOMAIN_TENANTS[hostname];
  const candidate =
    fromDomain ?? sanitizeSlug(searchParamT) ?? sanitizeSlug(cookieT) ?? DEFAULT_TENANT_SLUG;

  // Solo un slug reservado de marca/legal (RESERVED_BRAND_SLUGS) fuerza la
  // comunidad por defecto. Cualquier otro candidato —incluida una comunidad
  // recién nacida que todavía no tiene fila, o un slug con errores de
  // tipeo— pasa tal cual: getTenant() lo resuelve contra la DB o degrada con
  // elegancia (§7) si no existe. Así una comunidad nacida por
  // scripts/new-tenant.mjs resuelve al toque, sin deploy.
  return isActiveCommunitySlug(candidate) ? candidate : DEFAULT_TENANT_SLUG;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Mapea la fila de `tenants` a la forma canónica, con el fallback tapando huecos. */
function mapTenantRow(row: Record<string, unknown>, fallback: Tenant): Tenant {
  return {
    id: asString(row.id) ?? fallback.id,
    slug: asString(row.slug) ?? fallback.slug,
    name: asString(row.name) ?? fallback.name,
    brandHex: asString(row.brand_hex) ?? asString(row.brand_color) ?? fallback.brandHex,
    logoUrl: asString(row.logo_url) ?? fallback.logoUrl,
    locale: asString(row.locale) ?? fallback.locale,
    currency: asString(row.currency) ?? fallback.currency,
    modules: (asRecord(row.modules) as Record<string, boolean> | null) ?? fallback.modules,
    /**
     * Misma tolerancia que `modules`: si la columna trae basura (un array, un
     * string, un null) `asRecord` devuelve null y cae al `{}` del fallback —
     * sin "muy pronto", nunca a un estado inventado.
     */
    modulesSoon:
      (asRecord(row.modules_soon) as Record<string, boolean> | null) ?? fallback.modulesSoon,
    theme: asRecord(row.theme) ?? fallback.theme,
    // La fila vino de la DB: `id` es real, así que se puede comparar con el JWT.
    isFallback: false,
  };
}

/** Fallback derivado del slug (dev / degradación elegante), extraído para reusar. */
function fallbackForSlug(slug: string): Tenant {
  return (
    DEFAULT_TENANTS[slug] ?? {
      ...DEFAULT_TENANTS[DEFAULT_TENANT_SLUG],
      slug,
      name: slug,
    }
  );
}

/**
 * Fila del tenant CACHEADA entre requests por slug (unstable_cache).
 *
 * getTenant() se llama en el root layout + generateViewport de CADA request →
 * antes esto era un SELECT a `tenants` por request en el camino crítico del
 * shell. La fila (nombre, brandHex, módulos, locale) cambia rarísimo, así que se
 * cachea 300s con tag "tenants".
 *
 * Cliente anon SIN cookies: headers()/cookies() NO se permiten dentro de una
 * cache scope (unstable_cache.md), y la fila del tenant es pública (no
 * user-bound). La cache key incluye el slug → JAMÁS se sirve la marca de un
 * tenant a otro (multi-tenant-safe). THROW en miss/error ⇒ el fallback NO se
 * cachea: si la DB se cae un instante, el próximo request reintenta y cachea la
 * fila real. Invalidación on-demand: revalidateTag("tenants") en el admin al
 * editar marca/dominio/módulos.
 */
const fetchTenantRow = unstable_cache(
  async (slug: string): Promise<Tenant> => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) throw new Error("supabase-not-configured");
    const supabase = createServerClient<Database>(url, anonKey, {
      cookies: { getAll: () => [], setAll: () => {} },
    });
    const { data, error } = await supabase
      .from("tenants")
      .select("*")
      .eq("slug", slug)
      .maybeSingle();
    if (error || !data) throw error ?? new Error("tenant-not-found");
    return mapTenantRow(data as Record<string, unknown>, fallbackForSlug(slug));
  },
  ["tenant-by-slug"],
  { revalidate: 300, tags: ["tenants"] },
);

/**
 * Tenant del request actual, para Server Components / actions.
 *
 * Lee el header x-tenant-slug (inyectado por el middleware) y resuelve la fila
 * real vía fetchTenantRow (cacheada entre requests). React cache() dedupe dentro
 * del mismo request. NUNCA lanza al usuario: ante cualquier falla (DB caída,
 * seed pendiente, header ausente) devuelve el fallback de DEFAULT_TENANTS —
 * degradación elegante, siempre hay un tenant usable.
 */
export const getTenant = cache(async (): Promise<Tenant> => {
  let slug = DEFAULT_TENANT_SLUG;
  try {
    const headerStore = await headers();
    slug = sanitizeSlug(headerStore.get(TENANT_SLUG_HEADER)) ?? DEFAULT_TENANT_SLUG;
  } catch {
    // Fuera de un request (build estático, etc.) → default.
  }

  try {
    return await fetchTenantRow(slug);
  } catch {
    // DB no disponible / sin sembrar / slug inexistente → degradación elegante.
    // `isFallback === true`: branding sí, comparación contra el JWT no.
    return fallbackForSlug(slug);
  }
});
