import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * PESTAÑAS QUE SON NAVEGACIÓN, NO UN WIDGET.
 *
 * ── Por qué no reusa <Tabs> ──────────────────────────────────────────────────
 * `ui/tabs.tsx` implementa el patrón WAI-ARIA `tablist/tab/tabpanel`: botones,
 * `aria-selected`, y paneles que se muestran y ocultan EN LA MISMA PÁGINA. Ese
 * patrón asume que el contenido de las siete pestañas ya está en el cliente.
 *
 * Las pestañas del perfil no son eso. Cada una es una consulta distinta contra
 * la base (publicaciones, fotos, videos, reseñas, seguidores…) y tiene que ser
 * un Server Component con su propia URL: compartible, con back del sistema, y
 * sin bajar siete listas para mostrar una. O sea: son ENLACES.
 *
 * Y a un enlace que navega NO se le pone `role="tab"`. El APG del W3C es
 * explícito: cuando las pestañas cambian de URL, el marcado correcto es
 * navegación —`<nav>` + lista de enlaces + `aria-current="page"`—, porque
 * `aria-selected` le promete al lector de pantalla un panel que se actualiza
 * sin salir de la página, y acá la página se reemplaza entera. Poner `tablist`
 * sobre enlaces es el error clásico de este componente; esto lo evita a
 * propósito.
 *
 * ── Detalles que no son decoración ───────────────────────────────────────────
 *  · `min-h-11` = 44px: el mínimo táctil de §3.2, incluso con la etiqueta corta.
 *  · Scroll horizontal con `scrollbar-none` — siete pestañas no entran en 375px
 *    y colapsarlas en un "Más" esconde justo lo que el cliente pidió ver.
 *  · El subrayado activo es CSS puro (no `layoutId` de motion como en <Tabs>):
 *    entre navegaciones el nodo se remonta, así que una animación compartida no
 *    tendría de dónde a dónde ir. Menos JS y ninguna promesa incumplida.
 *  · El contador va con `numeric` (tabular-nums, §2.2): 1.234 no mueve la
 *    pestaña de al lado cuando pasa a 1.235.
 *  · `scroll-mt-*` no va acá: lo pone quien renderiza el panel.
 */

export interface NavTabItem {
  /** Identificador estable; sólo se usa como key y para comparar con `active`. */
  id: string;
  label: string;
  href: string;
  /** Contador opcional al lado de la etiqueta (seguidores, reseñas…). */
  count?: number;
}

export interface NavTabsProps {
  items: NavTabItem[];
  /** `id` de la pestaña actual. */
  active: string;
  /** Nombre accesible de la barra ("Secciones del perfil"). */
  label: string;
  className?: string;
}

export function NavTabs({ items, active, label, className }: NavTabsProps) {
  return (
    <nav aria-label={label} className={className}>
      <ul className="scrollbar-none flex gap-1 overflow-x-auto border-b border-border-subtle">
        {items.map((item) => {
          const current = item.id === active;
          return (
            <li key={item.id} className="shrink-0">
              <Link
                href={item.href}
                aria-current={current ? "page" : undefined}
                // `scroll={false}`: cambiar de pestaña no tiene por qué mandar a
                // la persona al tope de la página — la cabecera del perfil, que
                // es lo que da contexto, quedaría fuera de cuadro si saltara.
                scroll={false}
                className={cn(
                  "relative flex min-h-11 items-center gap-1.5 whitespace-nowrap px-3.5 text-sm font-medium",
                  "transition-colors duration-(--duration-fast) ease-(--ease-out-premium)",
                  "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-focus-ring",
                  current ? "text-foreground" : "text-foreground-secondary hover:text-foreground",
                )}
              >
                {item.label}
                {typeof item.count === "number" && (
                  <span
                    className={cn(
                      "numeric text-xs",
                      current ? "text-foreground-secondary" : "text-foreground-muted",
                    )}
                  >
                    {item.count}
                  </span>
                )}
                {current && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-brand"
                  />
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
