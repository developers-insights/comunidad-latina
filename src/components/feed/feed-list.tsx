"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { CaretDown } from "@phosphor-icons/react/dist/ssr";
import { buttonVariants, Spinner } from "@/components/ui";
import { ListingCard } from "@/components/listings";
import { Reveal } from "@/components/motion";
import { cn } from "@/lib/utils";
import { fetchFeedPageAction } from "@/app/(app)/feed/load-more";
import { COPY } from "./copy";
import { FeedListingCard } from "./feed-listing-card";
import { GuideCard } from "./guide-card";
import { PostCard } from "./post-card";
import { PostCardSkeleton } from "./skeletons";
import type { FeedItem, FeedTabId } from "./helpers";

/**
 * Perf del scroll (§ pedido cliente: fluido, no un clasificado que repagina):
 * mientras el ítem está lejos del viewport, el browser se salta layout/paint
 * de sus hijos y le atribuye esta altura de placeholder — cuando se acerca,
 * lo mide y pinta de verdad. 600px es un promedio razonable entre una card de
 * post (foto 4:5 + header + acciones) y una de listing (foto 16:9, más baja);
 * el único costo de no acertar exacto es un reacomodo mínimo del scrollbar la
 * PRIMERA vez que cada card entra en rango, nunca un salto visible de layout
 * (los aspect-ratio de las fotos ya reservan su espacio real).
 */
const OFFSCREEN_SKIP_CLASS = "[content-visibility:auto] [contain-intrinsic-size:0_600px]";

/**
 * Clave estable por ítem — MISMA convención que usaba el .map() de page.tsx
 * (post-/listing-/guide-<slug> ya viene armado en el merge del server). Sirve
 * de `key` de React Y de identidad para el dedupe entre páginas.
 */
export function feedItemKey(item: FeedItem): string {
  switch (item.type) {
    case "post":
      return `post-${item.id}`;
    case "listing-property":
    case "listing":
      return `listing-${item.id}`;
    case "guide":
      return item.id;
  }
}

/**
 * Agrega una página nueva al acumulado sin duplicados. La paginación keyset
 * del server ya debería ser exacta (nunca repite un id entre páginas), pero
 * esto es la red de seguridad de la UI: si algo raro pasa (un dato republicado
 * justo en el borde del cursor, un retry manual, etc.) un mismo post no
 * aparece dos veces en pantalla.
 */
export function mergeFeedItems(existing: FeedItem[], incoming: FeedItem[]): FeedItem[] {
  const seen = new Set(existing.map(feedItemKey));
  const fresh = incoming.filter((item) => !seen.has(feedItemKey(item)));
  return fresh.length > 0 ? [...existing, ...fresh] : existing;
}

function renderFeedItem(item: FeedItem, tenantId: string, viewerId: string | null) {
  switch (item.type) {
    case "post":
      return <PostCard post={item.post} tenantId={tenantId} viewerId={viewerId} />;
    case "listing-property":
      return <ListingCard listing={item.listing} />;
    case "listing":
      return <FeedListingCard listing={item.listing} />;
    case "guide":
      return <GuideCard guide={item.guide} />;
  }
}

export interface FeedListProps {
  tab: FeedTabId;
  tenantId: string;
  viewerId: string | null;
  /** Primera página, ya resuelta server-side (SSR) — se pinta sin animar. */
  initialItems: FeedItem[];
  initialCursor: string | null;
}

/**
 * Lista del feed con scroll infinito real (módulo FLUIDEZ): acumula páginas
 * pedidas a `fetchFeedPageAction` (misma server action que arma la primera
 * página en page.tsx), con un sentinel + IntersectionObserver que dispara la
 * siguiente ANTES de que el usuario llegue al fondo real, más un botón
 * "Cargar más" como fallback accesible (teclado, o IO no soportado) — nunca
 * navega ni reemplaza la página como el <Link href="?cursor="> de antes.
 */
