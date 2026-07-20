"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { COPY } from "./copy";
import { PRODUCT_CATEGORIES } from "./helpers";

/** Selected: tinte suave del acento del módulo (--accent-marketplace, decorativo). */
const SELECTED_STYLE: React.CSSProperties = {
  borderColor: "color-mix(in oklab, var(--accent-marketplace) 55%, transparent)",
  backgroundColor: "color-mix(in oklab, var(--accent-marketplace) 14%, transparent)",
};

/**
 * Chips de categoría de /marketplace — patrón de directory/category-chips.tsx
 * (estado canónico en la URL, ?categoria=) pero local al módulo: set curado
 * en helpers.ts (PRODUCT_CATEGORIES), NO importado de directory.
 */
export function CategoryChips({ className }: { className?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const active = searchParams.get("categoria") ?? "";

  function apply(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set("categoria", value);
    else params.delete("categoria");
    params.delete("cursor"); // nuevo criterio → primera página
    const qs = params.toString();
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    });
  }

  const options = [{ value: "", label: COPY.list.categoryAll }, ...PRODUCT_CATEGORIES];

  return (
    <div
      role="group"
      aria-label={COPY.list.categoryFilterLabel}
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
            key={option.value || "todas"}
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
