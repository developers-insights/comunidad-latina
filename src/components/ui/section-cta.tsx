import Link from "next/link";
import { ArrowRight, Plus } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";
import { bubbleStyle, bubbleVariants } from "./bubble";

export interface SectionCtaProps {
  /** Acento del módulo (`var(--accent-negocios)`), nunca un color crudo. */
  accent: string;
  /** Flujo de publicar de ESTA sección, ya preseleccionado (`?kind=`). */
  href: string;
  /** La acción, en voseo y con el verbo primero: "Publicá tu negocio". */
  title: string;
  /** Por qué conviene, en una línea. */
  hint: string;
  className?: string;
}

/**
 * Burbuja "Publicá tu…" que encabeza cada listado (pedido textual del cliente,
 * call 2026-07-27: «cuando abre negocios ven toda la lista, pero en la parte de
 * arriba debe salir una burbuja que diga publicá tu negocio… eso no tiene que
 * irse a settings a buscar dónde dice publicar negocios»).
 *
 * Un componente, siete destinos: el copy y el `href` los pone cada sección, la
 * forma es siempre la misma para que se aprenda una sola vez.
 *
 * Anatomía (de izquierda a derecha): chip del ícono con el lavado del acento ·
 * acción + motivo · flecha dentro de su propio círculo. La flecha nunca va
 * desnuda: el círculo es lo que la convierte en un control visible y le da el
 * empujón al pasar por encima.
 *
 * Contraste: el acento vive en el relleno, el borde y el chip — jamás en el
 * texto. El amarillo de Negocios no llega a AA como tinta, así que la etiqueta
 * usa `text-foreground` sobre el tinte al 12% (>12:1 en los dos temas). Mismo
 * criterio que AccentLink y EntityKindChip.
 */
export function SectionCta({ accent, href, title, hint, className }: SectionCtaProps) {
  return (
    <Link
      href={href}
      style={bubbleStyle(accent)}
      className={cn(
        // `strong`: es LA acción de la sección. Un escalón por encima de la
        // cabecera para que se lea como botón y no como otro cartel.
        bubbleVariants({ tone: "accentStrong", shape: "tile", size: "none", interactive: true }),
        "group flex min-h-16 items-center gap-3 p-3",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="flex size-11 shrink-0 items-center justify-center rounded-md bg-[var(--bubble-wash)] text-foreground"
      >
        <Plus size={22} weight="bold" />
      </span>

      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-bold leading-tight text-foreground">
          {title}
        </span>
        <span className="mt-0.5 block text-[13px] leading-snug text-foreground-secondary">
          {hint}
        </span>
      </span>

      <span
        aria-hidden="true"
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-full bg-surface text-foreground",
          "transition-transform duration-(--duration-fast) ease-(--ease-spring)",
          "group-hover:translate-x-0.5 motion-reduce:transform-none motion-reduce:transition-none",
        )}
      >
        <ArrowRight size={16} weight="bold" />
      </span>
    </Link>
  );
}
