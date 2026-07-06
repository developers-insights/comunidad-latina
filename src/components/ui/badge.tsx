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
        brand: "bg-brand-50 text-brand-700",
        success: "bg-success-bg text-success",
        warning: "bg-warning-bg text-warning",
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
