import Link from "next/link";
import { bubbleStyle, bubbleVariants } from "@/components/ui";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { VisibleModuleState } from "./module-access";
import type { ModuleItem } from "./modules";

export interface ModuleBubbleProps {
  item: ModuleItem;
  active?: boolean;
  /**
   * `row` = fila compacta de dos columnas (menú lateral).
   * `tile` = tile alto con el ícono grande (pantalla Buscar).
   */
  layout?: "row" | "tile";
  /**
   * Estado del módulo según el panel (ver ./module-access). `soon` = se ve,
   * lleva su etiqueta y sigue siendo un enlace real: toca y cae en la pantalla
   * de "Muy pronto" de esa misma ruta.
   */
  state?: VisibleModuleState;
  /** El menú lo usa para cerrarse al navegar. */
  onNavigate?: () => void;
}

/**
 * Un módulo, como cápsula. Fuente única de la grilla de categorías: la usan el
 * menú lateral y la pantalla Buscar, así que las dos no pueden divergir —
 * el mismo ícono 3D, el mismo acento y la misma forma en los dos lugares es lo
 * que hace que la persona reconozca "Vivienda" sin leer la palabra.
 *
 * Sin hooks ni "use client": el menú (cliente) le pasa `onNavigate` y /buscar
 * (servidor) no le pasa nada.
 *
 * NOTA (rediseño Comunidad, 2026-08-13): el cuadrado que dibuja `layout="tile"`
 * de acá abajo ahora tiene una versión compartida y desacoplada de
 * `tenants.modules` en `@/components/ui/square-tile` (`SquareTile`), que usa la
 * grilla de categorías DENTRO de Comunidad. No se unificó ESTE archivo con esa
 * porque acá el tile todavía carga el estado "muy pronto" y el anillo de
 * activo —cosas que sólo tienen sentido para un módulo de plataforma, no para
 * una categoría interna— y porque hoy `layout="tile"` tiene un único call site
 * (`/buscar`) que nunca pasa `active`: tocar este componente para desenredar
 * esa lógica es un cambio aparte, no algo para colar en medio de otro pedido.
 * Si el día de mañana hace falta una tercera grilla de cuadrados, es la señal
 * de que conviene migrar este branch a `SquareTile` de una vez.
 */
export function ModuleBubble({
  item,
  active = false,
  layout = "row",
  state = "active",
  onNavigate,
}: ModuleBubbleProps) {
  const IconComponent = item.icon;
  const tile = layout === "tile";
  const soon = state === "soon";

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      prefetch={false}
      aria-current={active ? "page" : undefined}
      style={bubbleStyle(item.palette.icon)}
      className={cn(
        bubbleVariants({
          // Ni siquiera la categoría en reposo va sobre blanco: cada cápsula
          // lleva un lavado de SU acento. Es lo que hace que la grilla se lea
          // como nueve objetos distintos y no como una tabla — el "no me
          // gustaba cómo se veían las partes blancas" del cliente.
          //
          // Lo único que le baja el "muy pronto" al ítem actual es el RELLENO:
          // la escala de la burbuja significa algo (soft informa, strong se
          // toca) y una sección que todavía no abrió no puede pedir el mismo
          // tacto que una abierta. El "estás acá" —el anillo, el peso del
          // ícono, la etiqueta en semibold— se conserva igual, porque el
          // `aria-current="page"` de abajo lo anuncia y las dos señales no
          // pueden contradecirse.
          tone: active && !soon ? "accentStrong" : "accentSoft",
          shape: "tile",
          size: "none",
          interactive: true,
        }),
        // `h-full`: la etiqueta "Muy pronto" hace más alta a su cápsula, y sin
        // esto la vecina de la misma fila quedaba corta (el <li> se estira con
        // la grilla, el <a> no) — dos pastillas de distinto alto lado a lado
        // rompen la ilusión de objetos iguales que sostiene toda la grilla.
        "h-full",
        tile
          ? "flex min-h-[7.5rem] flex-col items-center justify-center gap-2 p-3 text-center"
          : "flex min-h-14 items-center gap-2.5 p-2.5",
        // El activo se marca con el anillo del acento por dentro, para que el
        // hairline de la cápsula no cambie de grosor y la grilla no "salte".
        active &&
          "shadow-[inset_0_0_0_1.5px_var(--bubble-line-strong),inset_0_1px_0_var(--cl-bezel-highlight)]",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "flex shrink-0 items-center justify-center overflow-hidden rounded-md",
          tile ? "size-14" : "size-9 rounded-sm",
          // El ícono es lo ÚNICO que se atenúa: es decorativo (aria-hidden), así
          // que bajarlo no le cuesta contraste a nadie. La etiqueta se queda en
          // `text-foreground` — el público incluye gente mayor y el nombre de la
          // categoría nunca puede ser lo que se apaga.
          soon && "opacity-70",
        )}
        style={{ backgroundColor: item.palette.chip }}
      >
        {item.image ? (
          /* Set premium 3D (Meshy): la imagen trae su propio fondo pastel del
             acento — full-bleed en el chip. */
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.image}
            alt=""
            width={tile ? 56 : 36}
            height={tile ? 56 : 36}
            loading="lazy"
            className="size-full object-cover"
          />
        ) : (
          <IconComponent
            size={tile ? 28 : 20}
            weight={active ? "fill" : "regular"}
            style={{ color: item.palette.icon }}
          />
        )}
      </span>
      <span
        className={cn(
          "flex min-w-0 flex-col leading-tight",
          tile ? "items-center text-sm" : "flex-1 text-[13px]",
        )}
      >
        <span
          className={cn(
            "min-w-0",
            // Nombre de categoría siempre en `text-foreground`: el público al que
            // apunta la app incluye gente mayor y este texto es la etiqueta
            // principal, no un dato secundario. El peso marca el estado activo.
            active ? "font-semibold text-foreground" : "font-medium text-foreground",
          )}
        >
          {item.label}
        </span>
        {soon && (
          // Texto, no solo color: el estado tiene que llegar igual a quien no
          // distingue el matiz y a quien escucha la pantalla ("Marketplace Muy
          // pronto, enlace"). El relleno sale de --bubble-wash (26% del acento
          // sobre surface), el único escalón que queda por encima del fondo de
          // la cápsula en los DOS temas — un gris fijo se borraría en uno.
          <span
            className={cn(
              "mt-1 inline-flex w-fit items-center rounded-full px-2 py-0.5",
              "bg-[var(--bubble-wash)] text-[11px] font-semibold text-foreground",
            )}
          >
            {t("nav", "moduleSoonBadge")}
          </span>
        )}
      </span>
    </Link>
  );
}
