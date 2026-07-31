import type { Json } from "@/lib/types/database.types";

/**
 * Taxonomía de negocios (`listings.attrs.category`).
 *
 * Vivía inline en `page.tsx`; sale a su propio archivo PURO porque ahora la
 * consumen tres superficies: el chip de la tarjeta, los filtros del listado y
 * las sugerencias de la búsqueda global. Un archivo sin imports de servidor
 * también es la única forma de que un client component la use sin arrastrar
 * `@/lib/supabase/server` al bundle.
 *
 * `attrs.category` es texto libre en la base: esta lista es el set CURADO que
 * conoce la UI, no una restricción. Un valor fuera de la lista se capitaliza y
 * se muestra igual (ver `businessCategoryLabel`).
 */
export const BUSINESS_CATEGORIES = [
  { value: "restaurante", label: "Restaurante" },
  { value: "envios", label: "Envíos" },
  { value: "belleza", label: "Belleza" },
  { value: "mecanica", label: "Mecánica" },
  { value: "mercado", label: "Mercado" },
  { value: "servicios", label: "Servicios" },
] as const;

export type BusinessCategory = (typeof BUSINESS_CATEGORIES)[number]["value"];

const LABEL_BY_VALUE = new Map<string, string>(
  BUSINESS_CATEGORIES.map((option) => [option.value, option.label]),
);

export function isBusinessCategory(value: string): value is BusinessCategory {
  return LABEL_BY_VALUE.has(value);
}

/** Etiqueta legible; un valor desconocido se capitaliza en vez de descartarse. */
export function businessCategoryLabel(value: string | null): string | null {
  if (!value) return null;
  return LABEL_BY_VALUE.get(value) ?? value.charAt(0).toUpperCase() + value.slice(1);
}

/** `attrs.category` de una fila de `listings`, o null si no tiene. */
export function businessCategoryOf(attrs: Json): string | null {
  if (attrs === null || typeof attrs !== "object" || Array.isArray(attrs)) return null;
  const raw = (attrs as Record<string, unknown>).category;
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}
