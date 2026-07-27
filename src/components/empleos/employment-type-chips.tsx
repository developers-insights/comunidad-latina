"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { EMPLOYMENT_TYPES, EMPLOYMENT_TYPE_LABEL } from "./helpers";
import { COPY } from "./copy";

/** Selected: tinte suave del acento del módulo (--accent-empleos, decorativo). */
const SELECTED_STYLE: React.CSSProperties = {
  borderColor: "color-mix(in oklab, var(--accent-empleos) 55%, transparent)",
  backgroundColor: "color-mix(in oklab, var(--accent-empleos) 14%, transparent)",
};

/**
 * Chips de jornada de /empleos — mismo patrón que marketplace/category-chips:
 * el estado canónico vive en la URL (?tipo=), así el filtro es compartible,
 * sobrevive al back del navegador y lo resuelve el server (fetchJobsPage), no
 * un useState. Cambiar de chip resetea el cursor: criterio nuevo, primera página.
 */
export function EmploymentTypeChips({ className }: { className?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const active = searchParams.get("tipo") ?? "";

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
    ...EMPLOYMENT_TYPES.map((type) => ({ value: type, label: EMPLOYMENT_TYPE_LABEL[type] })),
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
