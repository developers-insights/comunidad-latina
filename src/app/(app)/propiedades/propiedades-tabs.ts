/**
 * LAS DOS PESTAÑAS DE PROPIEDADES (requisito del cliente: "Propiedades |
 * Agentes y propietarios") — mismo patrón que `marketplace/marketplace-tabs.ts`
 * y `profesionales/professional-tabs.ts`: estado canónico en la URL (`?t=`),
 * Server Components por pestaña, sin `ui/tabs.tsx` (ver el porqué en
 * `src/components/ui/nav-tabs.tsx`).
 *
 * "Agentes y propietarios" es un DIRECTORIO DE PERSONAS, no otra lista de
 * avisos: quién publica los alquileres (propietarios, agentes inmobiliarios,
 * administradoras, representantes), con su verificación, zona, calificación y
 * cuántas propiedades activas tiene. La pestaña "Propiedades" sigue siendo,
 * sin ningún cambio, el listado de avisos que ya existía.
 *
 * Sin `server-only` y sin imports de Supabase a propósito: acá vive el orden,
 * los ids, el copy y el parseo del `?t=` — lo único testeable en node sin
 * jsdom ni base. La query de cada pestaña vive en sus propios módulos.
 */

export const PROPIEDADES_TAB_IDS = ["propiedades", "agentes"] as const;

export type PropiedadesTabId = (typeof PROPIEDADES_TAB_IDS)[number];

export const PROPIEDADES_TAB_LABELS: Record<PropiedadesTabId, string> = {
  propiedades: "Propiedades",
  agentes: "Agentes y propietarios",
};

const DEFAULT_TAB: PropiedadesTabId = "propiedades";

/**
 * `?t=` → pestaña. Cualquier valor que no matchea (vacío, viejo, inventado)
 * cae en "propiedades" — la pestaña canónica, la URL que ya está linkeada
 * desde el menú principal, `/buscar` y el resto de la app — para que un
 * enlace viejo o mal copiado siga abriendo el listado en vez de un 404.
 */
export function parsePropiedadesTab(raw: string | undefined): PropiedadesTabId {
  const value = (raw ?? "").trim().toLowerCase();
  return (PROPIEDADES_TAB_IDS as readonly string[]).includes(value)
    ? (value as PropiedadesTabId)
    : DEFAULT_TAB;
}

/**
 * Construye el href de una pestaña. "propiedades" va SIN query: es la URL
 * canónica de la sección y no queremos dos direcciones para la misma pantalla
 * (mismo criterio que `marketplaceTabHref`/`profileTabHref`).
 */
export function propiedadesTabHref(tab: PropiedadesTabId): string {
  return tab === DEFAULT_TAB ? "/propiedades" : `/propiedades?t=${tab}`;
}
