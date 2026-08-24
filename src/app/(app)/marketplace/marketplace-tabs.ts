/**
 * LAS DOS PESTAÑAS DEL MARKETPLACE (spec cliente: "Tiendas | Artículos") —
 * mismo patrón que `/perfil` (`profile-tabs.ts`): estado canónico en la URL
 * (`?t=`), Server Components por pestaña, sin `ui/tabs.tsx` (ver el porqué en
 * `src/components/ui/nav-tabs.tsx`).
 *
 * ORDEN VISUAL vs. PESTAÑA POR DEFECTO — a propósito NO son lo mismo acá. El
 * cliente escribió "Tiendas | Artículos" (Tiendas primero) y el array respeta
 * ese orden en la barra. Pero `/marketplace` SIN query sigue siendo el listado
 * de Artículos: es la URL que ya está linkeada desde el menú principal, desde
 * `/buscar` y desde la propia sección ("Publicar producto" → vuelve acá) —
 * cambiar qué carga por default habría sido una regresión silenciosa para
 * quien ya tenía esa dirección guardada o compartida. `parseMarketplaceTab`
 * hace ese fallback explícito, no el orden del array.
 */

export const MARKETPLACE_TAB_IDS = ["tiendas", "articulos"] as const;

export type MarketplaceTabId = (typeof MARKETPLACE_TAB_IDS)[number];

export const MARKETPLACE_TAB_LABELS: Record<MarketplaceTabId, string> = {
  tiendas: "Tiendas",
  articulos: "Artículos",
};

const DEFAULT_TAB: MarketplaceTabId = "articulos";

/**
 * `?t=` → pestaña. Cualquier valor que no matchea (vacío, viejo, inventado)
 * cae en "articulos" — la pestaña canónica — en vez de 404: una URL vieja o
 * mal copiada tiene que abrir el Marketplace igual.
 */
export function parseMarketplaceTab(raw: string | undefined): MarketplaceTabId {
  const value = (raw ?? "").trim().toLowerCase();
  return (MARKETPLACE_TAB_IDS as readonly string[]).includes(value)
    ? (value as MarketplaceTabId)
    : DEFAULT_TAB;
}

/**
 * Construye el href de una pestaña. "articulos" va SIN query: es la URL
 * canónica de la sección y no queremos dos direcciones para la misma
 * pantalla (mismo criterio que `profileTabHref`).
 */
export function marketplaceTabHref(tab: MarketplaceTabId): string {
  return tab === DEFAULT_TAB ? "/marketplace" : `/marketplace?t=${tab}`;
}
