import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { Spinner } from "./spinner";

const buttonVariants = cva(
  [
    // feedback spring <100ms (§5.1): scale al presionar, nunca en disabled
    "inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap font-semibold",
    "transition-[transform,background-color,border-color,color,opacity] duration-(--duration-fast) ease-(--ease-spring)",
    "active:scale-[0.97]",
    "disabled:pointer-events-none disabled:opacity-45",
    "aria-busy:pointer-events-none",
  ],
  {
    variants: {
      variant: {
        // CTA primario: color de marca, pill (radius-full §2.4), 1 por pantalla
        primary:
          "rounded-full bg-brand text-brand-foreground shadow-xs hover:bg-brand-700",
        secondary:
          "rounded-md bg-surface-subtle text-foreground hover:bg-neutral-100 dark:hover:bg-neutral-700/60",
        outline:
          "rounded-md border border-border bg-transparent text-foreground hover:bg-surface-subtle",
        ghost:
          "rounded-md bg-transparent text-foreground-secondary hover:bg-surface-subtle hover:text-foreground",
        danger:
          "rounded-md bg-danger text-white shadow-xs hover:bg-danger/90",
      },
      size: {
        sm: "h-10 px-4 text-sm",
        md: "h-11 px-5 text-sm",
        lg: "h-13 px-7 text-base",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /** Muestra spinner fino y deshabilita el botón sin cambiar su ancho. */
  loading?: boolean;
}

export function Button({
  className,
  variant,
  size,
  loading = false,
  disabled,
  type = "button",
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && <Spinner className="shrink-0" size={16} />}
      {children}
    </button>
  );
}

export { buttonVariants };
