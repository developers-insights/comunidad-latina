"use client";

import Link from "next/link";
import {
  Briefcase,
  Calendar,
  CaretRight,
  Camera,
  House,
  Question,
  ShoppingBagOpen,
  Sparkle,
  Storefront,
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
 * Menú "crear publicación" — hoja ÚNICA de toda la app.
 *
 * Nació adentro del composer del feed (§b, feedback cliente 2026-07-24) y salió
 * de ahí el 2026-07-29, cuando el "+" del bottom nav pasó a abrir exactamente lo
 * mismo desde cualquier pantalla. Dos hojas distintas con las mismas diez
 * opciones se habrían desincronizado en la primera semana, así que hay una sola
 * y son sus consumidores los que cambian:
 *
 *  · En el feed, el composer está montado y resuelve foto/video/pregunta ahí
 *    mismo (`onQuickPost`): elegís Foto y se abre el selector, sin navegar.
 *  · Desde cualquier otra pantalla no hay composer al que hablarle, así que esas
 *    tres opciones son enlaces a /feed?crear=… y el composer las levanta al
 *    montarse (ver post-composer.tsx). Sigue siendo UN toque para la persona.
 *
 * Los tiles de módulos SÍ se filtran por el panel (`moduleAvailability`): ofrecer
 * "Publicá un producto" con Marketplace apagado es prometer una pantalla que no
 * existe. Los tres primeros no llevan clave — son el feed, que nunca se apaga.
 */

export type QuickPostKind = "photo" | "video" | "question";

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
];

/** Adónde manda una opción rápida cuando NO hay composer montado. */
export function quickPostHref(quick: QuickPostKind): string {
  return `/feed?crear=${quick}`;
}

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
  /**
   * Presente = hay un composer montado que resuelve foto/video/pregunta acá
   * mismo. Ausente = esas tres opciones navegan al feed con `?crear=`.
   */
  onQuickPost?: (quick: QuickPostKind) => void;
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

          // Opción rápida SIN composer montado: enlace real a /feed?crear=…, no
          // un botón que navegue por JS — así conserva "abrir en pestaña nueva",
          // el estado de foco y el atrás del sistema.
          if (tile.action.kind === "quick" && !onQuickPost) {
            return (
              <li key={tile.key}>
                <Link
                  href={quickPostHref(tile.action.quick)}
                  onClick={onClose}
                  className={rowClass}
                >
                  {rowContent}
                </Link>
              </li>
            );
          }

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
                    onQuickPost?.(quick);
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
