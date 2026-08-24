"use client";

import Link from "next/link";
import {
  Briefcase,
  Calendar,
  CaretRight,
  Camera,
  House,
  Megaphone,
  Question,
  ShoppingBagOpen,
  Sparkle,
  Storefront,
  TextAa,
  VideoCamera,
  Wrench,
} from "@phosphor-icons/react/dist/ssr";
import type { Icon } from "@phosphor-icons/react";
import { BottomSheet } from "@/components/ui";
import { COPY } from "@/components/feed/copy";
import { entityAccentVar } from "@/components/feed/helpers";
import { cn } from "@/lib/utils";
import { moduleAvailability } from "./module-access";

/**
 * Menú "crear publicación" — hoja ÚNICA de toda la app, montada UNA vez por
 * `PostComposerHost` (`@/components/feed/post-composer.tsx`) en el shell.
 *
 * Nació adentro del composer del feed (§b, feedback cliente 2026-07-24) y el
 * 2026-07-29 pasó a abrirse también desde el "+" del bottom nav. Hasta el
 * 2026-08-13 eso significaba DOS caminos para foto/video/pregunta: con el
 * composer montado (feed) resolvían ahí mismo (`onQuickPost`); sin él (otra
 * pantalla) navegaban a /feed?crear=… y el composer las retomaba al montarse
 * — y ESE segundo camino perdía el gesto de usuario que abre el selector de
 * archivos en varios navegadores (Safari, sobre todo). Con el estado en el
 * shell (`PostComposerHost` envuelve TODA la app), `onQuickPost` es ahora el
 * ÚNICO camino: no importa desde qué pantalla se abrió este menú, foto/video
 * disparan el input oculto en el mismo toque, siempre.
 *
 * Los tiles de módulos SÍ se filtran por el panel (`moduleAvailability`): ofrecer
 * "Publicá un producto" con Marketplace apagado es prometer una pantalla que no
 * existe. Los tres primeros no llevan clave — son el feed, que nunca se apaga.
 */

/**
 * Copy local del tile "Boost" (feedback cliente Geovanny, 2026-08-05: "en
 * esta sección [menú de publicar] faltaría la parte donde dice Boost"; pedido
 * Manuel 2026-08-11: el tile pasa a llamarse Boost, igual que la octava
 * sección de /buscar — un solo nombre para la misma compra en toda la app).
 *
 */

export type QuickPostKind = "photo" | "video" | "text" | "question";

type CreateMenuAction =
  | { kind: "quick"; quick: QuickPostKind }
  | { kind: "link"; href: string };

interface CreateMenuTile {
  key: string;
  title: string;
  description: string;
  accent: string;
  Icon: Icon;
  action: CreateMenuAction;
  /** Clave en `tenants.modules`; ausente = siempre disponible. */
  moduleKey?: string;
}

