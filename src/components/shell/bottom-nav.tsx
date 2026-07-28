"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChatCircle,
  HouseSimple,
  MagnifyingGlass,
  Play,
  UserCircle,
  type Icon,
} from "@phosphor-icons/react";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { moduleAvailability } from "./module-access";
import { isBrowseRoute, isModuleActive } from "./modules";

type NavItem = {
  href: string;
  label: string;
  icon: Icon;
  /** Rutas que, sin ser esta página, pertenecen a su rama (sólo señal visual). */
  ownsBranch?: (pathname: string) => boolean;
  /**
   * Clave del módulo en `tenants.modules`. Presente = la pestaña desaparece si
   * el panel apaga la sección. Ausente = pestaña estructural, siempre está.
   */
  moduleKey?: string;
};

const ITEMS: NavItem[] = [
  // Inicio y Mensajes tienen clave en el panel pero NO se apagan desde acá:
  // `ALWAYS_ON_MODULE_KEYS` (module-access.ts) los declara intocables y por eso
  // no llevan `moduleKey`. Inicio es el destino del logo del header y adonde
  // aterriza todo el mundo al entrar; Mensajes es adonde apunta cada CTA de
  // contacto de la app, muchos de los cuales ni pasan por esta barra.
  { href: "/feed", label: t("nav", "feed"), icon: HouseSimple },
  // "Propiedades" salió del bottom nav y entró Buscar (feedback cliente
  // 2026-07-27): una sola pestaña abre las nueve categorías en vez de darle
  // el lugar fijo a una sola. Vivienda sigue a un toque, desde /buscar.
  {
    href: "/buscar",
    label: t("nav", "search"),
    icon: MagnifyingGlass,
    ownsBranch: isBrowseRoute,
  },
  // Videos al CENTRO a propósito (patrón Instagram/TikTok): el contenido que
  // más retiene, a un pulgar de distancia (sprint reels 2026-07-21). Es la
  // única pestaña que el panel puede sacar de la barra — ver la regla abajo.
  { href: "/videos", label: t("nav", "videos"), icon: Play, moduleKey: "videos" },
  { href: "/mensajes", label: t("nav", "messages"), icon: ChatCircle },
  { href: "/perfil", label: t("nav", "profile"), icon: UserCircle },
];

export interface BottomNavProps {
  /** `tenants.modules` / `tenants.modules_soon` del request (vía el layout). */
  modules: Record<string, boolean>;
  modulesSoon: Record<string, boolean>;
}

/**
 * Bottom nav del shell (mobile-first). Activo = color de marca + peso Fill.
 * Targets ≥44px, safe-area para notch, ícono + texto siempre (nunca solo ícono).
 *
 * Barra sticky = superficie elevada: `bg-surface/92` (no canvas), translúcida
 * sobre el blur, con hairline `border-border` que se ve en ambos temas.
 *
 * Dos estados distintos y deliberados: `current` es la página exacta (y es lo
 * único que lleva `aria-current="page"`); `active` incluye la rama, para que
 * Buscar siga marcada mientras recorrés una categoría.
 *
 * REGLA DE MÓDULOS APAGADOS: una pestaña se muestra sólo si su módulo está
 * ACTIVO. "Muy pronto" tampoco la deja: un lugar de la navegación primaria —hay
 * cinco en toda la app— tiene que llevar a algo que funcione hoy, y una pestaña
 * que aterriza en un cartel de "todavía no abrimos" es peor que una pestaña
 * menos. El anuncio no se pierde: el módulo sigue apareciendo con su etiqueta
 * "Muy pronto" en el menú y en /buscar, que es exactamente donde el cliente lo
 * pidió («cuando le dan al Creator Marketplace, dice: viene muy pronto»).
 *
 * Y no queda hueco: los ítems son `flex-1`, así que las pestañas restantes se
 * reparten el ancho. Cuatro de las cinco son estructurales o intocables, así que
 * la barra nunca puede bajar de cuatro ni quedar con un espacio vacío.
 */
export function BottomNav({ modules, modulesSoon }: BottomNavProps) {
  const pathname = usePathname();
  const items = ITEMS.filter(
    (item) => moduleAvailability(item.moduleKey, modules, modulesSoon) === "active",
  );

  return (
    <nav
      aria-label={t("nav", "mainNav")}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/92 backdrop-blur-md"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="mx-auto flex w-full max-w-lg items-stretch">
        {items.map(({ href, label, icon: IconComponent, ownsBranch }) => {
          const current = isModuleActive(pathname, href);
          const active = current || (ownsBranch?.(pathname) ?? false);
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "flex min-h-14 flex-col items-center justify-center gap-0.5 py-1.5",
                  "text-[11px] font-medium transition-colors duration-150",
                  "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-focus-ring",
                  active
                    ? "text-brand-ink"
                    : "text-foreground-muted hover:text-foreground",
                )}
              >
                <IconComponent size={24} weight={active ? "fill" : "regular"} aria-hidden />
                <span>{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
