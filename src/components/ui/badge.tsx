import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/** Estado compacto (verificado, nuevo, pendiente…). Siempre ícono+texto
 *  cuando comunica riesgo — nunca solo color (§3.2). */
const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold",
  {
    variants: {
      variant: {
        neutral: "bg-surface-subtle text-foreground-secondary",
        brand: "bg-brand-tint text-brand-ink",
        // Es TEXTO de 12px sobre el `-bg` de su propio estado: ahí el fill de
        // §2.3 no llega a AA (success 4.43:1, warning 3.28:1) y va el `-ink`.
        // danger (4.53:1) e info (4.76:1) sí pasan y usan el fill.
        success: "bg-success-bg text-success-ink",
        warning: "bg-warning-bg text-warning-ink",
        danger: "bg-danger-bg text-danger",
        info: "bg-info-bg text-info",
      },
    },
    defaultVariants: {
      variant: "neutral",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props}>
      {children}
    </span>
  );
}
