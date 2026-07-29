"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Plus } from "@phosphor-icons/react";
import { m, useReducedMotion } from "motion/react";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { CreateMenu } from "./create-menu";
import { moduleAvailability } from "./module-access";
import { isBrowseRoute, isModuleActive } from "./modules";

type NavItem = {
  href: string;
  label: string;
  /** Ícono 3D del set premium (public/icons/nav, 2026-07-29). */
  image: string;
  /** Rutas que, sin ser esta página, pertenecen a su rama (sólo señal visual). */
  ownsBranch?: (pathname: string) => boolean;
  /**
   * Clave del módulo en `tenants.modules`. Presente = la pestaña desaparece si
   * el panel apaga la sección. Ausente = pestaña estructural, siempre está.
   */
  moduleKey?: string;
  /** Punto de aviso (notificaciones sin leer, que viven en Ajustes). */
  badge?: boolean;
};

/**
 * Barra nueva (pedido de Manuel, 2026-07-29): Inicio · Buscar · [+] · Videos ·
 * Ajustes. Dos cambios de fondo respecto de la anterior:
 *
 *  · El CENTRO dejó de ser un destino y pasó a ser una ACCIÓN. El "+" abre el
 *    mismo menú de "¿Qué querés publicar?" que el composer del feed —una sola
 *    hoja, ver create-menu.tsx— así que publicar cuesta un toque desde
 *    cualquier pantalla y no "volvé al feed, bajá, tocá la fila".
 *  · Mensajes y Perfil salieron de acá y subieron al header. Perfil porque el
 *    cliente pidió el avatar arriba en lugar del botón de menú; Mensajes
 *    porque es adonde apunta cada CTA de contacto de la app y no podía quedar
 *    a dos toques (ver header.tsx).
 *
 * Ajustes ocupa el quinto lugar y absorbe lo que vivía en el menú lateral que
 * se eliminó: notificaciones, tema, privacidad, sesión. Por eso el punto de "sin
 * leer" es SUYO — la señal tiene que estar donde está el contenido.
 */
const LEFT_ITEMS: NavItem[] = [
  { href: "/feed", label: t("nav", "feed"), image: "/icons/nav/inicio.webp" },
  // "Propiedades" salió del bottom nav y entró Buscar (feedback cliente
  // 2026-07-27): una sola pestaña abre las nueve categorías en vez de darle
  // el lugar fijo a una sola. Vivienda sigue a un toque, desde /buscar.
  {
    href: "/buscar",
    label: t("nav", "search"),
    image: "/icons/nav/buscar.webp",
    ownsBranch: isBrowseRoute,
  },
];

const RIGHT_ITEMS: NavItem[] = [
  { href: "/videos", label: t("nav", "videos"), image: "/icons/nav/videos.webp", moduleKey: "videos" },
  { href: "/ajustes", label: t("nav", "settings"), image: "/icons/nav/ajustes.webp", badge: true },
];

export interface BottomNavProps {
  /** `tenants.modules` / `tenants.modules_soon` del request (vía el layout). */
  modules: Record<string, boolean>;
  modulesSoon: Record<string, boolean>;
  /** Hay sesión: sin ella el "+" lleva a entrar en vez de abrir el menú. */
  canCreate: boolean;
  /** Notificaciones sin leer: pinta el punto de Ajustes. */
  unread: number;
}

/**
 * Bottom nav del shell (mobile-first). Activo = ícono a full color sobre una
 * píldora de marca + etiqueta en `brand-ink`; inactivo = el mismo ícono 3D
 * atenuado. Targets ≥44px, safe-area para notch, ícono + texto SIEMPRE (nunca
 * solo ícono) — también en el "+", que lleva su "Crear" como los demás.
 *
 * Barra sticky = superficie elevada: `bg-surface/92` (no canvas), translúcida
 * sobre el blur, con hairline `border-border` que se ve en ambos temas.
 *
 * Dos estados distintos y deliberados: `current` es la página exacta (y es lo
 * único que lleva `aria-current="page"`); `active` incluye la rama, para que
 * Buscar siga marcada mientras recorrés una categoría.
 *
 * REGLA DE MÓDULOS APAGADOS: una pestaña se muestra sólo si su módulo está
 * ACTIVO. "Muy pronto" tampoco la deja: un lugar de la navegación primaria
 * tiene que llevar a algo que funcione hoy, y una pestaña que aterriza en un
 * cartel de "todavía no abrimos" es peor que una pestaña menos. El anuncio no
 * se pierde: el módulo sigue apareciendo con su etiqueta "Muy pronto" en
 * /buscar, que es exactamente donde el cliente lo pidió.
 *
 * La grilla es de cinco columnas FIJAS (`1fr 1fr auto 1fr 1fr`). Si el panel
 * apaga Videos, su casillero queda vacío en vez de correr todo: el "+" es el
 * centro óptico de la barra y no puede desplazarse porque un administrador
 * apagó una sección.
 */
