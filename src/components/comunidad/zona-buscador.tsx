"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { MagnifyingGlass, X } from "@phosphor-icons/react/dist/ssr";
import { Input } from "@/components/ui";
import { COMUNIDAD_COPY } from "@/lib/comunidad";
import { cn } from "@/lib/utils";

const C = COMUNIDAD_COPY.perdidos.filters;

/**
 * Buscador por ZONA de Perdido y encontrado.
 *
 * Es el mismo patrón que `<ModuleSearchBar>` —estado canónico en la URL, el
 * Server Component vuelve a consultar, `replace` y no `push` para que el botón
 * atrás salga del listado en vez de recorrer letra por letra— con dos
 * diferencias que justifican el archivo propio en vez de un `param` más en
 * aquel componente:
 *
 *  1. ESCRIBE `?zona=`, NO `?q=`. Acá la zona no es "una búsqueda más": es EL
 *    filtro de la sección («lo busca por área donde él crea que perdió algo»).
 *    Compartirle el parámetro a la búsqueda de texto haría que el día que se
 *    agregue búsqueda por descripción, una pise a la otra.
 *  2. Su rótulo y su ayuda salen del copy de Comunidad, no de las claves de
 *    `t("sections", …)`.
 *
 * No busca mientras se escribe, por el mismo motivo que el resto de los
 * listados: recargar la lista entera en cada tecla es un parpadeo bajo el dedo.
 * Se busca al enviar — con Enter o tocando la lupa, que es un botón de verdad.
 */
export function ZonaBuscador({ className }: { className?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [zona, setZona] = useState(searchParams.get("zona") ?? "");

  function apply(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    const limpio = next.trim().slice(0, 80);
    if (limpio) params.set("zona", limpio);
    else params.delete("zona");
    // Criterio nuevo ⇒ primera página.
    params.delete("cursor");
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
        apply(zona);
      }}
      className={cn(isPending && "opacity-70", className)}
    >
      <label htmlFor="comunidad-zona" className="mb-1.5 block text-sm font-medium text-foreground">
        {C.areaLabel}
      </label>

      <div className="relative">
        <button
          type="submit"
          aria-label={C.apply}
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
          id="comunidad-zona"
          type="search"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          placeholder={C.areaPlaceholder}
          aria-describedby="comunidad-zona-help"
          value={zona}
          onChange={(event) => setZona(event.target.value)}
          maxLength={80}
          // El botón propio de borrar reemplaza al nativo del input search
          // (WebKit dibuja el suyo y quedarían dos "x" encimadas).
          className="pl-11 pr-11 [&::-webkit-search-cancel-button]:hidden"
        />

        {zona && (
          <button
            type="button"
            aria-label={C.clear}
            onClick={() => {
              setZona("");
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
      </div>

      <p id="comunidad-zona-help" className="mt-1.5 text-sm text-foreground-muted">
        {C.areaHelp}
      </p>
    </form>
  );
}
