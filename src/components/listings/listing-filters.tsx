"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { MagnifyingGlass, X } from "@phosphor-icons/react/dist/ssr";
import { Input, Select } from "@/components/ui";
import {
  PROPERTY_OPERATION_OPTIONS,
  PROPERTY_TYPE_OPTIONS,
} from "@/lib/propiedades/tipos";
import { cn } from "@/lib/utils";
import { COPY } from "./copy";

export interface ListingFiltersProps {
  /** Zonas reales presentes en los avisos publicados del tenant. */
  zones: string[];
  className?: string;
}

const PRICE_OPTIONS = [1000, 1500, 2000, 2500, 3000];

/**
 * Búsqueda + filtros de /propiedades. Estado canónico en la URL
 * (searchParams) → el Server Component re-consulta; el cursor de paginación
 * se resetea en cada cambio.
 */
export function ListingFilters({ zones, className }: ListingFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [query, setQuery] = useState(searchParams.get("q") ?? "");

  const precio = searchParams.get("precio") ?? "";
  const hab = searchParams.get("hab") ?? "";
  const zona = searchParams.get("zona") ?? "";
  const tipo = searchParams.get("tipo") ?? "";
  const operacion = searchParams.get("operacion") ?? "";
  const hasFilters = Boolean(precio || hab || zona || tipo || operacion || searchParams.get("q"));

  function apply(next: Record<string, string>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    params.delete("cursor"); // nuevo criterio → primera página
    startTransition(() => {
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    });
  }

  return (
    <div
      className={cn("flex flex-col gap-3", isPending && "opacity-70", className)}
      aria-busy={isPending}
    >
      <form
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          apply({ q: query.trim() });
        }}
        className="relative"
      >
        <MagnifyingGlass
          size={18}
          aria-hidden="true"
          className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-foreground-muted"
        />
        <Input
          type="search"
          inputMode="search"
          enterKeyHint="search"
          aria-label={COPY.list.searchLabel}
          placeholder={COPY.list.searchPlaceholder}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="pl-11"
        />
      </form>

      {/* Mobile-first: los labels cortos comparten filas de 2 columnas; la zona
          (labels largos, p. ej. "Flushing Meadows Corona Park, Queens") ocupa
          dos celdas para no truncar. En sm+ son 3 columnas y la zona sigue
          tomando dos. min-w-0 deja que cada grid item se encoja y el <select>
          recorte su texto en vez de desbordar el ancho.

          El ORDEN no es casual: operación primero porque es el filtro que más
          descarta —quien busca alquiler no quiere ver ventas— y tipo justo
          después. Precio, habitaciones y zona quedan como afinado. */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Select
          aria-label={COPY.list.filterOperationLabel}
          value={operacion}
          onChange={(event) => apply({ operacion: event.target.value })}
          className="min-w-0"
        >
          {/* La opción vacía dice "Alquiler y venta", no "Todas": deja claro que
              sin filtro se ven las dos cosas — incluidos los avisos publicados
              antes de que este campo existiera, que no declaran ninguna. */}
          <option value="">{COPY.list.filterOperationAny}</option>
          {PROPERTY_OPERATION_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>

        <Select
          aria-label={COPY.list.filterTypeLabel}
          value={tipo}
          onChange={(event) => apply({ tipo: event.target.value })}
          className="min-w-0"
        >
          <option value="">{COPY.list.filterTypeAny}</option>
          {PROPERTY_TYPE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>

        <Select
          aria-label={COPY.list.filterPriceLabel}
          value={precio}
          onChange={(event) => apply({ precio: event.target.value })}
          className="min-w-0"
        >
          <option value="">{COPY.list.filterPriceAny}</option>
          {PRICE_OPTIONS.map((value) => (
            <option key={value} value={value}>
              Hasta ${value.toLocaleString("es-US")}
            </option>
          ))}
        </Select>

        <Select
          aria-label={COPY.list.filterBedroomsLabel}
          value={hab}
          onChange={(event) => apply({ hab: event.target.value })}
          className="min-w-0"
        >
          <option value="">{COPY.list.filterBedroomsAny}</option>
          <option value="1">1+ hab</option>
          <option value="2">2+ habs</option>
          <option value="3">3+ habs</option>
        </Select>

        <Select
          aria-label={COPY.list.filterZoneLabel}
          value={zona}
          onChange={(event) => apply({ zona: event.target.value })}
          className="col-span-2 min-w-0"
        >
          <option value="">{COPY.list.filterZoneAny}</option>
          {zones.map((label) => (
            <option key={label} value={label}>
              {label}
            </option>
          ))}
        </Select>
      </div>

      {hasFilters && (
        <button
          type="button"
          onClick={() => {
            setQuery("");
            startTransition(() => router.replace(pathname, { scroll: false }));
          }}
          className="touch-hitbox inline-flex items-center gap-1 self-start rounded-sm text-sm font-semibold text-foreground-secondary hover:text-foreground"
        >
          <X size={14} aria-hidden="true" />
          {COPY.list.clearFilters}
        </button>
      )}
    </div>
  );
}
