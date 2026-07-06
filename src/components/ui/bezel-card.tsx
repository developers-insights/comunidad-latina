import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Patrón Double-Bezel (§2.5) — OBLIGATORIO en toda tarjeta de confianza alta:
 * listings verificados, Trust Score, negocios, pago/escrow.
 * Shell exterior (marco, radius-xl 28px, padding 6px) + core interior
 * concéntrico (radius 22px). El shell tinta según la variante; el contenido
 * SIEMPRE vive sobre superficie neutra.
 */
const bezelShellVariants = cva("rounded-xl p-1.5 shadow-bezel", {
  variants: {
    variant: {
      default: "bg-bezel-shell",
      /** Destacada: tinte suave del color de marca del tenant. */
      featured: "bg-brand-50",
      warning: "bg-warning-bg",
      danger: "bg-danger-bg",
      success: "bg-success-bg",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

export interface BezelCardProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof bezelShellVariants> {
  /** Clases extra para el core interior (padding default: p-6). */
  coreClassName?: string;
}

export function BezelCard({
  className,
  coreClassName,
  variant,
  children,
  ...props
}: BezelCardProps) {
  return (
    <div className={cn(bezelShellVariants({ variant }), className)} {...props}>
      <div
        className={cn(
          "rounded-[calc(var(--radius-xl)-6px)] bg-surface p-6",
          "shadow-[inset_0_1px_0_var(--cl-bezel-highlight)]",
          coreClassName,
        )}
      >
        {children}
      </div>
    </div>
  );
}
