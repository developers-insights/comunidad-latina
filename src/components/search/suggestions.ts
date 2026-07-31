import { PROFESSIONAL_CATEGORIES } from "@/components/directory/helpers";
import { PRODUCT_CATEGORIES } from "@/components/marketplace/helpers";
import { BUSINESS_CATEGORIES } from "@/app/(app)/negocios/categories";
import { sanitizeSearchQuery } from "./helpers";

/**
 * Sugerencias mientras se escribe.
 *
 * QUÉ NO ES: no hay "términos populares". Para calcular un ranking de términos
 * hace falta volumen de búsquedas y hoy no existe ni una sola búsqueda
 * registrada. Una lista inventada de "lo más buscado" no es un atajo: es una
 * afirmación falsa sobre la comunidad, puesta en la pantalla más visible de la
 * app. Se deja afuera hasta que haya datos, y está anotado en el contrato.
 *
 * QUÉ SÍ ES: dos fuentes REALES, ambas ya disponibles sin una query nueva por
 * tecla —
 *   1. CIUDADES / ZONAS: los `area_label` distintos de los avisos publicados
 *      del tenant. Los resuelve el Server Component de /buscar una sola vez y
 *      se los pasa a la isla; no hay ida a la base por pulsación.
 *   2. CATEGORÍAS: las taxonomías curadas que ya usan los filtros de cada
 *      módulo (marketplace, profesionales, negocios). Si una categoría existe
 *      como filtro, existe como sugerencia — no se inventa ninguna.
 *
 * Y el historial, que va primero porque es lo único que la persona ya eligió.
 */

export type SuggestionKind = "historial" | "zona" | "categoria";

export interface SearchSuggestion {
  kind: SuggestionKind;
  /** El término que se va a buscar (y que se muestra). */
  term: string;
}

/** Máximo de sugerencias en pantalla: más que esto tapa los resultados. */
export const MAX_SUGGESTIONS = 6;

/**
 * Categorías de TODOS los módulos, aplanadas a etiquetas legibles. Se arma una
 * vez por módulo, no por tecla.
 */
export const CATEGORY_TERMS: string[] = [
  ...PRODUCT_CATEGORIES.map((option) => option.label),
  ...PROFESSIONAL_CATEGORIES.map((option) => option.label),
  ...BUSINESS_CATEGORIES.map((option) => option.label),
];

/**
 * Normaliza para comparar: sin acentos y en minúscula. Es la única forma de que
 * "bogota" encuentre "Bogotá" — que es como se escribe cuando se tipea rápido
 * en un teclado de teléfono.
 */
export function foldForMatch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "") // marcas diacriticas combinantes (NFD)
    .toLocaleLowerCase("es");
}

/**
 * Sugerencias para lo que se está escribiendo.
 *
 * Prioridad: historial → zonas → categorías. El historial primero porque es lo
 * que esa persona YA buscó; lo demás es descubrimiento.
 *
 * Match por PREFIJO de palabra (no substring suelto): escribir "car" sugiere
 * "Caracas" pero no "Descargas". Un substring en cualquier posición devuelve
 * coincidencias que a quien las lee le parecen azarosas.
 */
export function buildSuggestions(
  query: string,
  options: { zones?: readonly string[]; history?: readonly string[] } = {},
): SearchSuggestion[] {
  const term = sanitizeSearchQuery(query);
  if (term.length === 0) return [];

  const needle = foldForMatch(term);
  const out: SearchSuggestion[] = [];
  const seen = new Set<string>();

  const typed = term.toLocaleLowerCase("es");

  const push = (kind: SuggestionKind, candidate: string) => {
    if (out.length >= MAX_SUGGESTIONS) return;
    // No se sugiere EXACTAMENTE lo que ya está escrito: sería un botón que no
    // hace nada. La comparación ignora mayúsculas pero NO acentos, a propósito:
    // `global_search` corre `websearch_to_tsquery('spanish', …)` SIN unaccent
    // (está documentado en la migración 0044), así que "bogotá" y "Bogota" son
    // dos consultas distintas y ofrecer la grafía que sí está en los datos es
    // justamente lo que salva la búsqueda.
    if (candidate.toLocaleLowerCase("es") === typed) return;
    const folded = foldForMatch(candidate);
    // El dedupe SÍ ignora acentos: dos filas casi idénticas en pantalla se leen
    // como un error de la app, no como dos opciones.
    if (seen.has(folded)) return;
    if (!matchesPrefix(folded, needle)) return;
    seen.add(folded);
    out.push({ kind, term: candidate });
  };

  for (const entry of options.history ?? []) push("historial", entry);
  for (const zone of options.zones ?? []) push("zona", zone);
  for (const category of CATEGORY_TERMS) push("categoria", category);

  return out;
}

/** ¿Alguna palabra de `haystack` (ya normalizado) empieza con `needle`? */
function matchesPrefix(haystack: string, needle: string): boolean {
  if (haystack.startsWith(needle)) return true;
  return haystack.split(/[\s,/-]+/).some((word) => word.length > 0 && word.startsWith(needle));
}
