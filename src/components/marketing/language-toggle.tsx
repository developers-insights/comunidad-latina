"use client";

import { useToast } from "@/components/ui";
import { cn } from "@/lib/utils";
import { COPY } from "./copy";

/**
 * Selector ES/EN visual del footer. ES es el idioma activo; EN todavía no
 * existe → al tocarlo, un toast cálido avisa que está en camino (§5.6:
 * nunca un botón que rompe, siempre un estado premium).
 */
export function LanguageToggle() {
  const { toast } = useToast();

  const baseClass =
    "inline-flex h-9 min-w-11 items-center justify-center rounded-full px-3 text-sm font-semibold transition-colors duration-(--duration-fast)";

  return (
    <div
      role="group"
      aria-label={COPY.language.label}
      className="inline-flex items-center gap-1 rounded-full border border-border bg-surface p-1"
    >
      <button type="button" aria-pressed="true" className={cn(baseClass, "bg-brand text-brand-foreground")}>
        ES
      </button>
      <button
        type="button"
        aria-pressed="false"
        onClick={() =>
          toast({
            title: COPY.language.enSoonTitle,
            description: COPY.language.enSoonBody,
            variant: "info",
          })
        }
        className={cn(baseClass, "gap-1.5 text-foreground-muted hover:bg-surface-subtle")}
      >
        EN
        <span className="rounded-full bg-surface-subtle px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-foreground-muted">
          {COPY.footer.soon}
        </span>
      </button>
    </div>
  );
}
