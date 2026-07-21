"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChatCircle,
  FilmSlate,
  Heart,
  Megaphone,
  ShareNetwork,
  SpeakerHigh,
  SpeakerSlash,
} from "@phosphor-icons/react/dist/ssr";
import { createClient } from "@/lib/supabase/client";
import { Avatar, Chip, buttonVariants, useToast } from "@/components/ui";
import { LikeBurst } from "@/components/motion";
import { PublisherTrust, firstNameOf } from "@/components/listings";
import { useCommentsSheet, type PostCardModel } from "@/components/feed";
import { ViewerVideo } from "@/components/feed/media-viewer";
import { useMounted } from "@/lib/design/use-overlay";
import { cn } from "@/lib/utils";
import { loadMoreVideosAction } from "./actions";
import { VIDEO_SCOPES, type VideosScope } from "./helpers";
import { VIDEOS_COPY } from "./copy";

/**
 * Reels vertical (pedido cliente 2026-07-21: "cuando un usuario abre un video
 * no debe regresar al feed al terminar; debe poder hacer scroll vertical para
 * ver el siguiente"). Un video por viewport con snap NATIVO, autoplay del
 * visible y scroll infinito con keyset contra la server action.
 *
 * SONIDO: llegar acá fue un gesto (tap en la nav o en un video), así que se
 * intenta reproducir CON audio. Si el navegador lo rechaza (política de
 * autoplay), ViewerVideo cae a mudo y el botón de sonido del riel queda a un
 * tap — ese tap sí desbloquea el audio para todos los que siguen.
 *
 * LAYOUT: la página vive en un contenedor `fixed` a pantalla completa POR
 * DEBAJO del header y el bottom nav (z-30 < z-40): la app sigue presente y se
 * puede salir por la nav, y el video corre edge-to-edge por detrás del blur.
 * Así no hay que pelear con el max-w-lg del layout compartido.
 */

const NEAR_END_THRESHOLD = 3;

export interface VideoReelsProps {
  tenantId: string;
  viewerId: string | null;
  scope: VideosScope;
  initialItems: PostCardModel[];
  initialCursor: string | null;
}

