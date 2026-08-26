"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { ReactNode } from "react";
import { CaretDown } from "@phosphor-icons/react/dist/ssr";
import { buttonVariants, Spinner } from "@/components/ui";
import { ListingCard } from "@/components/listings";
import { Reveal } from "@/components/motion";
import { cn } from "@/lib/utils";
import { fetchFeedPageAction } from "@/app/(app)/feed/load-more";
import { COPY } from "./copy";
import type { FeedScope } from "./feed-scope";
import { FeedListingCard } from "./feed-listing-card";
import { GuideCard } from "./guide-card";
import { PostCard } from "./post-card";
import { PostMenu } from "./post-menu";
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

/**
 * Un ítem del feed → su card. El `tab` viaja hasta PostCard como `videoScope`:
 * los ids de FEED_TABS y de VIDEO_SCOPES son los MISMOS 1:1 (para-ti,
 * propiedades, negocios, profesionales, eventos), así que tocar un video desde
 * el tab "Negocios" abre el reel filtrado a negocios en vez de caer siempre al
 * "para-ti" por default. El scoping ya existe entero del lado del server
 * (videos/helpers.ts + videos/queries.ts) — esto es el eslabón que faltaba.
 *
 * Exportada para el test: fija que el scope llega y no vuelve a perderse.
 */
export function renderFeedItem(
  item: FeedItem,
  tenantId: string,
  viewerId: string | null,
  tab: FeedTabId,
) {
  switch (item.type) {
    case "post":
      return (
        <PostCard
          post={item.post}
          tenantId={tenantId}
          viewerId={viewerId}
          videoScope={tab}
          /**
           * EL MENÚ ⋯ VA EN LA TARJETA DEL FEED, no sólo en el detalle (pedido
           * del cliente con captura de una publicación del feed, 2026-08-13).
           * Es el MISMO componente y el MISMO contrato que monta
           * `/feed/[id]/page.tsx`; los datos que allá salían de la fila cruda
           * viajan acá dentro del modelo (`post.postMenu`), así que no hay una
           * segunda consulta por publicación ni dos versiones del menú.
           *
           * NO NAVEGA AL ABRIRSE, y eso no depende de un `stopPropagation`:
           * depende de que la tarjeta no tenga un enlace que la envuelva. El
           * texto, la foto y el banner llevan su propio disparador (ver el
           * arreglo de `PostCaption`), el botón ⋯ vive suelto en la cabecera, y
           * la hoja se dibuja en un portal fuera de la tarjeta.
           *
           * SIN `redirectAfterDelete`: el detalle tiene que salir porque la
           * página deja de existir; acá alcanza con que el feed se refresque
           * —lo hace el propio menú— y la publicación desaparezca de la lista.
           */
          menu={
            <PostMenu
              postId={item.post.id}
              authorId={item.post.postMenu.authorId}
              viewerId={viewerId}
              postBody={item.post.body}
              postStatus={item.post.postMenu.status}
              // Las RUTAS crudas y no `post.media`: es exactamente lo que mira
              // el detalle (`post.media.length > 0` sobre la fila) y evita que
              // el retrocompat de `photoUrl` cuente como medio para la edición.
              hasMedia={item.post.postMenu.mediaPaths.length > 0}
              media={item.post.postMenu.mediaPaths}
              // La pista ya viaja en el modelo (la pinta la tarjeta): pasarla
              // acá es lo que deja CAMBIARLA sin volver a publicar.
              music={item.post.music}
              commentCount={item.post.commentCount}
              likeCount={item.post.likeCount}
              pinnedAt={item.post.postMenu.pinnedAt}
              hiddenAt={item.post.postMenu.hiddenAt}
              commentsLockedAt={item.post.postMenu.commentsLockedAt}
            />
          }
        />
      );
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
  /**
   * Mitad del feed (spec §8). Viaja hasta acá porque el scroll infinito pide
   * las páginas siguientes por su cuenta: sin esto, la segunda página de
   * «Siguiendo» volvería con contenido de «Para ti» y nadie lo notaría hasta
   * ver publicaciones de gente que no se sigue apareciendo al scrollear.
   */
  scope?: FeedScope;
  tenantId: string;
  viewerId: string | null;
  /** Primera página, ya resuelta server-side (SSR) — se pinta sin animar. */
  initialItems: FeedItem[];
  initialCursor: string | null;
  /**
   * Bloque que se intercala DESPUÉS de las primeras publicaciones, en vez de ir
   * arriba de todo.
   *
   * Nació para "Para vos", que encabezaba el feed: lo primero que veía alguien
   * al abrir la app eran dos avisos recomendados, y el pedido del cliente fue
   * exacto — que al abrir se vea el FEED, y la recomendación aparezca más
   * abajo. Va como prop y no adentro porque quién se intercala es decisión de
   * la página, no de la lista.
   */
  intercalado?: ReactNode;
  /** Después de cuántas publicaciones aparece `intercalado`. */
  intercaladoDespuesDe?: number;
}

/**
 * Cuántas publicaciones se ven antes del bloque intercalado.
 *
 * Cinco es lo que pidió el cliente ("después de la quinta publicación más o
 * menos") y coincide con lo que se ve en un celular antes del primer scroll
 * largo: alcanza para que el feed se lea como feed y no como una vidriera.
 */
export const INTERCALADO_DESPUES_DE = 5;

/**
 * Lista del feed con scroll infinito real (módulo FLUIDEZ): acumula páginas
 * pedidas a `fetchFeedPageAction` (misma server action que arma la primera
 * página en page.tsx), con un sentinel + IntersectionObserver que dispara la
 * siguiente ANTES de que el usuario llegue al fondo real, más un botón
 * "Cargar más" como fallback accesible (teclado, o IO no soportado) — nunca
 * navega ni reemplaza la página como el <Link href="?cursor="> de antes.
 */
export function FeedList({
  tab,
  scope = "para-ti",
  tenantId,
  viewerId,
  initialItems,
  initialCursor,
  intercalado,
  intercaladoDespuesDe = INTERCALADO_DESPUES_DE,
}: FeedListProps) {
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
        const result = await fetchFeedPageAction({ tab, scope, cursor });
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
  }, [isPending, cursor, tab, scope, seenKeys]);

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
          batch.map((item, i) => (
            <Fragment key={feedItemKey(item)}>
              <div className={OFFSCREEN_SKIP_CLASS}>
                {renderFeedItem(item, tenantId, viewerId, tab)}
              </div>
              {/* El bloque intercalado va DESPUÉS de la enésima publicación, no
                  arriba de todo. Si la primera página trae menos que eso, no se
                  fuerza: aparece cuando hay feed suficiente para que tenga
                  sentido, y si no, no aparece — mejor que empujarlo al final de
                  una lista corta, donde volvería a ser lo único que se ve. */}
              {intercalado && i === intercaladoDespuesDe - 1 && intercalado}
            </Fragment>
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
              {renderFeedItem(item, tenantId, viewerId, tab)}
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
