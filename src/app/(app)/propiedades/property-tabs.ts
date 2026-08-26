/**
 * LAS DOS PESTAÑAS DE PROPIEDADES (spec cliente: «Propiedades | Agentes y
 * propietarios») — parte PURA, mismo patrón que `negocios/business-tabs.ts`,
 * `profesionales/professional-tabs.ts` y `marketplace/marketplace-tabs.ts`.
 *
 * Sin `server-only` y sin imports de Supabase a propósito: acá viven el orden,
 * los ids, el copy y el parseo del `?t=`, que es lo que se testea en node sin
 * jsdom ni base. La consulta del directorio de anunciantes vive en
 * `lib/propiedades/anunciantes.ts`.
 *
 * ── POR QUÉ `?t=agentes` Y NO UNA RUTA `/propiedades/agentes` ───────────────
 * Mismo motivo que en Negocios, y acá pesa más: `/propiedades/[id]` llama
 * `notFound()` para cualquier id que no sea una propiedad, así que una carpeta
 * hermana sería una excepción más que mantener en ese mapa. Y las dos pestañas
 * son la MISMA vidriera mirada por otro corte —los avisos, o quién los
 * publica—, no un panel de dueño: comparten ruta, esqueleto y grupo.
 *
 * ── LOS FILTROS NO SE ARRASTRAN ENTRE PESTAÑAS ──────────────────────────────
 * Un filtro de "2 habitaciones" no significa nada en un directorio de personas,
 * y un cursor de avisos abriría la pestaña nueva a mitad de una página que
 * nadie pidió. Mismo criterio que `businessTabHref`.
 */

export const PROPERTY_TAB_IDS = ["propiedades", "agentes"] as const;

export type PropertyTabId = (typeof PROPERTY_TAB_IDS)[number];

export const PROPERTY_TAB_LABELS: Record<PropertyTabId, string> = {
  propiedades: "Propiedades",
  agentes: "Agentes y propietarios",
};

/**
 * La pestaña que abre `/propiedades` a secas. Es el listado y no se mueve: esa
 * URL ya está linkeada desde el menú principal, desde `/buscar`, desde el
 * círculo del módulo en el feed y desde varios CTAs internos.
 */
const DEFAULT_TAB: PropertyTabId = "propiedades";

/**
 * `?t=` → pestaña. Cualquier valor que no matchea (vacío, viejo, inventado, con
 * mayúsculas) cae en el listado en vez de 404: una URL mal copiada tiene que
 * abrir Propiedades igual.
 */
export function parsePropertyTab(raw: string | undefined): PropertyTabId {
  const value = (raw ?? "").trim().toLowerCase();
  return (PROPERTY_TAB_IDS as readonly string[]).includes(value)
    ? (value as PropertyTabId)
    : DEFAULT_TAB;
}

/** Href de una pestaña. El listado va SIN `?t=` (URL canónica del módulo). */
export function propertyTabHref(tab: PropertyTabId): string {
  return tab === DEFAULT_TAB ? "/propiedades" : `/propiedades?t=${tab}`;
}
