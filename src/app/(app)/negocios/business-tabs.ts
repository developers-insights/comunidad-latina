/**
 * LAS TRES PESTAÑAS DE NEGOCIOS (spec cliente: "Negocios | Publicaciones |
 * Ofertas") — parte PURA, mismo patrón que `perfil/profile-tabs.ts`,
 * `profesionales/professional-tabs.ts` y `marketplace/marketplace-tabs.ts`.
 *
 * Sin `server-only` y sin imports de Supabase a propósito: acá viven el orden,
 * los ids, el copy y el parseo del `?t=`, que es lo que se testea en node sin
 * jsdom ni base. Las consultas de cada pestaña viven en sus propios módulos
 * (`lib/negocios/publicaciones.ts`, `lib/negocios/ofertas.ts`, y la query del
 * directorio que ya estaba en la página).
 *
 * ── POR QUÉ `?t=ofertas` Y NO UNA RUTA `/negocios/ofertas` ───────────────────
 * Negocios ya tiene sub-rutas reales conviviendo con el grupo `(lista)`:
 * `presencia/`, `resenas/`, `copiloto/`, `cuenta/`, `[id]/horario/`. Todas
 * tienen algo en común y no es casual: son PANELES DEL DUEÑO — se entra desde
 * la ficha o desde el banner de venta, exigen sesión y no son navegación
 * pública. Ofertas es lo contrario: es la misma vidriera que el directorio,
 * mirada por otro corte. Meterla como carpeta hermana la disfrazaría de panel
 * y encima le pondría un `loading.tsx` distinto al del listado, cuando el
 * esqueleto que corresponde es exactamente el mismo.
 *
 * El motivo mecánico va en la misma dirección: `/negocios/[id]` llama
 * `notFound()` para cualquier id que no sea un negocio, y por eso el fallback
 * de carga vive acotado en `(lista)/loading.tsx` (ver su docblock). Una
 * carpeta más al lado de `[id]` es una excepción más que mantener en ese
 * mapa. Con `?t=` las tres pestañas comparten ruta, esqueleto y grupo, y el
 * detalle sigue sin techo de Suspense.
 */

export const BUSINESS_TAB_IDS = ["negocios", "publicaciones", "ofertas"] as const;

export type BusinessTabId = (typeof BUSINESS_TAB_IDS)[number];

export const BUSINESS_TAB_LABELS: Record<BusinessTabId, string> = {
  negocios: "Negocios",
  publicaciones: "Publicaciones",
  ofertas: "Ofertas",
};

/**
 * La pestaña que abre `/negocios` a secas. Es el directorio y no se mueve: esa
 * URL ya está linkeada desde el menú principal, desde `/buscar`, desde el chip
 * de cada módulo y desde media docena de CTAs internos. Cambiar qué carga por
 * default sería una regresión silenciosa para todo el que la tenga guardada.
 */
const DEFAULT_TAB: BusinessTabId = "negocios";

/**
 * `?t=` → pestaña. Cualquier valor que no matchea (vacío, viejo, inventado,
 * con mayúsculas) cae en el directorio en vez de 404: una URL mal copiada
 * tiene que abrir Negocios igual.
 */
export function parseBusinessTab(raw: string | undefined): BusinessTabId {
  const value = (raw ?? "").trim().toLowerCase();
  return (BUSINESS_TAB_IDS as readonly string[]).includes(value)
    ? (value as BusinessTabId)
    : DEFAULT_TAB;
}

/**
 * Href de una pestaña. El directorio va SIN `?t=` (URL canónica del módulo);
 * las otras dos son las únicas que lo necesitan. Ninguna arrastra los filtros
 * ni el cursor de la otra a propósito — mismo criterio que `profileTabHref`:
 * un rubro no significa nada en Ofertas, y un cursor de publicaciones abriría
 * la pestaña nueva a mitad de una página que nadie pidió.
 */
export function businessTabHref(tab: BusinessTabId): string {
  return tab === DEFAULT_TAB ? "/negocios" : `/negocios?t=${tab}`;
}
