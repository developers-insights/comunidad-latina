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
// attrs de producto — patrón parsePropertyAttrs (listings/helpers.ts)
// ---------------------------------------------------------------------------

export interface ProductAttrs {
  /** id del listing kind='business' dueño de la tienda. */
  storeListingId: string | null;
  category: string | null;
  condition: string | null;
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
