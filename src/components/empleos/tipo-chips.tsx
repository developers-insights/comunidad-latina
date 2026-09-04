"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { EMPLEOS_TABS, EMPLEOS_TAB_LABEL, toEmpleosTab } from "./helpers";
import { COPY } from "./copy";

/** Selected: tinte suave del acento del módulo (--accent-empleos, decorativo). */
const SELECTED_STYLE: React.CSSProperties = {
  borderColor: "color-mix(in oklab, var(--accent-empleos) 55%, transparent)",
  backgroundColor: "color-mix(in oklab, var(--accent-empleos) 14%, transparent)",
};

/**
 * PESTAÑAS de /empleos: Todos · Empleos · Ocasional · Servicios.
 *
 * Reemplaza a los chips de JORNADA (`employment-type-chips`, borrado en esta
 * misma tanda). El cambio no es de etiquetas: antes las tres opciones eran tres
 * jornadas del mismo objeto, y ahora las últimas tres nombran QUÉ ES el aviso
 * — un empleo, una changa de uno o dos días, o un servicio que alguien ofrece
 * (feedback cliente 2026-09-03, punto 12). La jornada no se pierde: sigue en la
 * etiqueta de la tarjeta de empleo.
 *
 * Mismo patrón que marketplace/category-chips y que los chips que reemplaza: el
 * estado canónico vive en la URL (?tipo=), así el filtro es compartible,
 * sobrevive al back del navegador y lo resuelve el server (fetchJobsPage), no un
 * useState. Cambiar de pestaña resetea el cursor: criterio nuevo, primera página.
 *
 * Sigue siendo un grupo de botones `aria-pressed` y NO un `role="tablist"`: no
 * hay paneles que mostrar y ocultar en el cliente — cada pestaña es una consulta
 * distinta al servidor. Fingir la semántica de tabs le prometería a un lector de
 * pantalla flechas de navegación que acá no existen.
 */
export function EmpleosTipoChips({ className }: { className?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  // Se NORMALIZA el crudo de la URL con la misma tabla que usa el servidor: un
  // link viejo (`?tipo=part_time`) filtra por Empleos, así que la pestaña
  // Empleos también tiene que verse marcada. Comparar contra el crudo dejaba la
  // lista filtrada y las cuatro pestañas apagadas.
  const active = toEmpleosTab(searchParams.get("tipo") ?? "");

  function apply(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set("tipo", value);
    else params.delete("tipo");
    params.delete("cursor");
    const qs = params.toString();
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    });
  }

  const options = [
    { value: "", label: COPY.list.filterAll },
    ...EMPLEOS_TABS.map((tab) => ({ value: tab, label: EMPLEOS_TAB_LABEL[tab] })),
  ];

  return (
    <div
      role="group"
      aria-label={COPY.list.filterLabel}
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
            style={selected ? SELECTED_STYLE : undefined}
            className={cn(
              "min-h-11 shrink-0 whitespace-nowrap rounded-full border px-4 text-sm font-semibold",
              "transition-[background-color,border-color,color,transform] duration-(--duration-fast) ease-(--ease-spring)",
              "active:scale-[0.96] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
              selected
                ? "text-foreground"
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
