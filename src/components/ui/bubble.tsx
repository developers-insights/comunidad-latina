import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Burbuja / cápsula: la primitiva del lenguaje visual que pidió el cliente
 * (call 2026-07-27, «cómo están, como en su cápsula, en su pastilla… si tiene
 * como un botoncito, quiere decir que es como un botón de darle clic»).
 *
 * La regla, escrita una sola vez para que no se reinvente por pantalla:
 *
 *  1. RELLENO PROPIO. Nada accionable vive suelto sobre la plancha de la
 *     página. Neutra = `bg-surface` (que en dark es MÁS clara que el canvas:
 *     la cápsula se lee elevada en los dos temas, ver globals.css). Con acento
 *     = el acento del módulo mezclado sobre `surface`, no sobre `transparent`
 *     — mezclar contra transparente da un tinte que se hunde en dark.
 *  2. HAIRLINE. 1px que existe en los dos temas (`border-border-subtle` o el
 *     acento al 30%), nunca un gris fijo que desaparece.
 *  3. LUZ SUPERIOR. El mismo `inset 0 1px 0` del BezelCard: es lo que le da el
 *     volumen de pastilla en vez de rectángulo pintado.
 *  4. TACTO. `interactive` agrega hover, anillo de foco y el hundido al
 *     presionar — la señal de "esto se toca" para un usuario mayor.
 *
 * Es hermana del BezelCard, no su reemplazo: el bezel es para tarjetas de
 * confianza alta (doble marco, sombra); la burbuja es para elementos de
 * navegación y acción (cabeceras, CTA, tiles de categoría, bandejas).
 *
 * Server-safe: sin estado ni handlers propios. Como `buttonVariants`, se puede
 * usar de dos formas — el componente, o `bubbleVariants()` sobre un <Link> /
 * <button> real (siempre con `bubbleStyle(accent)` si lleva acento).
 */
const bubbleVariants = cva(
  [
    "relative border shadow-[inset_0_1px_0_var(--cl-bezel-highlight)]",
    "transition-[background-color,border-color,transform,box-shadow]",
    "duration-(--duration-fast) ease-(--ease-spring)",
  ],
  {
    variants: {
      /**
       * Tres intensidades del mismo acento, y la diferencia significa algo:
       *   soft   → superficie que INFORMA (cabecera, tile de categoría)
       *   accent → superficie que ACOMPAÑA
       *   strong → superficie que se TOCA (el CTA, el ítem activo)
       * Sin esa escala, una cabecera y su botón quedan del mismo color y el
       * bloque entero se lee como una sola mancha.
       */
      tone: {
        /** Cápsula neutra: superficie elevada + hairline. */
        neutral: "border-border-subtle bg-surface",
        accentSoft:
          "border-[var(--bubble-line-soft,var(--color-border-subtle))] bg-[var(--bubble-fill-soft,var(--color-surface))]",
        /**
         * Cápsula del módulo. El color entra por `bubbleStyle(accent)`; los
         * fallbacks dejan que el componente nunca quede sin fondo si alguien
         * olvida el style.
         */
        accent:
          "border-[var(--bubble-line,var(--color-border-subtle))] bg-[var(--bubble-fill,var(--color-surface))]",
        accentStrong:
          "border-[var(--bubble-line-strong,var(--color-border))] bg-[var(--bubble-fill-strong,var(--color-surface))]",
        /** Cápsula de marca (tricolor del logo) para acciones de plataforma. */
        brand: "border-brand-subtle bg-brand-tint",
        /** Bandeja: agrupa controles que ya traen su propio fondo (filtros). */
        tray: "border-border-subtle bg-surface-subtle shadow-none",
      },
      shape: {
        /** Una línea: píldora completa. */
        pill: "rounded-full",
        /** Bloque de dos líneas o más: squircle grande, concéntrico al bezel. */
        tile: "rounded-xl",
      },
      size: {
        sm: "min-h-9 px-3",
        md: "min-h-11 px-4",
        lg: "min-h-14 px-4",
        /** Sin alto ni padding: lo pone el call site (tiles, bandejas). */
        none: "",
      },
      interactive: {
        /**
         * Capa de estado al estilo Material en vez de `dark:hover:*`: un velo
         * de `foreground` OSCURECE en light y ACLARA en dark con una sola
         * regla, y el token ya voltea solo. `dark:` acá sería un bug — la
         * variante de Tailwind mira `prefers-color-scheme` y esta app también
         * permite forzar el tema por clase (globals.css), así que las dos
         * señales se contradicen cuando el usuario elige lo contrario del SO.
         */
        true: [
          "cursor-pointer active:scale-[0.98]",
          "after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit]",
          "after:bg-foreground after:opacity-0 after:transition-opacity after:duration-(--duration-fast)",
          "hover:after:opacity-[0.045]",
          "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
        ],
        false: "",
      },
    },
    defaultVariants: {
      tone: "neutral",
      shape: "pill",
      size: "md",
      interactive: false,
    },
  },
);

/**
 * Variables de la cápsula con acento. `accent` SIEMPRE es una custom property
 * del tema (`var(--accent-eventos)`), nunca un color crudo — mismo contrato
 * que AccentLink y que `accentPalette()` de shell/modules.ts.
 *
 * El relleno se mezcla contra `--color-surface` (no contra transparent) para
 * que la cápsula quede por encima del canvas en light Y en dark. Al 12% el
 * texto `text-foreground` conserva >12:1 contra el resultado en ambos temas,
 * así que la etiqueta nunca depende del acento para ser legible.
 */
export function bubbleStyle(accent?: string): React.CSSProperties | undefined {
  if (!accent) return undefined;
  return {
    "--bubble-fill-soft": `color-mix(in oklab, ${accent} 7%, var(--color-surface))`,
    "--bubble-line-soft": `color-mix(in oklab, ${accent} 22%, transparent)`,
    "--bubble-fill": `color-mix(in oklab, ${accent} 12%, var(--color-surface))`,
    "--bubble-line": `color-mix(in oklab, ${accent} 30%, transparent)`,
    "--bubble-fill-strong": `color-mix(in oklab, ${accent} 18%, var(--color-surface))`,
    "--bubble-line-strong": `color-mix(in oklab, ${accent} 52%, transparent)`,
    /** Fondo del chip del ícono dentro de la cápsula. */
    "--bubble-wash": `color-mix(in oklab, ${accent} 26%, var(--color-surface))`,
    "--bubble-ink": accent,
  } as React.CSSProperties;
}

export interface BubbleProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof bubbleVariants> {
  /** Acento del módulo (`var(--accent-negocios)`). Requiere `tone="accent"`. */
  accent?: string;
}

export function Bubble({
  className,
  tone,
  shape,
  size,
  interactive,
  accent,
  style,
  children,
  ...props
}: BubbleProps) {
  return (
    <div
      className={cn(bubbleVariants({ tone, shape, size, interactive }), className)}
      style={{ ...bubbleStyle(accent), ...style }}
      {...props}
    >
      {children}
    </div>
  );
}

export { bubbleVariants };