const CREATE_MENU_TILES: CreateMenuTile[] = [
  {
    key: "photo",
    ...COPY.composer.createMenu.tiles.photo,
    accent: "var(--accent-feed)",
    Icon: Camera,
    action: { kind: "quick", quick: "photo" },
  },
  {
    key: "video",
    ...COPY.composer.createMenu.tiles.video,
    accent: "var(--accent-feed)",
    Icon: VideoCamera,
    action: { kind: "quick", quick: "video" },
  },
  {
    key: "text",
    ...COPY.composer.createMenu.tiles.text,
    accent: "var(--accent-feed)",
    Icon: TextAa,
    action: { kind: "quick", quick: "text" },
  },
  {
    key: "question",
    ...COPY.composer.createMenu.tiles.question,
    accent: "var(--accent-feed)",
    Icon: Question,
    action: { kind: "quick", quick: "question" },
  },
  {
    key: "property",
    ...COPY.composer.createMenu.tiles.property,
    accent: entityAccentVar("property"),
    Icon: House,
    action: { kind: "link", href: "/publicar?kind=property" },
    moduleKey: "propiedades",
  },
  {
    key: "business",
    ...COPY.composer.createMenu.tiles.business,
    accent: entityAccentVar("business"),
    Icon: Storefront,
    action: { kind: "link", href: "/publicar?kind=business" },
    moduleKey: "negocios",
  },
  {
    key: "professional",
    ...COPY.composer.createMenu.tiles.professional,
    accent: entityAccentVar("professional"),
    Icon: Briefcase,
    action: { kind: "link", href: "/publicar?kind=professional" },
    moduleKey: "profesionales",
  },
  {
    key: "event",
    ...COPY.composer.createMenu.tiles.event,
    accent: entityAccentVar("event"),
    Icon: Calendar,
    action: { kind: "link", href: "/publicar?kind=event" },
    moduleKey: "eventos",
  },
  {
    key: "job",
    ...COPY.composer.createMenu.tiles.job,
    accent: entityAccentVar("job"),
    Icon: Wrench,
    action: { kind: "link", href: "/empleos/publicar" },
    moduleKey: "empleos",
  },
  {
    key: "product",
    ...COPY.composer.createMenu.tiles.product,
    accent: "var(--accent-marketplace)",
    Icon: ShoppingBagOpen,
    action: { kind: "link", href: "/marketplace/publicar" },
    moduleKey: "marketplace",
  },
  {
    key: "creatorService",
    ...COPY.composer.createMenu.tiles.creatorService,
    accent: "var(--accent-creadores)",
    Icon: Sparkle,
    action: { kind: "link", href: "/creadores/publicar" },
    moduleKey: "creadores",
  },
  {
    key: "impulsar",
    ...COPY.composer.createMenu.tiles.boost,
    // Dorado de contenido patrocinado (§ globals.css --color-sponsored): esta
    // fila ES publicidad paga, así que se tiñe con el mismo acento que el
    // contorno/chip que ve el resto de la comunidad — nunca uno de los
    // acentos por módulo, que identifican una VERTICAL, no una compra.
    accent: "var(--color-sponsored)",
    Icon: Megaphone,
    action: { kind: "link", href: "/impulsar" },
    // Sin moduleKey: promocionar lo propio no es un módulo que un tenant
    // pueda apagar (a diferencia de Marketplace o Creadores) — siempre activo,
    // igual que las cuatro opciones rápidas de arriba.
  },
];

/** Chip de ícono tintado (14% del acento) — mismo lenguaje visual que AccentLink. */
export function TileIconChip({
  accent,
  Icon: TileIcon,
  size = 44,
}: {
  accent: string;
  Icon: Icon;
  size?: number;
}) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        backgroundColor: `color-mix(in oklab, ${accent} 14%, transparent)`,
        color: accent,
      }}
      className="flex shrink-0 items-center justify-center rounded-full"
    >
      <TileIcon size={Math.round(size * 0.5)} weight="bold" />
    </span>
  );
}

export interface CreateMenuProps {
  open: boolean;
  onClose: () => void;
  /** `tenants.modules` / `modules_soon` del request. */
  modules: Record<string, boolean>;
  modulesSoon: Record<string, boolean>;
  /** Resuelve foto/video/pregunta sin navegar (ver el docblock de arriba). */
  onQuickPost: (quick: QuickPostKind) => void;
}

export function CreateMenu({
  open,
  onClose,
  modules,
  modulesSoon,
  onQuickPost,
}: CreateMenuProps) {
  const tiles = CREATE_MENU_TILES.filter(
    (tile) => moduleAvailability(tile.moduleKey, modules, modulesSoon) === "active",
  );

  return (
    <BottomSheet open={open} onClose={onClose} title={COPY.composer.createMenu.sheetTitle}>
      <ul className="flex flex-col gap-0.5 pb-2">
        {tiles.map((tile) => {
          const rowClass = cn(
            "flex w-full items-center gap-3 rounded-lg p-2.5 text-left",
            "transition-colors duration-(--duration-fast) ease-(--ease-spring)",
            "hover:bg-surface-subtle active:scale-[0.99]",
            "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
          );
          const rowContent = (
            <>
              <TileIconChip accent={tile.accent} Icon={tile.Icon} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-foreground">{tile.title}</span>
                <span className="block text-xs text-foreground-secondary">
                  {tile.description}
                </span>
              </span>
              {tile.action.kind === "link" && (
                <CaretRight size={16} aria-hidden="true" className="shrink-0 text-foreground-muted" />
              )}
            </>
          );

          return (
            <li key={tile.key}>
              {tile.action.kind === "link" ? (
                <Link href={tile.action.href} onClick={onClose} className={rowClass}>
                  {rowContent}
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    const { quick } = tile.action as { quick: QuickPostKind };
                    onClose();
                    onQuickPost(quick);
                  }}
                  className={rowClass}
                >
                  {rowContent}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </BottomSheet>
  );
}
