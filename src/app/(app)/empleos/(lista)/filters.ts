import { sanitizeSearchQuery } from "@/components/search";
import { toEmpleosTab, type EmpleosTab } from "@/components/empleos/helpers";

/**
 * Filtros de `?tipo=`/`?q=`/`?cursor=` de /empleos, en su propio módulo (y no
 * dentro de `page.tsx`): Next 16 valida en build que un `page.tsx` sólo tenga
 * los exports reservados (`default`, `metadata`, …) — cualquier otro export
 * nombrado rompe `tsc` contra `.next/types` (route typing). Separarlas acá
 * además las deja testeables sin renderizar la página.
 *
 * La TRADUCCIÓN de `?tipo=` a pestaña (incluidos los valores viejos de jornada)
 * vive en `components/empleos/helpers`, no acá: la necesitan por igual el
 * servidor —para armar la consulta— y los chips en el cliente —para saber cuál
 * marcar—. Se re-exporta para que este módulo siga siendo la única puerta de la
 * ruta a sus query params.
 */

export {
  isEmpleosTab,
  isLegacyEmploymentTipo,
  toEmpleosTab,
} from "@/components/empleos/helpers";

export interface Filters {
  /** Pestaña activa. `""` = "Todos" (empleos + ocasional + servicios). */
  tipo: EmpleosTab | "";
  q: string;
  cursor: string;
}

function firstValue(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export function parseFilters(sp: Record<string, string | string[] | undefined>): Filters {
  const tipo = firstValue(sp.tipo).slice(0, 20);
  return {
    tipo: toEmpleosTab(tipo),
    q: sanitizeSearchQuery(firstValue(sp.q)),
    cursor: firstValue(sp.cursor).slice(0, 200),
  };
}
