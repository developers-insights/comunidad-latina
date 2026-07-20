import { cache } from "react";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";

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

const DEFAULT_MODULES: Record<string, boolean> = {
  feed: true,
  propiedades: true,
  negocios: true,
  profesionales: true,
  eventos: true,
  mensajes: true,
  escudo: true,
  marketplace: true,
  creadores: true,
};

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
 * Comunidades ACTIVAS para el usuario final (2026-07-09).
 *
 * Por ahora hay UNA sola comunidad pública/navegable: `dominicanos`
 * ("Dominicanos en USA"). `comunidadlatina` es la MARCA y el panel de
 * administración — NO es una comunidad, y el cliente jamás debe verla como si
 * lo fuera. Este set "clampea" la resolución del tenant del request: cualquier
 * candidato que no esté acá cae a la comunidad por defecto. Así ni un
 * `?t=comunidadlatina`, ni una cookie `cl-tenant` vieja, ni el dominio de la
 * marca meten al usuario en una comunidad que no debe ver.
 *
 * NO afecta al panel de admin: /admin usa el `tenant_id` del JWT, no este
 * (src/app/admin/guard.ts). Para reactivar multi-comunidad, sumá el slug acá
 * (y su dominio en DOMAIN_TENANTS + INDEXABLE_HOSTS de robots.ts).
 */
export const ACTIVE_COMMUNITY_SLUGS = new Set<string>([DEFAULT_TENANT_SLUG]);

/** ¿Es un slug de comunidad pública/activa hoy? (single-community por ahora). */
export function isActiveCommunitySlug(slug: string | null | undefined): boolean {
  return typeof slug === "string" && ACTIVE_COMMUNITY_SLUGS.has(slug);
}

function sanitizeSlug(value: string | null | undefined): string | null {
  if (!value) return null;
  const candidate = value.trim().toLowerCase();
  return /^[a-z0-9-]{1,40}$/.test(candidate) ? candidate : null;
}

/**
 * Resuelve el slug del tenant a partir del request. Función PURA (la usa el
 * middleware sin tocar la DB).
 *
 * - Producción: el dominio manda (dominicanos.com → 'dominicanos').
 * - Dev / previews: `?t=<slug>` > cookie `cl-tenant` > 'dominicanos'.
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

  // Single-community por ahora: cualquier comunidad que no esté activa (p. ej.
  // `comunidadlatina`, la marca) cae a la comunidad por defecto. El usuario
  // final nunca aterriza en una comunidad que no debe ver (ver ACTIVE_COMMUNITY_SLUGS).
  return ACTIVE_COMMUNITY_SLUGS.has(candidate) ? candidate : DEFAULT_TENANT_SLUG;
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
    theme: asRecord(row.theme) ?? fallback.theme,
    // La fila vino de la DB: `id` es real, así que se puede comparar con el JWT.
    isFallback: false,
  };
}

/**
 * Tenant del request actual, para Server Components / actions.
 *
 * Lee el header x-tenant-slug (inyectado por el middleware), busca la fila real
 * en la DB y cachea por request con React cache(). NUNCA lanza al usuario:
 * ante cualquier falla (DB caída, seed pendiente, header ausente) devuelve el
 * fallback de DEFAULT_TENANTS — degradación elegante, siempre hay un tenant usable.
 */
export const getTenant = cache(async (): Promise<Tenant> => {
  let slug = DEFAULT_TENANT_SLUG;
  try {
    const headerStore = await headers();
    slug = sanitizeSlug(headerStore.get(TENANT_SLUG_HEADER)) ?? DEFAULT_TENANT_SLUG;
  } catch {
    // Fuera de un request (build estático, etc.) → default.
  }

  const fallback = DEFAULT_TENANTS[slug] ?? {
    ...DEFAULT_TENANTS[DEFAULT_TENANT_SLUG],
    slug,
    name: slug,
  };

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("tenants")
      .select("*")
      .eq("slug", slug)
      .maybeSingle();

    if (!error && data) {
      return mapTenantRow(data as Record<string, unknown>, fallback);
    }
  } catch {
    // DB no disponible o aún sin sembrar — seguimos con el fallback.
  }

  // `fallback.isFallback === true`: branding sí, comparación contra el JWT no.
  return fallback;
});
