"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChartLineUp,
  ClockCounterClockwise,
  Globe,
  ListMagnifyingGlass,
  SquaresFour,
  Tag,
  UserGear,
} from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";

/**
 * Navegación SECUNDARIA del panel Global.
 *
 * Deliberadamente distinta de `AdminNav`: aquella son pestañas con subrayado de
 * marca (nivel 1, las secciones del panel); ésta son pastillas (nivel 2, las
 * pantallas de Global). Mezclar los dos patrones en el mismo look haría que un
 * subnivel se lea como si fuera hermano de Moderación o Miembros, y no lo es.
 *
 * El estado activo no se apoya sólo en color: además del tinte lleva
 * `aria-current="page"` y peso semibold, así que se distingue en escala de
 * grises y se anuncia en un lector de pantalla.
 */

const ITEMS = [
  { href: "/admin/global", label: "Resumen", icon: SquaresFour, exact: true },
  { href: "/admin/global/dominios", label: "Dominios", icon: Globe, exact: false },
  { href: "/admin/global/administradores", label: "Administradores", icon: UserGear, exact: false },
  {
    href: "/admin/global/contenido",
    label: "Contenido",
    icon: ListMagnifyingGlass,
    exact: false,
  },
  // Precios e Ingresos van juntos y en este orden: primero lo que se DECIDE
  // cobrar, después lo que efectivamente ENTRÓ. Leídos al revés, el tablero de
  // ingresos parece la explicación de una tarifa que todavía no se fijó.
  { href: "/admin/global/precios", label: "Precios", icon: Tag, exact: false },
  { href: "/admin/global/ingresos", label: "Ingresos", icon: ChartLineUp, exact: false },
  {
    href: "/admin/global/auditoria",
    label: "Registro",
    icon: ClockCounterClockwise,
    exact: false,
  },
] as const;

export function GlobalSubnav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Pantallas del panel global" className="mb-6">
      <ul className="scrollbar-none flex gap-2 overflow-x-auto">
        {ITEMS.map((item) => {
          const active = item.exact
            ? pathname === item.href
            : pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-4 text-sm",
                  "transition-colors duration-(--duration-fast) ease-(--ease-out-premium)",
                  "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
                  active
                    ? "border-brand-subtle bg-brand-tint font-semibold text-brand-ink"
                    : "border-border bg-surface font-medium text-foreground-secondary hover:border-border-strong hover:text-foreground",
                )}
              >
                <Icon size={16} aria-hidden="true" />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
