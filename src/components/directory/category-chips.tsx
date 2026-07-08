"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { COPY } from "./copy";
import { PROFESSIONAL_CATEGORIES } from "./helpers";

/**
 * Chips de rubro de /profesionales. Estado canónico en la URL (?rubro=) →
 * el Server Component re-consulta; el cursor de paginación se resetea en
 * cada cambio. Scroll horizontal, targets ≥44px.
 */
export function CategoryChips({ className }: { className?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const active = searchParams.get("rubro") ?? "";

  function apply(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set("rubro", value);
    else params.delete("rubro");
    params.delete("cursor"); // nuevo criterio → primera página
    const qs = params.toString();
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    });
  }

  const options = [{ value: "", label: COPY.professionals.allCategories }, ...PROFESSIONAL_CATEGORIES];

  return (
    <div
      role="group"
      aria-label={COPY.professionals.categoryFilterLabel}
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
