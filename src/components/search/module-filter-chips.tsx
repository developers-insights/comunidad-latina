"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

export interface FilterOption {
  /** Valor en la URL. Cadena vacía = "sin filtro" (se borra el parámetro). */
  value: string;
  label: string;
}

/**
 * Grupo de chips que escribe UN parámetro de la URL.
 *
 * Generaliza el patrón de `directory/category-chips.tsx` (rubros de
 * Profesionales) para que Eventos y Negocios no tengan cada uno su copia del
 * mismo `router.replace`. Reglas heredadas y respetadas:
 *   · el estado canónico es la URL, no el estado del componente — así el filtro
 *     se comparte por link, sobrevive al botón atrás y lo lee el Server
 *     Component sin sincronizar nada;
 *   · cada cambio borra el cursor de paginación (criterio nuevo ⇒ primera
 *     página);
 *   · scroll horizontal en móvil y targets de 44px, porque estos chips se tocan
 *     con el pulgar.
 *
 * `aria-pressed` y no `aria-selected`: son botones de alternar, no las opciones
 * de un listbox — no hay `role="listbox"` que los contenga, y `aria-selected`
 * fuera de ese contexto no lo anuncia ningún lector.
 */
export function ModuleFilterChips({
  param,
  label,
  options,
  className,
}: {
  param: string;
  /** Rótulo del grupo para lectores de pantalla ("Cuándo", "Rubro"). */
  label: string;
  options: readonly FilterOption[];
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const active = searchParams.get(param) ?? "";

  function apply(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(param, value);
    else params.delete(param);
    params.delete("cursor");
    const qs = params.toString();
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    });
  }

  return (
    <div
      role="group"
      aria-label={label}
      aria-busy={isPending}
      className={cn(
        "-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]",
        isPending && "opacity-70",
        className,
      )}
    >
      {options.map((option) => {
        const selected = active === option.value;
        return (
          <button
            key={option.value || "todos"}
            type="button"
            aria-pressed={selected}
            onClick={() => apply(option.value)}
            className={cn(
              "min-h-11 shrink-0 whitespace-nowrap rounded-full border px-4 text-sm font-semibold",
              "transition-[background-color,border-color,color,transform] duration-(--duration-fast) ease-(--ease-spring)",
              "active:scale-[0.96] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
              selected
                ? "border-brand bg-brand-tint text-brand-ink"
                : "border-border bg-surface text-foreground-secondary hover:border-border-strong",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
