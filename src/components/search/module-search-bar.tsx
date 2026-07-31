"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { MagnifyingGlass, X } from "@phosphor-icons/react/dist/ssr";
import { Input } from "@/components/ui";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { sanitizeSearchQuery } from "./helpers";

export interface ModuleSearchBarProps {
  /** Rótulo accesible del campo ("Buscar eventos"). */
  label: string;
  placeholder: string;
  /**
   * Parámetros de la URL que se resetean con cada búsqueda nueva. Siempre el
   * cursor de paginación; el resto lo decide cada listado.
   */
  resetParams?: readonly string[];
  className?: string;
}

/**
 * Buscador de un LISTADO (Eventos, Negocios, Colaboraciones).
 *
 * Es el patrón que ya existe en /marketplace y /propiedades, extraído para no
 * tener una tercera y una cuarta copia: estado canónico en la URL (`?q=`), el
 * Server Component vuelve a consultar, y el cursor de paginación se resetea en
 * cada búsqueda nueva. `router.replace` y no `push` para que el botón atrás
 * salga del listado en vez de recorrer una a una las letras que se escribieron.
 *
 * A propósito NO toca los otros filtros: se busca DENTRO de lo que ya está
 * filtrado, que es como se comporta el resto de la app.
 *
 * Diferencia deliberada con la barra global de /buscar: acá NO hay búsqueda
 * mientras se escribe. Un listado recarga datos del servidor y remonta la
 * lista entera; hacerlo en cada tecla sería un parpadeo constante bajo el
 * dedo. Acá se busca al enviar — con Enter o tocando la lupa, que es un botón
 * de verdad y no un adorno.
 */
export function ModuleSearchBar({
  label,
  placeholder,
  resetParams = [],
  className,
}: ModuleSearchBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [query, setQuery] = useState(searchParams.get("q") ?? "");

  function apply(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (next) params.set("q", next);
    else params.delete("q");
    params.delete("cursor");
    for (const key of resetParams) params.delete(key);
    const qs = params.toString();
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    });
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
        aria-label={t("sections", "moduleSearchSubmit")}
        className={cn(
          "absolute left-1 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-full",
          "text-foreground-muted transition-colors duration-(--duration-fast) ease-(--ease-out-premium)",
          "hover:text-brand-ink",
          "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
        )}
      >
        <MagnifyingGlass size={18} aria-hidden="true" />
      </button>

      <Input
        type="search"
        inputMode="search"
        enterKeyHint="search"
        aria-label={label}
        placeholder={placeholder}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        // El botón propio de borrar reemplaza al nativo del input type="search"
        // (WebKit dibuja el suyo y quedarían dos "x" encimadas).
        className="pl-11 pr-11 [&::-webkit-search-cancel-button]:hidden"
      />

      {query && (
        <button
          type="button"
          aria-label={t("sections", "moduleSearchClear")}
          onClick={() => {
            setQuery("");
            apply("");
          }}
          className={cn(
            "absolute right-1 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-full",
            "text-foreground-muted transition-colors duration-(--duration-fast) ease-(--ease-out-premium)",
            "hover:text-foreground",
            "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
          )}
        >
          <X size={16} aria-hidden="true" />
        </button>
      )}
    </form>
  );
}
