import {
  Briefcase,
  Buildings,
  CalendarBlank,
  HouseSimple,
  ShoppingBagOpen,
  Sparkle,
  Storefront,
  type Icon,
} from "@phosphor-icons/react";
import { t } from "@/lib/i18n";

/**
 * Registro de los 8 módulos de la plataforma — fuente única para el menú
 * (y para cualquier superficie futura que los enumere).
 *
 * Antes vivían en un rail de cápsulas bajo el header; el cliente pidió
 * (2026-07-20) sacar ese "catálogo" de arriba y meterlo en un botón de menú.
 * La navegación PRIMARIA sigue siendo el bottom nav (Inicio/Propiedades/
 * Mensajes/Perfil); el menú es navegación SECUNDARIA — separación estándar
 * y deliberada (un drawer nunca debe reemplazar a la nav primaria).
 */

export interface ModulePalette {
  /** Fondo tintado del ítem activo (~14%). */
  bg: string;
  /** Anillo del ítem activo (~40%). */
  ring: string;
  /** Fondo del chip del ícono, siempre presente (~12%). */
  chip: string;
  /** Color del ícono — decorativo: la etiqueta usa tokens del sistema. */
  icon: string;
}

/** Acentos fijos por módulo (globals.css `--accent-*`, no dependen de tema ni tenant). */
function accentPalette(accentVar: string): ModulePalette {
  return {
    bg: `color-mix(in oklab, ${accentVar} 14%, transparent)`,
    ring: `color-mix(in oklab, ${accentVar} 40%, transparent)`,
    chip: `color-mix(in oklab, ${accentVar} 12%, transparent)`,
    icon: accentVar,
  };
}

export interface ModuleItem {
  href: string;
  label: string;
  icon: Icon;
  palette: ModulePalette;
}

export const MODULES: ModuleItem[] = [
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
  // Escudo oculto por ahora (pedido cliente 2026-07-20): la feature entera
  // está apagada — sin entry point acá, y la ruta directa también 404.
  // Al reactivarla, volver a montar:
  //   { href: "/escudo", label: t("nav", "moduleEscudo"), icon: ShieldCheck,
  //     palette: accentPalette("var(--accent-escudo)") }
];

/**
 * ¿La ruta actual activa este módulo? Pura y testeada aparte.
 * `/propiedades/abc` activa `/propiedades`, pero `/propiedades-viejas` no.
 */
export function isModuleActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
