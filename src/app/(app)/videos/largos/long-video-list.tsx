"use client";

import { useState, useTransition } from "react";
import type { PostCardModel } from "@/components/feed";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";
import { VIDEOS_COPY } from "../copy";
import { loadMoreLongVideosAction } from "./actions";
import { LongVideoCard } from "./long-video-card";

/**
 * LA LISTA DE VIDEOS LARGOS, con su "Ver más".
 *
 * Paginación por BOTÓN y no por scroll infinito, y es una decisión de producto:
 * Videos Cortos es un flujo donde el scroll ES el gesto, pero esta sección es un
 * catálogo del que se elige uno y se sale a mirarlo. Un scroll infinito acá
 * pelearía con el "atrás" del teléfono (volvés y perdiste todas las tandas) por
 * una lista que casi nunca va a tener cientos de videos.
 *
 * La primera tanda viene del servidor con la RLS del usuario; las siguientes por
 * server action con el MISMO cursor keyset del feed.
 */

export interface LongVideoListProps {
  initialItems: PostCardModel[];
  initialCursor: string | null;
  /** Tema activo, para que la tanda 2 filtre por lo mismo que la 1. */
  category?: string | null;
  /** El video que se está mirando (en "Más videos largos") no se repite. */
  excludeId?: string | null;
  /**
   * ¿La primera miniatura se pide con prioridad? Sí en la sección, donde es la
   * imagen más grande de la pantalla y casi siempre el LCP. NO debajo del
   * reproductor: ahí la imagen que importa es el poster del video, y competirle
   * el ancho de banda con una miniatura que está fuera de pantalla empeora
   * exactamente lo que se quería mejorar.
   */
  priorityFirst?: boolean;
  className?: string;
}

export function LongVideoList({
  initialItems,
  initialCursor,
  category = null,
  excludeId = null,
  priorityFirst = true,
  className,
}: LongVideoListProps) {
  const [items, setItems] = useState(initialItems);
  const [cursor, setCursor] = useState(initialCursor);
  const [pending, startTransition] = useTransition();

  function loadMore() {
    if (!cursor || pending) return;
    startTransition(async () => {
      const page = await loadMoreLongVideosAction({
        category: category ?? undefined,
        cursor,
        excludeId: excludeId ?? undefined,
      });
      // Sin ids repetidos: dos tandas pueden solaparse si alguien publica entre
      // medio, y una key duplicada en React es una tarjeta que parpadea.
      setItems((current) => {
        const seen = new Set(current.map((item) => item.id));
        return [...current, ...page.items.filter((item) => !seen.has(item.id))];
      });
      setCursor(page.nextCursor);
    });
  }

  return (
    <div className={className}>
      <ul
        aria-label={VIDEOS_COPY.largos.title}
        className="grid grid-cols-1 gap-4 sm:grid-cols-2"
      >
        {items.map((post, index) => (
          <LongVideoCard
            key={post.id}
            post={post}
            first={priorityFirst && index === 0}
          />
        ))}
      </ul>

      {cursor && (
        <div className="mt-5 flex justify-center">
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={loadMore}
            disabled={pending}
            // `aria-live` no: el texto del propio botón cambia, y eso ya lo
            // anuncia el lector cuando el foco está encima.
            className={cn(pending && "opacity-70")}
          >
            {pending ? VIDEOS_COPY.largos.loadingMore : VIDEOS_COPY.largos.loadMore}
          </Button>
        </div>
      )}

      {!cursor && items.length > 0 && (
        <p className="mt-5 text-center text-xs text-foreground-muted">
          {VIDEOS_COPY.largos.endOfList}
        </p>
      )}
    </div>
  );
}