export function BottomNav({ modules, modulesSoon, canCreate, unread }: BottomNavProps) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const reduceMotion = useReducedMotion();

  const visible = (item: NavItem) =>
    moduleAvailability(item.moduleKey, modules, modulesSoon) === "active";

  return (
    <>
      <nav
        aria-label={t("nav", "mainNav")}
        // `overflow-visible` + z-40: el "+" sobresale por arriba del hairline.
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/92 backdrop-blur-md"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <ul className="mx-auto grid w-full max-w-lg grid-cols-[1fr_1fr_auto_1fr_1fr] items-stretch">
          {LEFT_ITEMS.map((item) => (
            <NavTab key={item.href} item={item} pathname={pathname} unread={unread} />
          ))}

          <li className="flex items-start justify-center">
            <CreateButton
              open={menuOpen}
              canCreate={canCreate}
              reduceMotion={Boolean(reduceMotion)}
              onOpen={() => setMenuOpen(true)}
            />
          </li>

          {RIGHT_ITEMS.map((item) =>
            visible(item) ? (
              <NavTab key={item.href} item={item} pathname={pathname} unread={unread} />
            ) : (
              // Casillero vacío a propósito: mantiene el "+" en el centro.
              <li key={item.href} aria-hidden="true" />
            ),
          )}
        </ul>
      </nav>

      <CreateMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        modules={modules}
        modulesSoon={modulesSoon}
      />
    </>
  );
}

function NavTab({
  item,
  pathname,
  unread,
}: {
  item: NavItem;
  pathname: string;
  unread: number;
}) {
  const current = isModuleActive(pathname, item.href);
  const active = current || (item.ownsBranch?.(pathname) ?? false);
  const showBadge = Boolean(item.badge) && unread > 0;

  return (
    <li>
      <Link
        href={item.href}
        aria-current={current ? "page" : undefined}
        className={cn(
          "flex min-h-14 flex-col items-center justify-center gap-0.5 py-1.5",
          "text-[11px] font-medium transition-colors duration-150",
          "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-focus-ring",
          active ? "text-brand-ink" : "text-foreground-muted hover:text-foreground",
        )}
      >
        <span
          className={cn(
            "relative flex size-9 items-center justify-center rounded-full",
            "transition-[background-color,transform] duration-(--duration-fast) ease-(--ease-spring)",
            active && "scale-105 bg-brand-tint",
          )}
        >
          {/* El ícono es DECORATIVO: la etiqueta de abajo es el nombre
              accesible del enlace. Sin `next/image` a propósito — es un webp de
              128px que se pinta a 30, no hay nada que optimizar y así el
              componente no arrastra el runtime de imágenes al bundle del shell. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={item.image}
            alt=""
            width={30}
            height={30}
            className={cn(
              "size-[30px] object-contain",
              "transition-[opacity,filter] duration-(--duration-fast)",
              // Inactivo NO es gris: es el mismo objeto, apenas atenuado. Un
              // grayscale total mataría lo que hace reconocible al set.
              active ? "opacity-100" : "opacity-70 saturate-[0.7]",
            )}
          />
          {showBadge && (
            <span
              aria-hidden="true"
              className="absolute right-0 top-0 size-2.5 rounded-full bg-brand ring-2 ring-surface"
            />
          )}
        </span>
        <span>
          {item.label}
          {showBadge && <span className="sr-only"> {t("nav", "unreadSuffix")}</span>}
        </span>
      </Link>
    </li>
  );
}

/**
 * El "+" del centro. No es una pestaña: es la acción principal de la app, y por
 * eso es lo único de la barra que sobresale, lleva la marca tricolor y no
 * marca `aria-current` nunca.
 *
 * Sin sesión no abre nada: lleva a entrar. Un disparador que abre un menú donde
 * las diez opciones terminan en "necesitás una cuenta" es una promesa falsa.
 */
function CreateButton({
  open,
  canCreate,
  reduceMotion,
  onOpen,
}: {
  open: boolean;
  canCreate: boolean;
  reduceMotion: boolean;
  onOpen: () => void;
}) {
  const label = t("nav", "create");

  const face = (
    <>
      <span
        aria-hidden="true"
        className={cn(
          "flex size-14 items-center justify-center rounded-full p-[2.5px]",
          "shadow-[0_6px_18px_-6px_rgb(0_0_0/0.45)] ring-4 ring-surface",
        )}
        // Aro tricolor de la marca alrededor del disco: distintivo sin ser
        // estridente (un gradiente tricolor de lado a lado se empasta al pasar
        // por el verde entre el azul y el amarillo).
        style={{
          backgroundImage:
            "conic-gradient(from 210deg, var(--brand-blue), var(--brand-red), var(--brand-yellow), var(--brand-blue))",
        }}
      >
        <m.span
          className="flex size-full items-center justify-center rounded-full bg-brand text-brand-foreground"
          animate={reduceMotion ? undefined : { rotate: open ? 45 : 0 }}
          transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
        >
          <Plus size={26} weight="bold" />
        </m.span>
      </span>
      <span className="text-[11px] font-semibold text-brand-ink">{label}</span>
    </>
  );

  const shell = cn(
    // `-mt-4`: el disco sube por encima del hairline y la etiqueta queda
    // alineada con las de las otras pestañas.
    "-mt-4 flex flex-col items-center gap-0.5 rounded-full px-2 pb-1.5",
    "transition-transform duration-(--duration-fast) ease-(--ease-spring) active:scale-95",
    "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
  );

  if (!canCreate) {
    return (
      <Link href="/entrar?next=/feed" aria-label={label} className={shell}>
        {face}
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={label}
      aria-haspopup="dialog"
      aria-expanded={open}
      className={shell}
    >
      {face}
    </button>
  );
}
