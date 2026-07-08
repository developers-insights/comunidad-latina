import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const chipVariants = cva(
  "inline-flex items-center gap-1.5 rounded-sm font-medium",
  {
    variants: {
      variant: {
        neutral:
          "border border-border-subtle bg-surface-subtle text-foreground-secondary",
        brand: "border border-brand-subtle bg-brand-tint text-brand-ink",
        // El borde usa el FILL del estado (decoración); la etiqueta usa el `-ink`,
        // que es el único tono AA como texto sobre el `-bg` del mismo estado.
        success: "border border-success/20 bg-success-bg text-success-ink",
        warning: "border border-warning/20 bg-warning-bg text-warning-ink",
        danger: "border border-danger/20 bg-danger-bg text-danger",
        info: "border border-info/20 bg-info-bg text-info",
      },
      size: {
        sm: "h-6 px-2 text-xs",
        md: "h-8 px-3 text-sm",
      },
    },
    defaultVariants: {
      variant: "neutral",
      size: "md",
    },
  },
);

export interface ChipProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof chipVariants> {
  /** Ícono Phosphor inline (16px), antes del texto. */
  icon?: React.ReactNode;
}

export function Chip({
  className,
  variant,
  size,
  icon,
  children,
  ...props
}: ChipProps) {
  return (
    <span className={cn(chipVariants({ variant, size }), className)} {...props}>
      {icon && (
        <span aria-hidden="true" className="shrink-0 [&>svg]:size-4">
          {icon}
        </span>
      )}
      {children}
    </span>
  );
}
