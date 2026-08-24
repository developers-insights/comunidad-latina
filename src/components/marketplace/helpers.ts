import type { Json } from "@/lib/types/database.types";
import { formatListingPrice } from "@/components/listings";

/**
 * Helpers puros del módulo MARKETPLACE. Sin dependencias de servidor:
 * usables desde Server Components, Client Components y server actions.
 */

// ---------------------------------------------------------------------------
// Categorías — lista curada fija (attrs.category es texto libre en la DB,
// pero acá se restringe a un set conocido para que el filtro de /marketplace
// y el <Select> de /marketplace/publicar compartan las mismas opciones).
// ---------------------------------------------------------------------------

export const PRODUCT_CATEGORIES = [
  { value: "ropa_accesorios", label: "Ropa y accesorios", shortLabel: "Ropa" },
  { value: "comida_bebidas", label: "Comida y bebidas", shortLabel: "Comida" },
  { value: "hogar", label: "Hogar", shortLabel: "Hogar" },
  { value: "belleza_cuidado", label: "Belleza y cuidado personal", shortLabel: "Belleza" },
  { value: "electronica", label: "Electrónica", shortLabel: "Electrónica" },
  { value: "ninos_bebes", label: "Niños y bebés", shortLabel: "Niños" },
  { value: "artesanias", label: "Artesanías", shortLabel: "Artesanías" },
  { value: "otro", label: "Otro", shortLabel: "Otro" },
] as const;

export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number]["value"];

export function isProductCategory(value: string): value is ProductCategory {
  return PRODUCT_CATEGORIES.some((option) => option.value === value);
}

/** Etiqueta legible de una categoría — si no matchea el set curado, la capitaliza. */
export function categoryLabel(value: string | null): string | null {
  if (!value) return null;
  const known = PRODUCT_CATEGORIES.find((option) => option.value === value);
  return known ? known.label : value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Versión corta de `categoryLabel` — pensada para el chip flotante de
 * ProductCard, que en la grilla 2-col vive en ~170px y no tiene lugar para
 * "Belleza y cuidado personal" en una sola línea. Mismo patrón y mismo
 * fallback que `categoryLabel` (capitaliza el value crudo si no matchea el
 * set curado); ese fallback puede seguir siendo largo, por eso la card igual
 * lleva `truncate` como red de seguridad.
 */
export function categoryShortLabel(value: string | null): string | null {
  if (!value) return null;
  const known = PRODUCT_CATEGORIES.find((option) => option.value === value);
  return known ? known.shortLabel : value.charAt(0).toUpperCase() + value.slice(1);
}

// ---------------------------------------------------------------------------
// Condición
// ---------------------------------------------------------------------------

export const PRODUCT_CONDITIONS = [
  { value: "nuevo", label: "Nuevo" },
  { value: "usado", label: "Usado" },
] as const;

export type ProductCondition = (typeof PRODUCT_CONDITIONS)[number]["value"];

export function isProductCondition(value: string): value is ProductCondition {
  return PRODUCT_CONDITIONS.some((option) => option.value === value);
}

export function conditionLabel(value: string | null): string | null {
  if (!value) return null;
  return PRODUCT_CONDITIONS.find((option) => option.value === value)?.label ?? null;
}

// ---------------------------------------------------------------------------
// Envío / entrega / recogida — cómo llega el artículo a quien compra.
//
// Vive en `attrs.fulfillment` (jsonb, mismo lugar que category/condition) y NO
// en una migración: no hay nada acá que necesite ser consultable por columna
// (no se filtra por método de entrega, sólo se MUESTRA), así que agregar
// columnas y un CHECK nuevo habría sido superficie de esquema por una lista de
// hasta 3 strings. Un producto puede ofrecer más de uno a la vez (envío Y
// recogida, por ejemplo) — por eso es array y no un enum simple como condition.
// ---------------------------------------------------------------------------

export const FULFILLMENT_METHODS = [
  { value: "envio", label: "Envío", shortLabel: "Envío" },
  { value: "entrega", label: "Entrega en mano", shortLabel: "Entrega" },
  { value: "recogida", label: "Recogida en persona", shortLabel: "Recogida" },
] as const;

export type FulfillmentMethod = (typeof FULFILLMENT_METHODS)[number]["value"];

export function isFulfillmentMethod(value: string): value is FulfillmentMethod {
  return FULFILLMENT_METHODS.some((option) => option.value === value);
}

export function fulfillmentLabel(value: string): string | null {
  return FULFILLMENT_METHODS.find((option) => option.value === value)?.label ?? null;
}

/** Sólo los valores del set curado, sin duplicados y en el orden del catálogo — nunca lo que mande el cliente tal cual. */
function sanitizeFulfillment(values: unknown): FulfillmentMethod[] {
  if (!Array.isArray(values)) return [];
  const known = new Set(values.filter((v): v is string => typeof v === "string"));
  return FULFILLMENT_METHODS.map((option) => option.value).filter((value) => known.has(value));
}

// ---------------------------------------------------------------------------
// Categoría de TIENDA (listings kind='business', attrs.category) — a
// diferencia de PRODUCT_CATEGORIES, acá no hay un set curado propio: la
// categoría de negocio la define el módulo Negocios (rubro libre) y este
// módulo sólo la MUESTRA en el directorio de Tiendas. Mismo fallback que
// categoryLabel para categorías fuera de cualquier lista: capitalizar en vez
// de mostrar el value crudo (`comida_bebidas` → `Comida_bebidas` sería peor
// que no mostrar nada, pero mostrar el texto tal cual con la primera en
// mayúscula alcanza para un directorio).
// ---------------------------------------------------------------------------

export function businessCategoryDisplayLabel(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).replace(/_/g, " ");
}

