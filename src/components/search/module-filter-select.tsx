"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Select } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { FilterOption } from "./module-filter-chips";

/**
 * Filtro de listado con forma de `<select>`, para cuando las opciones son
 * MUCHAS o de largo variable — ciudades, rubros.
 *
 * Por qué no chips acá: una fila de chips con veinte ciudades es un carrusel
 * horizontal donde encontrar la propia obliga a barrer con el dedo a ciegas.
 * El `<select>` nativo, además, trae gratis la rueda de iOS, el buscador por
 * teclado de Android y el soporte de lector de pantalla — tres cosas que una
 * lista custom tendría que reimplementar peor.
 *
 * Mismo contrato que `ModuleFilterChips`: el estado canónico vive en la URL y
 * cada cambio resetea el cursor de paginación.
 */
export function ModuleFilterSelect({
  param,
  label,
  options,
  className,
}: {
  param: string;
  /** Rótulo accesible. No se dibuja: la opción "todos" ya nombra el filtro. */
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
    <Select
      aria-label={label}
      aria-busy={isPending}
      value={active}
      onChange={(event) => apply(event.target.value)}
      className={cn(isPending && "opacity-70", className)}
    >
      {options.map((option) => (
        <option key={option.value || "todos"} value={option.value}>
          {option.label}
        </option>
      ))}
    </Select>
  );
}

/**
 * Filtro de SÍ/NO ("Verificados"): una sola píldora que se prende y se apaga.
 *
 * Dos chips ("Todos" / "Verificados") dirían lo mismo ocupando el doble y
 * obligando a leer cuál está activo. Con una píldora, `aria-pressed` dice el
 * estado y el color lo confirma — y el estado apagado no necesita nombre.
 */
export function ModuleFilterToggle({
  param,
  label,
  /** Valor que se escribe en la URL cuando está prendido. */
  value = "1",
  icon,
  className,
}: {
  param: string;
  label: string;
  value?: string;
  icon?: React.ReactNode;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const on = searchParams.get(param) === value;

  function toggle() {
    const params = new URLSearchParams(searchParams.toString());
    if (on) params.delete(param);
    else params.set(param, value);
    params.delete("cursor");
    const qs = params.toString();
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    });
  }

  return (
    <button
      type="button"
      aria-pressed={on}
      aria-busy={isPending}
      onClick={toggle}
      className={cn(
        "flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-4 text-sm font-semibold",
        "transition-[background-color,border-color,color,transform] duration-(--duration-fast) ease-(--ease-spring)",
        "active:scale-[0.96] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
        on
          ? "border-brand bg-brand-tint text-brand-ink"
          : "border-border bg-surface text-foreground-secondary hover:border-border-strong",
        isPending && "opacity-70",
        className,
      )}
    >
      {icon && (
        <span aria-hidden="true" className="shrink-0 [&>svg]:size-4">
          {icon}
        </span>
      )}
      {label}
    </button>
  );
}
