"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { m } from "motion/react";
import {
  Briefcase,
  Buildings,
  CalendarBlank,
  HouseSimple,
  ShieldCheck,
  ShoppingBagOpen,
  Sparkle,
  Storefront,
  type Icon,
} from "@phosphor-icons/react";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * Rail de módulos: fila de cápsulas scrolleable bajo el header (feedback
 * cliente 2026-07-19: "todos los módulos dentro de su botón cápsula" +
 * "tiene que tener color la app"). Presente en toda ruta de (app) — se monta
 * una vez en el layout y persiste entre navegaciones (no se remonta), lo que
 * permite que el indicador activo se anime con `layoutId` en vez de cortar.
 *
 * El bottom nav sigue cubriendo lo core (Feed/Propiedades/Mensajes/Perfil);
 * este rail cubre los 8 módulos de la plataforma en el orden acordado.
 */

interface ModulePalette {
  /** Fondo del estado activo (tinte ~14%). */
  bg: string;
  /** Anillo del estado activo (tinte ~40%). */
  ring: string;
  /** Color del ícono — SIEMPRE aplicado (activo e inactivo): "decorativo",
   *  el texto de la etiqueta usa tokens del sistema, nunca este color. */
  icon: string;
}

/** Acentos fijos por módulo (globals.css `--accent-*`, no tenant/tema). */
function accentPalette(accentVar: string): ModulePalette {
  return {
    bg: `color-mix(in oklab, ${accentVar} 14%, transparent)`,
    ring: `color-mix(in oklab, ${accentVar} 40%, transparent)`,
    icon: accentVar,
  };
}


interface ModuleItem {
  href: string;
  label: string;
  icon: Icon;
  palette: ModulePalette;
}

const MODULES: ModuleItem[] = [
  {
    href: "/feed",
    label: t("nav", "feed"),
    icon: HouseSimple,
    palette: accentPalette("var(--accent-feed)"),
  },
  {
    href: "/propiedades",
    label: t("nav", "moduleVivienda"),
    icon: Buildings,
    palette: accentPalette("var(--accent-vivienda)"),
  },
  {
    href: "/eventos",
    label: t("nav", "moduleEventos"),
    icon: CalendarBlank,
    palette: accentPalette("var(--accent-eventos)"),
  },
  {
    href: "/negocios",
    label: t("nav", "moduleNegocios"),
    icon: Storefront,
    palette: accentPalette("var(--accent-negocios)"),
  },
  {
    href: "/profesionales",
    label: t("nav", "moduleProfesionales"),
    icon: Briefcase,
    palette: accentPalette("var(--accent-profesionales)"),
  },
  {
    href: "/marketplace",
    label: t("nav", "moduleMarketplace"),
    icon: ShoppingBagOpen,
    palette: accentPalette("var(--accent-marketplace)"),
  },
  {
    href: "/creadores",
    label: t("nav", "moduleCreadores"),
    icon: Sparkle,
    palette: accentPalette("var(--accent-creadores)"),
  },
  {
    href: "/escudo",
    label: t("nav", "moduleEscudo"),
    icon: ShieldCheck,
    palette: accentPalette("var(--accent-escudo)"),
  },
];

/** Pura (testeada aparte): ¿la ruta actual activa este módulo? */
export function isModuleActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function ModuleRail() {
  const pathname = usePathname();
  const scrollerRef = useRef<HTMLUListElement>(null);
  const activeItemRef = useRef<HTMLLIElement>(null);
  const [fade, setFade] = useState({ start: false, end: false });

  const activeHref = MODULES.find((item) => isModuleActive(pathname, item.href))?.href;

  // La cápsula activa siempre visible: al entrar a la app y cada vez que la
  // navegación (rail u otro link) cambia de módulo. Sin `behavior: "smooth"`
  // a propósito — ya tiene que verse bien en el primer frame, no "viajar"
  // hasta ahí.
  useEffect(() => {
    activeItemRef.current?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "auto" });
  }, [activeHref]);

  // Fades de borde: solo aparecen del lado en que de verdad hay más cápsulas
  // ocultas — no son decoración fija, siguen la posición real del scroll.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;

    function updateFade() {
      if (!el) return;
      setFade({
        start: el.scrollLeft > 4,
        end: el.scrollLeft + el.clientWidth < el.scrollWidth - 4,
      });
    }

    updateFade();
    el.addEventListener("scroll", updateFade, { passive: true });
    window.addEventListener("resize", updateFade);
    return () => {
      el.removeEventListener("scroll", updateFade);
      window.removeEventListener("resize", updateFade);
    };
  }, []);

  return (
    <nav aria-label={t("nav", "modulesNav")} className="bg-surface/85 backdrop-blur-md">
      <div className="relative mx-auto w-full max-w-lg">
        <ul
          ref={scrollerRef}
          className="scrollbar-none flex snap-x snap-proximity gap-2 overflow-x-auto px-4 py-2.5"
        >
          {MODULES.map((item) => {
            const active = item.href === activeHref;
            const IconComponent = item.icon;
            return (
              <li
                key={item.href}
                ref={active ? activeItemRef : undefined}
                className="shrink-0 snap-start"
              >
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative flex h-11 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-sm",
                    "transition-colors duration-(--duration-fast) ease-(--ease-out-premium)",
                    "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
                    active
                      ? "border-transparent font-semibold text-foreground"
                      : "border-border-subtle bg-surface-subtle text-foreground-secondary hover:bg-surface-hover hover:text-foreground",
                  )}
                >
                  {active && (
                    <m.span
                      layoutId="module-rail-active"
                      aria-hidden="true"
                      className="absolute inset-0 rounded-full"
                      style={{
                        backgroundColor: item.palette.bg,
                        boxShadow: `inset 0 0 0 1.5px ${item.palette.ring}`,
                      }}
                      // `ease` de Motion no acepta `var()` — son los mismos 4
                      // números de `--ease-spring` en globals.css, a mano.
                      transition={{ duration: 0.35, ease: [0.34, 1.56, 0.64, 1] }}
                    />
                  )}
                  <span className="relative z-10 flex items-center gap-1.5">
                    <IconComponent
                      size={18}
                      weight={active ? "fill" : "regular"}
                      aria-hidden="true"
                      className="shrink-0"
                      style={{ color: item.palette.icon }}
                    />
                    {item.label}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>

        {/* Fades de borde: insinúan que el rail sigue más allá del viewport. */}
        <div
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-surface via-surface/70 to-transparent",
            "transition-opacity duration-(--duration-fast)",
            fade.start ? "opacity-100" : "opacity-0",
          )}
        />
        <div
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-surface via-surface/70 to-transparent",
            "transition-opacity duration-(--duration-fast)",
            fade.end ? "opacity-100" : "opacity-0",
          )}
        />
      </div>
    </nav>
  );
}
