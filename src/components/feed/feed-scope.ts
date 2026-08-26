/**
 * =============================================================================
 * LAS DOS MITADES DEL FEED — «Siguiendo» y «Para ti» (spec de módulos §8)
 * =============================================================================
 *
 * «El feed de inicio debe dividirse en: Siguiendo —contenido de usuarios,
 * creadores, negocios y profesionales que el usuario sigue— y Para ti
 * —recomendaciones personalizadas, contenido comunitario y promociones
 * pagadas.»
 *
 * ── POR QUÉ UN PARÁMETRO NUEVO Y NO UN SEXTO `FEED_TABS` ────────────────────
 * Los cinco `FEED_TABS` (`?tab=`) son VERTICALES: Todo, Vivienda, Negocios,
 * Profesionales, Eventos. Se pintan como la fila de círculos de módulos y sus
 * ids son 1:1 con los scopes de video (`VideoScopeProp`), que es lo que hace
 * que tocar un reel desde "Negocios" abra el reel de negocios. Meter
 * «Siguiendo» ahí lo rompería dos veces: no es un módulo (no tiene círculo ni
 * ícono propio en el registro) y no es un scope de video (no hay un reel "de lo
 * que sigo").
 *
 * Son DOS PREGUNTAS DISTINTAS sobre el mismo feed —de quién es esto, y de qué
 * vertical es— así que van en dos parámetros que se combinan: `?ver=siguiendo`
 * y `?tab=negocios` conviven y significan exactamente lo que parecen.
 *
 * ── «PARA TI» ES EL DEFAULT Y NO LLEVA PARÁMETRO ────────────────────────────
 * `/feed` a secas ya está linkeado desde el bottom nav, desde el logo, desde
 * cada círculo de módulo y desde media docena de CTAs. Que la URL canónica siga
 * abriendo lo mismo de siempre no es una preferencia: cambiar qué carga por
 * default sería una regresión silenciosa para todo el que la tenga guardada.
 * Es el mismo criterio de `businessTabHref` y `marketplaceTabHref`.
 *
 * Módulo PURO —sin `server-only`, sin React— porque lo leen las tres capas: el
 * Server Component que arma la página, la server action del scroll infinito y
 * el control cliente que pinta las dos pestañas.
 */

export const FEED_SCOPES = ["para-ti", "siguiendo"] as const;

export type FeedScope = (typeof FEED_SCOPES)[number];

export const FEED_SCOPE_LABELS: Record<FeedScope, string> = {
  "para-ti": "Para ti",
  siguiendo: "Siguiendo",
};

const DEFAULT_SCOPE: FeedScope = "para-ti";

/**
 * `?ver=` → mitad del feed. Cualquier valor que no matchea (vacío, viejo,
 * inventado, con mayúsculas) cae en «Para ti» en vez de 404: una URL mal
 * copiada tiene que abrir el feed igual.
 */
export function parseFeedScope(raw: string | undefined): FeedScope {
  const value = (raw ?? "").trim().toLowerCase();
  return (FEED_SCOPES as readonly string[]).includes(value)
    ? (value as FeedScope)
    : DEFAULT_SCOPE;
}

/**
 * Href de una mitad, PRESERVANDO el vertical que estuviera activo: cambiar de
 * «Para ti» a «Siguiendo» estando en Negocios tiene que dejarte en Negocios.
 * El cursor NO se preserva —abriría la pestaña nueva a mitad de una página que
 * nadie pidió—, mismo criterio que `businessTabHref`.
 */
export function feedScopeHref(scope: FeedScope, tab?: string | null): string {
  const params = new URLSearchParams();
  if (scope !== DEFAULT_SCOPE) params.set("ver", scope);
  if (tab && tab !== "para-ti") params.set("tab", tab);
  const query = params.toString();
  return query ? `/feed?${query}` : "/feed";
}
