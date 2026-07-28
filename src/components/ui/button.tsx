import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { Spinner } from "./spinner";

const buttonVariants = cva(
  [
    // feedback spring <100ms (§5.1): scale al presionar, nunca en disabled
    "inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap font-semibold",
    "transition-[transform,background-color,border-color,color,opacity] duration-(--duration-fast) ease-(--ease-spring)",
    "active:scale-[0.97]",
    // `<a>` trae el puntero del navegador gratis; un `<button>` no — sin esto
    // ~40 call sites de este primitivo (el que se usa como botón real) se
    // sienten "al revés" al pasar el mouse, como el que reportó el cliente en
    // la encuesta del feed (bug local aparte, mismo origen).
    "cursor-pointer disabled:cursor-not-allowed",
    "disabled:pointer-events-none disabled:opacity-45",
    "aria-busy:pointer-events-none",
    // Anillo de foco PROPIO, y no el global de globals.css. El global vive en
    // `:where(a, button, …):focus-visible { box-shadow: var(--shadow-focus-ring) }`,
    // y `shadow-xs` —que llevan `primary` y `danger`— es una utility que escribe
    // `box-shadow`: le gana y deja esos dos variants SIN indicador de foco, en
    // ~40 call sites incluidos los <Link> con pinta de botón (2.4.7).
    // `ring-*` compone en `--tw-ring-shadow`, así que convive con `shadow-xs`
    // en vez de pelearle.
    "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
    // No es una utility de Tailwind: es el hook de @media print de globals.css,
    // hermano de `.skeleton`. El bloque de impresión ya esconde `button`, pero
    // `buttonVariants` se usa muchísimo sobre <Link> (~40 call sites), y un <a>
    // no matchea ese selector. El variant `primary` es `bg-brand
    // text-brand-foreground`: sin el fondo —que el navegador no imprime— el
    // label salía blanco sobre papel blanco, 1.00:1. Ese era el CTA final de
    // /guias/[slug], la página que la gente imprime y lleva a un trámite.
    // Un control impreso no lleva a ninguna parte: se va con el resto del chrome.
    "cl-print-hide",
  ],
  {
    variants: {
      variant: {
        // CTA primario: color de marca, pill (radius-full §2.4), 1 por pantalla.
        // brand-hover, no brand-700: en dark el 700 oscurecía el botón HACIA el
        // canvas (hover invertido); el pipeline elige la dirección correcta.
        primary:
          "rounded-full bg-brand text-brand-foreground shadow-xs hover:bg-brand-hover",
        secondary:
          "rounded-md bg-surface-subtle text-foreground hover:bg-surface-hover",
        outline:
          "rounded-md border border-border bg-transparent text-foreground hover:bg-surface-subtle",
        ghost:
          "rounded-md bg-transparent text-foreground-secondary hover:bg-surface-subtle hover:text-foreground",
        // text-on-danger, nunca blanco literal: sobre el danger de dark
        // (#e26a6a) el blanco da 3.23:1 — falla AA. El token elige por tema.
        danger:
          "rounded-md bg-danger text-on-danger shadow-xs hover:bg-danger/90",
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