// ---------------------------------------------------------------------------
// attrs de producto — patrón parsePropertyAttrs (listings/helpers.ts)
// ---------------------------------------------------------------------------

export interface ProductAttrs {
  /** id del listing kind='business' dueño de la tienda. */
  storeListingId: string | null;
  category: string | null;
  condition: string | null;
  /** Cómo llega el producto a quien compra — 0 a 3 valores del catálogo. */
  fulfillment: FulfillmentMethod[];
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

export function parseProductAttrs(attrs: Json): ProductAttrs {
  const record =
    attrs !== null && typeof attrs === "object" && !Array.isArray(attrs)
      ? (attrs as Record<string, unknown>)
      : {};
  return {
    storeListingId: asNonEmptyString(record.store_listing_id),
    category: asNonEmptyString(record.category),
    condition: asNonEmptyString(record.condition),
    fulfillment: sanitizeFulfillment(record.fulfillment),
  };
}

// ---------------------------------------------------------------------------
// Precio — los productos siempre son precio_period=null (one_time).
// ---------------------------------------------------------------------------

export function formatProductPrice(
  amount: number | null,
  currency: string,
  locale = "es-US",
): string | null {
  return formatListingPrice(amount, currency, null, locale);
}

// ---------------------------------------------------------------------------
// Seguidores de la tienda
// ---------------------------------------------------------------------------

export function followerCountLabel(count: number): string {
  if (count <= 0) return "Sin seguidores todavía";
  if (count === 1) return "1 seguidor";
  return `${count.toLocaleString("es-US")} seguidores`;
}

// ---------------------------------------------------------------------------
// Búsqueda — normaliza el ?q= de /marketplace antes de usarlo en textSearch()
// (mismo cap de longitud que /propiedades, ver propiedades/page.tsx) y antes
// de mostrarlo en el estado vacío ("No encontramos nada con «…»"). El cliente
// llama a esto al enviar el formulario Y la página lo vuelve a aplicar del
// lado del servidor — nunca confiamos en que el querystring llegue ya limpio
// (alguien puede pegar una URL a mano).
// ---------------------------------------------------------------------------

const MAX_SEARCH_QUERY_LENGTH = 120;

export function sanitizeSearchQuery(value: string): string {
  return value.trim().slice(0, MAX_SEARCH_QUERY_LENGTH);
}
