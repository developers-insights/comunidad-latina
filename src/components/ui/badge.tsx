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
        // Es TEXTO de 12px sobre el `-bg` de su propio estado: siempre el `-ink`.
        // En light danger/info aliasean el fill; en dark el rojo diverge. El call
        // site no tiene que saberlo: escribís texto → `-ink`.
        success: "bg-success-bg text-success-ink",
        warning: "bg-warning-bg text-warning-ink",
        danger: "bg-danger-bg text-danger-ink",
        info: "bg-info-bg text-info-ink",
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
