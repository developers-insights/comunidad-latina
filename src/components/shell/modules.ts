// Los íconos vienen del build `/dist/ssr` y NO del entrypoint principal: ese
// lleva "use client" + createContext, y desde que /buscar (Server Component)
// consume este registro, importarlo ahí reventaba el render con
// "createContext is not a function". Los `/dist/ssr` son componentes planos,
// sin hooks: sirven igual en el menú (cliente) y en /buscar (servidor).
// El tipo `Icon` sí viene del entrypoint principal, pero `import type` se borra
// en compilación y nunca llega al bundle.
import {
  Briefcase,
  Buildings,
  CalendarBlank,
  HouseSimple,
  Megaphone,
  Play,
  ShoppingBagOpen,
  Sparkle,
  Storefront,
  UserGear,
} from "@phosphor-icons/react/dist/ssr";
import type { Icon } from "@phosphor-icons/react";
import { t } from "@/lib/i18n";
import type { GatedModule } from "./module-access";

/**
 * Registro de los 9 módulos de la plataforma — fuente única para el menú
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

export interface ModuleItem extends GatedModule {
  href: string;
  label: string;
  icon: Icon;
  palette: ModulePalette;
  /**
   * Ícono premium 3D del menú (set Meshy 2026-07-27, public/icons/menu/).
   * El Phosphor `icon` queda como fallback y para superficies chicas.
   */
  image?: string;
  /**
   * Clave en `tenants.modules` / `tenants.modules_soon` — lo que conecta este
   * ítem con el interruptor del panel (/admin/dominio). Ausente = el panel
   * todavía no lo ofrece y el módulo se muestra siempre (ver `moduleAvailability`
   * en ./module-access, y el test de sincronía con MODULE_KEYS en modules.test).
   */
  moduleKey?: string;
}

