"use client";

import Link from "next/link";
import { ArrowRight } from "@phosphor-icons/react/dist/ssr";
import { Skeleton } from "@/components/ui";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  SEARCH_GROUP_META,
  moduleSearchHref,
  type SearchGroup,
} from "./helpers";
import { SEARCH_TYPE_ICON } from "./search-icons";
import { SearchResultRow } from "./search-result-row";

/**
 * Resultados agrupados por tipo.
 *
 * Cada grupo es una lista con su encabezado y, cuando el listado de ese módulo
 * acepta término de búsqueda, un pie "Ver todos los…" que abre ese listado con
 * lo escrito ya cargado. Dónde NO aparece ese pie y por qué está documentado en
 * `SEARCH_GROUP_META` (helpers.ts): resumido, no se ofrece un link a un listado
 * que descartaría en silencio lo que la persona escribió.
 */
export function SearchResults({
  groups,
  query,
  onNavigate,
  className,
}: {
  groups: readonly SearchGroup[];
  query: string;
  onNavigate?: () => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-5", className)}>
      {groups.map((group) => {
        const meta = SEARCH_GROUP_META[group.type];
        const GroupIcon = SEARCH_TYPE_ICON[group.type];
        const seeAllHref = moduleSearchHref(group.type, query);
        const headingId = `buscar-grupo-${group.type}`;

        return (
          <section key={group.type} aria-labelledby={headingId}>
            <h3
              id={headingId}
              className="mb-1 flex items-center gap-2 px-2 text-xs font-semibold uppercase tracking-wide text-foreground-muted"
            >
              <span
                aria-hidden="true"
                className="flex size-5 items-center justify-center rounded-full"
                style={{
                  backgroundColor: `color-mix(in oklab, ${meta.accentVar} 14%, transparent)`,
                  color: meta.accentVar,
                }}
              >
                <GroupIcon size={12} weight="bold" />
              </span>
              {meta.label}
            </h3>

            <ul className="flex flex-col">
              {group.items.map((item) => (
                <li key={`${item.type}:${item.id}`}>
                  <SearchResultRow item={item} onNavigate={onNavigate} />
                </li>
              ))}
            </ul>

            {seeAllHref && (
              <Link
                href={seeAllHref}
                data-search-item=""
                onClick={onNavigate}
                className={cn(
                  "group ml-2 mt-1 inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm font-semibold",
                  "text-brand-ink transition-[background-color] duration-(--duration-fast) ease-(--ease-out-premium)",
                  "hover:bg-brand-tint",
                  "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
                )}
              >
                {meta.seeAllLabel}
                <ArrowRight
                  aria-hidden="true"
                  size={14}
                  weight="bold"
                  className="transition-transform duration-(--duration-fast) ease-(--ease-out-premium) group-hover:translate-x-0.5"
                />
              </Link>
            )}
          </section>
        );
      })}
    </div>
  );
}

/**
 * Silueta de la carga: DOS grupos con encabezado y tres filas cada uno — la
 * forma exacta que va a ocupar el resultado real. No es un spinner y no es una
 * barra genérica: el repo no usa spinners para contenido (§5.2), y una silueta
 * que coincide con lo que llega después es lo que evita el salto de layout
 * cuando llega.
 */
export function SearchResultsSkeleton({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cn("flex flex-col gap-5", className)}>
      {[0, 1].map((group) => (
        <div key={group}>
          <div className="mb-2 flex items-center gap-2 px-2">
            <Skeleton className="size-5 rounded-full" />
            <Skeleton className="h-3 w-24" />
          </div>
          <div className="flex flex-col gap-1">
            {[0, 1, 2].map((row) => (
              <div key={row} className="flex items-center gap-3 p-2">
                <Skeleton className="size-12 shrink-0 rounded-sm" />
                <div className="min-w-0 flex-1">
                  <Skeleton className="h-3.5 w-2/3" />
                  <Skeleton className="mt-2 h-3 w-1/3" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
      <span className="sr-only">{t("sections", "searchResultsLabel")}</span>
    </div>
  );
}
