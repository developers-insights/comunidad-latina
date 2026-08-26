/**
 * =============================================================================
 * CATEGORÍAS DE EVENTO — la taxonomía que faltaba
 * =============================================================================
 *
 * `eventos/(lista)/page.tsx` documenta esta ausencia como pendiente: no había
 * ni columna ni convención en `attrs`, así que el filtro por categoría no se
 * implementó — con razón, porque un desplegable que filtra sobre un campo vacío
 * queda siempre en cero y parece que no hay eventos.
 *
 * Esto es esa convención. Misma clave y mismo estilo que la taxonomía de
 * negocios (`attrs.category`, ver src/app/(app)/negocios/categories.ts): lista
 * CURADA, corta, en español sin acentos como valor y con etiqueta humana
 * aparte. Un valor fuera de la lista se muestra igual capitalizado en vez de
 * descartarse — la taxonomía es lo que la UI CONOCE, no una restricción sobre
 * un JSONB libre que nunca la tuvo.
 *
 * POR QUÉ ESTAS OCHO Y NO VEINTE. La lista tiene que caber en un desplegable de
 * teléfono y, sobre todo, tiene que poder llenarse: con veinte categorías cada
 * una tiene tres eventos y el filtro deja de servir para lo único que sirve, que
 * es no scrollear. Están las que esta comunidad de verdad publica —fiestas,
 * misas y cultos, ferias, trámites y charlas de ayuda— y `otro` cierra la lista
 * para que nadie se quede sin poder publicar.
 *
 * Módulo PURO (sin imports de servidor): lo usan el formulario de publicar
 * (client), la server action (escritura) y el listado (lectura y filtro).
 */

export const EVENT_CATEGORIES = [
  { value: "fiesta", label: "Fiesta y música" },
  { value: "comunidad", label: "Encuentro comunitario" },
  { value: "religioso", label: "Religioso" },
  { value: "feria", label: "Feria y mercado" },
  { value: "deporte", label: "Deporte" },
  { value: "familiar", label: "Para toda la familia" },
  { value: "formacion", label: "Charla o taller" },
  { value: "tramites", label: "Trámites y ayuda" },
  { value: "otro", label: "Otro" },
] as const;

export type EventCategory = (typeof EVENT_CATEGORIES)[number]["value"];

const LABEL_BY_VALUE = new Map<string, string>(
  EVENT_CATEGORIES.map((option) => [option.value, option.label]),
);

export function isEventCategory(value: unknown): value is EventCategory {
  return typeof value === "string" && LABEL_BY_VALUE.has(value);
}

/**
 * Etiqueta legible. Un valor desconocido —un seed viejo, una importación— se
 * capitaliza y se muestra, igual que hace `businessCategoryLabel`. Descartarlo
 * escondería un evento que existe.
 */
export function eventCategoryLabel(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  return LABEL_BY_VALUE.get(value) ?? value.charAt(0).toUpperCase() + value.slice(1);
}

// ---------------------------------------------------------------------------
// Público recomendado
// ---------------------------------------------------------------------------

/**
 * "Para quién es" — la pregunta que decide si alguien lleva a los chicos o
 * consigue quién los cuide. Es una sola opción y no una lista de chips: un
 * evento tiene UN público recomendado, y ofrecer marcar cinco a la vez
 * devolvería a "para todos", que ya es la primera opción.
 */
export const EVENT_AUDIENCES = [
  { value: "todo_publico", label: "Todo público" },
  { value: "familias", label: "Familias con niños" },
  { value: "ninos", label: "Niños" },
  { value: "jovenes", label: "Jóvenes" },
  { value: "adultos", label: "Solo adultos (+18)" },
  { value: "mayores", label: "Adultos mayores" },
] as const;

export type EventAudience = (typeof EVENT_AUDIENCES)[number]["value"];

const AUDIENCE_LABEL = new Map<string, string>(
  EVENT_AUDIENCES.map((option) => [option.value, option.label]),
);

export function isEventAudience(value: unknown): value is EventAudience {
  return typeof value === "string" && AUDIENCE_LABEL.has(value);
}

/** Etiqueta humana del público, o `null` si no está en el catálogo. */
export function eventAudienceLabel(value: unknown): string | null {
  return typeof value === "string" ? (AUDIENCE_LABEL.get(value) ?? null) : null;
}
