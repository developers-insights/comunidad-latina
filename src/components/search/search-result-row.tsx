"use client";

import Link from "next/link";
import { CaretRight } from "@phosphor-icons/react/dist/ssr";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { SEARCH_GROUP_META, type SearchResultItem } from "./helpers";
import { SEARCH_TYPE_ICON } from "./search-icons";

/**
 * Una fila de resultado.
 *
 * Anatomía fija para los nueve tipos: miniatura cuadrada · título · segunda
 * línea · chevron. Que un evento y una persona compartan la silueta es
 * deliberado — es lo que permite recorrer una lista mezclada con la vista sin
 * volver a aprender dónde mirar en cada grupo. Lo que cambia entre tipos es el
 * ACENTO (el color del respaldo cuando no hay foto), no la estructura.
 *
 * `data-search-item` lo usa la navegación por teclado del panel para encontrar
 * las filas reales del DOM sin tener que mantener un arreglo de refs paralelo
 * que se desincroniza en cuanto los grupos cambian entre teclas.
 */
export function SearchResultRow({
  item,
  onNavigate,
}: {
  item: SearchResultItem;
  /** Se dispara al abrir el resultado — el panel lo usa para guardar historial. */
  onNavigate?: () => void;
}) {
  const meta = SEARCH_GROUP_META[item.type];
  const FallbackIcon = SEARCH_TYPE_ICON[item.type];

  return (
    <Link
      href={item.href}
      data-search-item=""
      onClick={onNavigate}
      className={cn(
        "group flex items-center gap-3 rounded-md p-2 min-h-14",
        "transition-[background-color,transform] duration-(--duration-fast) ease-(--ease-spring)",
        "hover:bg-surface-hover active:scale-[0.99]",
        "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
      )}
    >
      <span
        aria-hidden="true"
        className="relative size-12 shrink-0 overflow-hidden rounded-sm bg-surface-subtle"
        style={{ backgroundColor: `color-mix(in oklab, ${meta.accentVar} 10%, transparent)` }}
      >
        {item.media?.kind === "image" && (
          /* <img> y no next/image a propósito: las fuentes son heterogéneas
             (Storage del tenant y URLs absolutas del seed) y son miniaturas de
             48 px que se re-montan con cada tecla — el optimizador no aporta
             nada acá y el host desconocido lo haría reventar en runtime. */
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.media.url}
            alt=""
            loading="lazy"
            decoding="async"
            className="size-full object-cover"
          />
        )}

        {item.media?.kind === "video" && (
          /* Un resultado de "videos" puede traer la ruta del VIDEO y no la de
             una foto (posts.media mezcla los dos sin columna de tipo). El
             `#t=0.1` fuerza al navegador a pintar un fotograma real: sin eso,
             Safari deja un rectángulo negro. */
          <video
            src={`${item.media.url}#t=0.1`}
            muted
            playsInline
            preload="metadata"
            className="size-full object-cover"
          />
        )}

        {!item.media && (
          <span
            className="flex size-full items-center justify-center"
            style={{ color: meta.accentVar }}
          >
            <FallbackIcon size={22} weight="light" />
          </span>
        )}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold leading-snug text-foreground">
          {item.title}
        </span>
        {(item.subtitle || item.sponsored) && (
          <span className="mt-0.5 flex items-center gap-1.5">
            {item.sponsored && (
              /* Honestidad publicitaria: los videos de campañas pagas SÍ
                 aparecen en búsqueda (§4 del contrato) y se dicen. */
              <span className="shrink-0 rounded-full bg-surface-subtle px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-foreground-muted">
                {t("sections", "searchSponsored")}
              </span>
            )}
            {item.subtitle && (
              <span className="truncate text-xs leading-snug text-foreground-secondary">
                {item.subtitle}
              </span>
            )}
          </span>
        )}
      </span>

      <CaretRight
        aria-hidden="true"
        size={16}
        className="shrink-0 text-foreground-muted transition-transform duration-(--duration-fast) ease-(--ease-out-premium) group-hover:translate-x-0.5"
      />
    </Link>
  );
}
