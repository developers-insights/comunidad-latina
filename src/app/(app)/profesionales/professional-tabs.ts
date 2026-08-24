/**
 * LAS DOS PESTAÑAS DE PROFESIONALES (spec cliente: "Profesionales | Publicaciones")
 * — parte PURA, mismo patrón que `perfil/profile-tabs.ts`.
 *
 * Sin `server-only` y sin imports de Supabase a propósito: acá viven el orden,
 * los ids, el copy y el parseo del `?t=`, que es lo que se testea en node sin
 * jsdom ni base. Las consultas de cada pestaña viven en sus propios módulos
 * (`entity-posts.ts` para Publicaciones; la query existente para Profesionales).
 */

export const PROFESSIONALS_TAB_IDS = ["profesionales", "publicaciones"] as const;

export type ProfessionalsTabId = (typeof PROFESSIONALS_TAB_IDS)[number];

export const PROFESSIONALS_TAB_LABELS: Record<ProfessionalsTabId, string> = {
  profesionales: "Profesionales",
  publicaciones: "Publicaciones",
};

/**
 * `?t=` → pestaña. Cualquier valor que no sea "publicaciones" cae en
 * "profesionales" — la pestaña por defecto y la que NO lleva query string, para
 * no romper ningún link viejo a `/profesionales` ni `/profesionales?rubro=...`.
 */
export function parseProfessionalsTab(raw: string | undefined): ProfessionalsTabId {
  const value = (raw ?? "").trim().toLowerCase();
  return value === "publicaciones" ? "publicaciones" : "profesionales";
}

/**
 * Href de una pestaña. "profesionales" va SIN `?t=` (URL canónica del módulo,
 * la que ya comparte todo el mundo hoy); "publicaciones" es la única que lo
 * necesita. Ninguna de las dos arrastra filtros ni cursor de la otra pestaña a
 * propósito — mismo criterio que `profileTabHref`: un cursor de una lista no
 * significa nada en la otra, y arrastrarlo abriría la pestaña nueva a mitad de
 * una página que la persona nunca pidió.
 */
export function professionalsTabHref(tab: ProfessionalsTabId): string {
  return tab === "profesionales" ? "/profesionales" : "/profesionales?t=publicaciones";
}