export function VideoReels({
  tenantId,
  viewerId,
  scope,
  initialItems,
  initialCursor,
}: VideoReelsProps) {
  const [items, setItems] = useState<PostCardModel[]>(initialItems);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [activeIndex, setActiveIndex] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  // Sonido compartido entre slides: silenciar uno silencia el reel entero
  // (comportamiento estándar de Instagram/TikTok).
  const [muted, setMuted] = useState(false);
  const loadingRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Índice activo desde el scroll: slides de altura exacta del contenedor →
  // la cuenta es exacta y no hace falta IntersectionObserver.
  const onScroll = useCallback(() => {
    const node = scrollRef.current;
    if (!node || node.clientHeight === 0) return;
    const next = Math.round(node.scrollTop / node.clientHeight);
    setActiveIndex((current) => (current === next ? current : next));
  }, []);

  const loadMore = useCallback(async () => {
    if (loadingRef.current) return;
    const current = cursor;
    if (!current) return;
    loadingRef.current = true;
    setLoadingMore(true);
    try {
      const page = await loadMoreVideosAction({ scope, cursor: current });
      setItems((prev) => {
        const seen = new Set(prev.map((item) => item.id));
        return [...prev, ...page.items.filter((item) => !seen.has(item.id))];
      });
      setCursor(page.nextCursor);
    } catch {
      // Falla de red: cortamos el scroll infinito en vez de reintentar en loop.
      setCursor(null);
    } finally {
      loadingRef.current = false;
      setLoadingMore(false);
    }
  }, [cursor, scope]);

  // Prefetch: al acercarse al final (o si la primera página vino corta porque
  // el escaneo agotó su tope), pedimos la siguiente tanda. Diferido con un
  // timeout: desacopla el setState del cuerpo del efecto (regla react-hooks)
  // y de paso amortigua ráfagas de scroll.
  useEffect(() => {
    if (!cursor) return;
    if (items.length - activeIndex > NEAR_END_THRESHOLD) return;
    const timer = setTimeout(() => {
      void loadMore();
    }, 0);
    return () => clearTimeout(timer);
  }, [activeIndex, cursor, items.length, loadMore]);

  const isEmpty = items.length === 0 && !cursor && !loadingMore;

  // PORTAL a <body> (mismo patrón que MediaViewer): el template de página
  // anima con transform y un ancestro transformado convierte `fixed` en un
  // posicionamiento relativo a él — los reels medían 358×0 dentro de la
  // columna. Fuera del árbol de la página, el fixed vuelve a ser viewport.
  const mounted = useMounted();
  if (!mounted) return null;

  return createPortal(
    <div
      className="cl-print-hide fixed inset-x-0 bottom-0 top-0 z-30 bg-media-shade"
      aria-label={VIDEOS_COPY.feedLabel}
    >
      <h1 className="sr-only">{VIDEOS_COPY.title}</h1>

      {isEmpty ? (
        <EmptyReels />
      ) : (
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className={cn(
            "h-full w-full snap-y snap-mandatory overflow-y-auto overscroll-contain",
            "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          )}
        >
          {items.map((post, index) => (
            <ReelSlide
              key={post.id}
              post={post}
              tenantId={tenantId}
              viewerId={viewerId}
              active={index === activeIndex}
              muted={muted}
              onMutedChange={setMuted}
            />
          ))}
        </div>
      )}

      <ScopeChips active={scope} />

      {loadingMore && (
        <p
          role="status"
          className="absolute bottom-[calc(4.5rem+env(safe-area-inset-bottom))] left-1/2 z-20 -translate-x-1/2 rounded-full bg-media-scrim px-3.5 py-1.5 text-xs font-medium text-on-media"
        >
          {VIDEOS_COPY.loadingMore}
        </p>
      )}
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// Chips de scope (mismo lenguaje que los tabs del feed, sobre el video)
// ---------------------------------------------------------------------------

function ScopeChips({ active }: { active: VideosScope }) {
  return (
    <nav
      aria-label={VIDEOS_COPY.scopes.ariaLabel}
      className="pointer-events-none absolute inset-x-0 top-16 z-20"
    >
      <div
        className={cn(
          "pointer-events-auto mx-auto flex w-full max-w-lg items-center gap-2 overflow-x-auto px-4 py-1",
          "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        )}
      >
        {VIDEO_SCOPES.map((scope) => {
          const isActive = scope.id === active;
          return (
            <Link
              key={scope.id}
              href={scope.id === "para-ti" ? "/videos" : `/videos?scope=${scope.id}`}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "inline-flex min-h-11 shrink-0 items-center rounded-full px-4 text-sm font-semibold",
                "transition-colors duration-(--duration-fast)",
                "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-on-media/60",
                isActive
                  ? "bg-on-media text-media-shade"
                  : "bg-media-scrim text-on-media hover:bg-media-shade/70",
              )}
            >
              {VIDEOS_COPY.scopes[scope.id]}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Un slide = un video con su overlay (autor + cuerpo + acciones)
// ---------------------------------------------------------------------------

function ReelSlide({
  post,
  tenantId,
  viewerId,
  active,
  muted,
  onMutedChange,
}: {
  post: PostCardModel;
  tenantId: string;
  viewerId: string | null;
  active: boolean;
  muted: boolean;
  onMutedChange: (muted: boolean) => void;
}) {
  const videoUrl = post.media.find((item) => item.kind === "video")?.url;
  const entity = post.entity;
  const displayTitle = entity ? entity.title : post.author.displayName;

  if (!videoUrl) return null; // la query garantiza video; defensa barata

  return (
    <section
      aria-label={VIDEOS_COPY.videoOf(displayTitle)}
      className="relative h-full w-full snap-start snap-always"
    >
      <div className="mx-auto h-full w-full max-w-lg">
        <ViewerVideo
          url={videoUrl}
          active={active}
          muted={muted}
          onMutedChange={onMutedChange}
          authorLabel={displayTitle}
          fit="cover"
          showMute={false}
          // La barra de progreso queda por ENCIMA del bottom nav (z-40 fijo).
          controlsClassName="pb-[calc(4rem+env(safe-area-inset-bottom))]"
        />
      </div>

      {/* Chip honesto de campaña paga (igual que la card del feed) */}
      {post.isPromoted && (
        <div className="pointer-events-none absolute right-4 top-[7.25rem] z-10">
          <Chip variant="brand" size="sm">
            <Megaphone size={14} weight="fill" aria-hidden="true" />
            {VIDEOS_COPY.adChip}
          </Chip>
        </div>
      )}

      {/* Info del autor + cuerpo, sobre el degradado del propio ViewerVideo */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 pb-[calc(6.25rem+env(safe-area-inset-bottom))]">
        <div className="mx-auto w-full max-w-lg px-4 pr-20">
          <div className="pointer-events-auto flex items-center gap-2.5">
            <Avatar
              size="sm"
              name={displayTitle}
              src={entity ? null : post.author.avatarUrl}
            />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-on-media drop-shadow-md">
                {displayTitle}
              </p>
              <div className="flex min-w-0 items-center gap-1.5">
                {entity ? (
                  <p className="truncate text-xs text-on-media/85 drop-shadow-md">
                    {VIDEOS_COPY.byAuthor(post.author.displayName)}
                  </p>
                ) : (
                  post.author.profileId && (
                    <span className="inline-flex rounded-full bg-media-scrim px-1.5 py-0.5">
                      <PublisherTrust
                        displayName={post.author.displayName}
                        firstName={firstNameOf(post.author.displayName)}
                        score={post.author.score}
                        level={post.author.level}
                        signals={post.author.signals}
                        size="inline"
                      />
                    </span>
                  )
                )}
                <span className="shrink-0 text-xs text-on-media/70 drop-shadow-md">
                  {post.timeAgoLabel}
                </span>
              </div>
            </div>
          </div>
          {post.body && (
            <p className="mt-2 line-clamp-2 text-sm leading-snug text-on-media drop-shadow-md">
              {post.body}
            </p>
          )}
        </div>
      </div>

      {/* Riel de acciones (like optimista + comentarios + compartir + sonido) */}
      <ReelActions
        post={post}
        tenantId={tenantId}
        viewerId={viewerId}
        muted={muted}
        onMutedChange={onMutedChange}
      />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Riel derecho — mismo like optimista que el feed (insert/delete en reactions;
// los triggers de DB mantienen like_count). Patrón espejado de post-actions.
// ---------------------------------------------------------------------------

const railButtonClass = cn(
  "pointer-events-auto flex min-h-11 min-w-11 flex-col items-center justify-center gap-0.5 text-on-media drop-shadow-md",
  "transition-transform duration-(--duration-fast) ease-(--ease-spring) active:scale-[0.9]",
  "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-on-media/60 rounded-md",
);

function ReelActions({
  post,
  tenantId,
  viewerId,
  muted,
  onMutedChange,
}: {
  post: PostCardModel;
  tenantId: string;
  viewerId: string | null;
  muted: boolean;
  onMutedChange: (muted: boolean) => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const commentsSheet = useCommentsSheet();
  const [liked, setLiked] = useState(post.likedByViewer);
  const [count, setCount] = useState(post.likeCount);

  function toggleLike(nextLiked: boolean) {
    if (!viewerId) {
      router.push(`/entrar?next=${encodeURIComponent("/videos")}`);
      return;
    }
    // Optimista: la UI responde al instante; si la DB dice que no, se revierte.
    setLiked(nextLiked);
    setCount((current) => Math.max(0, current + (nextLiked ? 1 : -1)));
    try {
      navigator.vibrate?.(10);
    } catch {
      // sin soporte háptico
    }
    void (async () => {
      const supabase = createClient();
      if (nextLiked) {
        const { error } = await supabase.from("reactions").insert({
          tenant_id: tenantId,
          subject_kind: "post",
          subject_id: post.id,
          profile_id: viewerId,
          kind: "like",
        });
        // 23505 = la reacción ya existía (doble tap): el estado ya es correcto.
        if (error && error.code !== "23505") {
          setLiked(false);
          setCount((current) => Math.max(0, current - 1));
        }
      } else {
        const { error } = await supabase
          .from("reactions")
          .delete()
          .eq("subject_kind", "post")
          .eq("subject_id", post.id)
          .eq("profile_id", viewerId);
        if (error) {
          setLiked(true);
          setCount((current) => current + 1);
        }
      }
    })();
  }

  async function share() {
    const url = `${window.location.origin}/feed/${post.id}`;
    try {
      if (navigator.share) {
        await navigator.share({ url });
        return;
      }
      await navigator.clipboard.writeText(url);
      toast({
        title: VIDEOS_COPY.shareCopiedTitle,
        description: VIDEOS_COPY.shareCopiedBody,
        variant: "success",
      });
    } catch {
      // El usuario canceló el share nativo — no es un error.
    }
  }

  return (
    <div className="pointer-events-none absolute bottom-[calc(6.25rem+env(safe-area-inset-bottom))] right-2 z-10 flex flex-col items-center gap-3">
      <span className={cn("flex", liked && "text-danger")}>
        <LikeBurst
          active={liked}
          onToggle={toggleLike}
          label={liked ? VIDEOS_COPY.unlike : VIDEOS_COPY.like}
          particleColor="var(--color-danger)"
          className={cn(railButtonClass, liked && "text-danger")}
        >
          <Heart size={26} weight={liked ? "fill" : "regular"} aria-hidden="true" />
          <span className="numeric text-xs font-medium">{count}</span>
        </LikeBurst>
      </span>

      <button
        type="button"
        onClick={() =>
          commentsSheet.open({ postId: post.id, commentCount: post.commentCount })
        }
        aria-label={`${VIDEOS_COPY.comments} (${post.commentCount})`}
        className={railButtonClass}
      >
        <ChatCircle size={26} aria-hidden="true" />
        <span className="numeric text-xs font-medium">{post.commentCount}</span>
      </button>

      <button
        type="button"
        onClick={share}
        aria-label={VIDEOS_COPY.share}
        className={railButtonClass}
      >
        <ShareNetwork size={26} aria-hidden="true" />
      </button>

      <button
        type="button"
        onClick={() => onMutedChange(!muted)}
        aria-label={muted ? VIDEOS_COPY.unmute : VIDEOS_COPY.mute}
        aria-pressed={!muted}
        className={railButtonClass}
      >
        {muted ? (
          <SpeakerSlash size={26} aria-hidden="true" />
        ) : (
          <SpeakerHigh size={26} aria-hidden="true" />
        )}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Estado vacío — cálido y con salida clara (publicar desde el feed)
// ---------------------------------------------------------------------------

function EmptyReels() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4 px-8 text-center">
      <FilmSlate size={44} className="text-on-media/70" aria-hidden="true" />
      <div>
        <h2 className="font-display text-lg font-bold text-on-media">
          {VIDEOS_COPY.emptyTitle}
        </h2>
        <p className="mt-1.5 text-sm leading-relaxed text-on-media/80">
          {VIDEOS_COPY.emptyMessage}
        </p>
      </div>
      <Link href="/feed" className={buttonVariants({ variant: "primary", size: "md" })}>
        {VIDEOS_COPY.emptyCta}
      </Link>
    </div>
  );
}
