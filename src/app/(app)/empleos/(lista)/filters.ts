import { sanitizeSearchQuery } from "@/components/search";
import { EMPLOYMENT_TYPES, type EmploymentType } from "@/components/empleos/helpers";

/**
 * Filtros de `?tipo=`/`?q=`/`?cursor=` de /empleos, en su propio módulo (y no
 * dentro de `page.tsx`): Next 16 valida en build que un `page.tsx` sólo tenga
 * los exports reservados (`default`, `metadata`, …) — cualquier otro export
 * nombrado rompe `tsc` contra `.next/types` (route typing). Separarlas acá
 * además las deja testeables sin renderizar la página.
 */

export interface Filters {
  tipo: EmploymentType | "";
  q: string;
  cursor: string;
}

function firstValue(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

/**
 * Genérico a propósito: no lista "full_time"/"part_time" a mano, así que la
 * changa ("one_off", L1) entra sola apenas se suma a EMPLOYMENT_TYPES y un
 * valor viejo o inventado (`?tipo=freelance`) cae al "Todos" en vez de romper
 * la query.
 */
export function isEmploymentType(value: string): value is EmploymentType {
  return (EMPLOYMENT_TYPES as readonly string[]).includes(value);
}

export function parseFilters(sp: Record<string, string | string[] | undefined>): Filters {
  const tipo = firstValue(sp.tipo).slice(0, 20);
  return {
    tipo: isEmploymentType(tipo) ? tipo : "",
    q: sanitizeSearchQuery(firstValue(sp.q)),
    cursor: firstValue(sp.cursor).slice(0, 200),
  };
}