export function FeedList({ tab, tenantId, viewerId, initialItems, initialCursor }: FeedListProps) {
  const [batches, setBatches] = useState<FeedItem[][]>([initialItems]);
  const [cursor, setCursor] = useState(initialCursor);
  const [hadError, setHadError] = useState(false);
  const [isPending, startTransition] = useTransition();
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // El pull-to-refresh (pull-to-refresh.tsx) dispara router.refresh(): el
  // server vuelve a correr page.tsx y nos llega un `initialItems` NUEVO (otra
  // referencia). Lo detectamos comparando identidad — sin esto, el refresh de
  // arriba solo agregaría una página más al acumulado viejo en vez de
  // reemplazarlo. Patrón de React "ajustar estado cuando cambia una prop"
  // durante el render (sin useEffect): evita un frame de parpadeo con el
  // acumulado viejo antes de resetear.
  const [seedItems, setSeedItems] = useState(initialItems);
  if (initialItems !== seedItems) {
    setSeedItems(initialItems);
    setBatches([initialItems]);
    setCursor(initialCursor);
    setHadError(false);
  }

  const seenKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const batch of batches) {
      for (const item of batch) keys.add(feedItemKey(item));
    }
    return keys;
  }, [batches]);

  const loadMore = useCallback(() => {
    if (isPending || cursor === null) return;
    startTransition(async () => {
      try {
        const result = await fetchFeedPageAction({ tab, cursor });
        const fresh = result.items.filter((item) => !seenKeys.has(feedItemKey(item)));
        if (fresh.length > 0) {
          setBatches((prev) => [...prev, fresh]);
        }
        setCursor(result.nextCursor);
        setHadError(false);
      } catch {
        // "Failed to find Server Action" tras un deploy, conexión floja, etc.
        // (server-actions.md): nunca un error duro — se ofrece reintentar.
        setHadError(true);
      }
    });
  }, [isPending, cursor, tab, seenKeys]);

  // Sentinel con rootMargin generoso: dispara la carga ANTES de que el
  // usuario vea el fondo real (se siente "infinito", nunca un salto brusco).
  useEffect(() => {
    if (cursor === null) return;
    const node = sentinelRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMore();
      },
      { rootMargin: "600px 0px" },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [cursor, loadMore]);

  return (
    <>
      {batches.map((batch, batchIndex) =>
        batchIndex === 0 ? (
          // Primera pantalla (SSR): se pinta instantánea, sin animar — el
          // pedido del cliente es que el feed se sienta RÁPIDO, y una entrada
          // fade en el contenido que ya está resuelto en el HTML se leería
          // como que "tarda en aparecer".
          batch.map((item) => (
            <div key={feedItemKey(item)} className={OFFSCREEN_SKIP_CLASS}>
              {renderFeedItem(item, tenantId, viewerId)}
            </div>
          ))
        ) : (
          // Páginas siguientes (scroll infinito): stagger MUY leve — nada
          // teatral, solo un indicio cálido de que llegó contenido nuevo.
          batch.map((item, i) => (
            <Reveal
              key={feedItemKey(item)}
              y={10}
              delay={Math.min(i, 5) * 45}
              className={OFFSCREEN_SKIP_CLASS}
            >
              {renderFeedItem(item, tenantId, viewerId)}
            </Reveal>
          ))
        ),
      )}

      {cursor !== null && (
        <div ref={sentinelRef} aria-hidden="true" className="h-px w-full" />
      )}

      {isPending && (
        <div aria-hidden="true">
          <PostCardSkeleton />
        </div>
      )}

      {hadError && (
        <div
          role="alert"
          className="flex flex-col items-center gap-3 rounded-lg border border-border-subtle bg-surface p-5 text-center"
        >
          <p className="text-sm font-semibold text-foreground">
            {COPY.feed.loadMoreErrorTitle}
          </p>
          <p className="text-sm text-foreground-secondary">{COPY.feed.loadMoreErrorBody}</p>
          <button
            type="button"
            onClick={loadMore}
            disabled={isPending}
            aria-busy={isPending}
            className={cn(buttonVariants({ variant: "secondary", size: "md" }), "min-h-11")}
          >
            {isPending && <Spinner size={16} />}
            {COPY.feed.retry}
          </button>
        </div>
      )}

      {!hadError && cursor !== null && (
        <button
          type="button"
          onClick={loadMore}
          disabled={isPending}
          aria-busy={isPending}
          className={cn(buttonVariants({ variant: "outline", size: "md" }), "min-h-11 w-full")}
        >
          {isPending ? <Spinner size={16} /> : <CaretDown size={16} aria-hidden="true" />}
          {isPending ? COPY.feed.loadingMore : COPY.feed.loadMore}
        </button>
      )}
    </>
  );
}