export const MODULES: ModuleItem[] = [
  {
    href: "/feed",
    moduleKey: "feed",
    image: "/icons/menu/feed.webp",
    label: t("nav", "feed"),
    icon: HouseSimple,
    palette: accentPalette("var(--accent-feed)"),
  },
  // Videos (reels, sprint 2026-07-21): comparte el acento del feed a propósito
  // — es la misma capa social de la plataforma, en formato video.
  {
    href: "/videos",
    moduleKey: "videos",
    image: "/icons/menu/videos.webp",
    label: t("nav", "videos"),
    icon: Play,
    palette: accentPalette("var(--accent-feed)"),
  },
  {
    href: "/propiedades",
    moduleKey: "propiedades",
    image: "/icons/menu/vivienda.webp",
    label: t("nav", "moduleVivienda"),
    icon: Buildings,
    palette: accentPalette("var(--accent-vivienda)"),
  },
  {
    href: "/eventos",
    moduleKey: "eventos",
    image: "/icons/menu/eventos.webp",
    label: t("nav", "moduleEventos"),
    icon: CalendarBlank,
    palette: accentPalette("var(--accent-eventos)"),
  },
  {
    href: "/negocios",
    moduleKey: "negocios",
    image: "/icons/menu/negocios.webp",
    label: t("nav", "moduleNegocios"),
    icon: Storefront,
    palette: accentPalette("var(--accent-negocios)"),
  },
  // El maletín pasó a ser de Empleos (es el ícono de `job` en el feed, KIND_ICON);
  // Profesionales toma UserGear, que es el que ya lo representa ahí. Dos módulos
  // vecinos no pueden compartir ícono en un menú donde el ícono es la mitad de
  // la pista visual.
  {
    href: "/profesionales",
    moduleKey: "profesionales",
    image: "/icons/menu/profesionales.webp",
    label: t("nav", "moduleProfesionales"),
    icon: UserGear,
    palette: accentPalette("var(--accent-profesionales)"),
  },
  // Empleos va pegado a Profesionales: son los dos módulos de trabajo — uno
  // ofrece oficio, el otro busca gente. Acento propio (naranja) para que no se
  // confundan de un vistazo en el menú.
  {
    href: "/empleos",
    moduleKey: "empleos",
    image: "/icons/menu/empleos.webp",
    label: t("nav", "moduleEmpleos"),
    icon: Briefcase,
    palette: accentPalette("var(--accent-empleos)"),
  },
  {
    href: "/marketplace",
    moduleKey: "marketplace",
    image: "/icons/menu/marketplace.webp",
    label: t("nav", "moduleMarketplace"),
    icon: ShoppingBagOpen,
    palette: accentPalette("var(--accent-marketplace)"),
  },
  {
    href: "/creadores",
    moduleKey: "creadores",
    image: "/icons/menu/creadores.webp",
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
 * Boost — OCTAVA sección de /buscar (pedido Manuel, 2026-08-11), separada a
 * propósito de `MODULES`:
 *
 *  · `MODULES` es el catálogo de VERTICALES de contenido — cada entrada es un
 *    tipo de aviso que alguien publica y otra persona navega. Boost no es una
 *    vertical, es una COMPRA (pagar para que un aviso o un post lleguen a más
 *    gente); meterlo en `MODULES` lo mezclaría con superficies que sí esperan
 *    "una categoría por tipo de contenido" (p. ej. la burbuja "Publicá tu…" de
 *    cada listado) y no corresponde ofrecer "Publicá tu Boost" ahí.
 *  · Por eso mismo NO lleva `moduleKey`: el panel (/admin/dominio) apaga
 *    VERTICALES ("no vamos a abrir el Creator Marketplace todavía"), pero
 *    ningún tenant pide poder ocultar la forma de pagarle a la plataforma —
 *    es infraestructura de monetización, igual de siempre-activa que
 *    `mensajes` o `feed` (ver `ALWAYS_ON_MODULE_KEYS` en ./module-access).
 *
 * El acento sale de `--color-sponsored` (el mismo dorado del chip/anillo de
 * contenido patrocinado en toda la app — ver card-ad-chip.tsx y los listados
 * con `ring-sponsored`), no de un `--accent-*` de vertical: dorado es el color
 * fijo de "esto es plata", no de una categoría.
 */
export const BOOST_MODULE: ModuleItem = {
  href: "/impulsar",
  // Sin `image`: no hay ícono 3D propio (set Meshy) para Boost todavía. El
  // Phosphor `Megaphone` de abajo es el fallback normal — `ModuleBubble` ya
  // resuelve el caso sin `image` (chip con el ícono plano, mismo layout).
  label: t("nav", "moduleBoost"),
  icon: Megaphone,
  palette: accentPalette("var(--color-sponsored)"),
};

/**
 * Los módulos que /buscar ofrece como CATEGORÍAS.
 *
 * Es MODULES menos los que ya son una pestaña del bottom nav (Inicio y Videos
 * están a un toque desde cualquier pantalla, y repetirlos en Buscar le enseña
 * a la gente que hay dos caminos para lo mismo) MÁS Boost al final. Las
 * primeras siete son las secciones de listado — las mismas que llevan la
 * burbuja "Publicá tu…", así que Buscar y los listados se explican entre sí.
 * Boost va OCTAVA y última a propósito: es la salida de "ya publiqué, ahora
 * quiero que se vea más", no una categoría más para navegar — cierra la
 * grilla en vez de mezclarse entre las verticales de contenido.
 */
export const BROWSE_MODULES: ModuleItem[] = [
  ...MODULES.filter((item) => item.href !== "/feed" && item.href !== "/videos"),
  BOOST_MODULE,
];

/**
 * ¿La ruta actual activa este módulo? Pura y testeada aparte.
 * `/propiedades/abc` activa `/propiedades`, pero `/propiedades-viejas` no.
 */
export function isModuleActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * ¿Estamos dentro de la rama de Buscar? Sirve para que la pestaña quede
 * resaltada mientras la persona navega una categoría — antes, estando en
 * /negocios o /eventos NINGUNA pestaña estaba marcada y el bottom nav no decía
 * dónde estabas.
 *
 * Ojo: esto es señal VISUAL. `aria-current="page"` sigue reservado para la
 * ruta exacta (/buscar), porque /negocios no es esa página.
 */
export function isBrowseRoute(pathname: string): boolean {
  return BROWSE_MODULES.some((item) => isModuleActive(pathname, item.href));
}
