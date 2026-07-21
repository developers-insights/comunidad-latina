"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { MagnifyingGlass, X } from "@phosphor-icons/react/dist/ssr";
import { Input } from "@/components/ui";
import { cn } from "@/lib/utils";
import { COPY } from "./copy";
import { sanitizeSearchQuery } from "./helpers";

const C = COPY.list;

/**
 * Buscador de /marketplace — mismo patrón que ListingFilters
 * (components/listings/listing-filters.tsx, propiedad de otro módulo: NO se
 * edita, solo se replica el patrón acá): estado canónico en la URL (?q=),
 * reseteando SOLO el cursor de paginación en cada búsqueda nueva. A propósito
 * NO tocamos ?categoria= — se busca DENTRO de la categoría activa, mismo
 * criterio que CategoryChips.apply() ya respeta a la inversa (nunca borra
 * ?q= al cambiar de categoría, porque copia todos los params existentes).
 *
 * Diferencia con ListingFilters: ahí la lupa es puramente decorativa (el
 * único submit es Enter). Acá el cliente pidió poder buscar tocando la
 * lupa también, así que es un <button type="submit"> real.
 */
export function MarketplaceSearchBar({ className }: { className?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [query, setQuery] = useState(searchParams.get("q") ?? "");

  function apply(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (next) params.set("q", next);
    else params.delete("q");
    params.delete("cursor"); // nueva búsqueda → primera página
    const qs = params.toString();
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    });
  }

  function clear() {
    setQuery("");
    apply("");
  }

  return (
    <form
      role="search"
      aria-busy={isPending}
      onSubmit={(event) => {
        event.preventDefault();
        apply(sanitizeSearchQuery(query));
      }}
      className={cn("relative", isPending && "opacity-70", className)}
    >
      <button
        type="submit"
        aria-label={C.searchSubmitLabel}
        className={cn(
          "absolute left-1 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-full",
          "text-foreground-muted transition-colors duration-(--duration-fast) hover:text-brand-ink",
          "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
        )}
      >
        <MagnifyingGlass size={18} aria-hidden="true" />
      </button>

      <Input
        type="search"
        inputMode="search"
        enterKeyHint="search"
        aria-label={C.searchLabel}
        placeholder={C.searchPlaceholder}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        // El botón de borrar propio reemplaza al nativo del input type="search"
        // (WebKit dibuja su propia "x" al tener texto) — sin ocultarlo quedan
        // dos "x" superpuestas en Chrome/Safari.
        className="pl-11 pr-11 [&::-webkit-search-cancel-button]:hidden"
      />

      {query && (
        <button
          type="button"
          aria-label={C.searchClearLabel}
          onClick={clear}
          className={cn(
            "absolute right-1 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-full",
            "text-foreground-muted transition-colors duration-(--duration-fast) hover:text-foreground",
            "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
          )}
        >
          <X size={16} aria-hidden="true" />
        </button>
      )}
    </form>
  );
}
