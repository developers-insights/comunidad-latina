"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import {
  BookmarkSimple,
  ChatCircle,
  FilmSlate,
  Heart,
  Megaphone,
  ShareNetwork,
  SlidersHorizontal,
  SpeakerHigh,
  SpeakerSlash,
} from "@phosphor-icons/react/dist/ssr";
import { createClient } from "@/lib/supabase/client";
import {
  AUTH_REASON,
  useAuthSheetOpen,
  useRequireAuth,
} from "@/components/auth/auth-sheet";
import { Avatar, Chip, buttonVariants, useToast } from "@/components/ui";
import { LikeBurst, usePrefersReducedMotion } from "@/components/motion";
import { PublisherTrust, firstNameOf } from "@/components/listings";
import { useCommentsSheet, type PostCardModel } from "@/components/feed";
import { ViewerVideo } from "@/components/feed/media-viewer";
/**
 * De `post-music` se importa por RUTA DIRECTA y no por el barril del feed a
 * propósito: el barril arrastra la hoja de comentarios entera (Supabase + las
 * actions del marketplace) y este módulo sólo necesita el reproductor de la
 * pista. Es el mismo criterio con el que ya entra `ViewerVideo` de acá al lado.
 */
import { PostMusicProvider, usePostMusic } from "@/components/feed/post-music";
import { MusicBadge } from "@/components/feed/music-badge";
import heartStyles from "@/components/feed/card-post-media.module.css";
import {
  recordPostViewAction,
  toggleSaveAction,
} from "@/app/(app)/feed/engagement-actions";
import { attributionLine } from "@/lib/media/audio-track";
import { useMounted } from "@/lib/design/use-overlay";
import { useFirmaActiva } from "@/lib/perfil-activo/firma-activa";
import { cn } from "@/lib/utils";
import {
  isEligibleForShortFeed,
  playbackCapSeconds,
  type VideoCategory,
} from "@/lib/media/video-policy";
import { loadMoreVideosAction } from "./actions";
import { ALL_CATEGORIES, type VideoCategoryFilter, type VideosScope } from "./helpers";
import { VIDEOS_COPY, VIDEO_CATEGORY_LABELS } from "./copy";

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

/**
 * SEGUNDA LLAVE del scroll. La query ya trae sólo cortos elegibles; esto vuelve
 * a preguntarlo con el mismo módulo de política antes de montar un slide. Es
 * barato y cubre el caso que no se ve venir: una lista que llegue por otro
 * camino (una acción nueva, un fixture) no puede convertir el reel en el lugar
 * donde termina un video publicitario de 10 minutos.
 */
function reelPlayable(post: PostCardModel): boolean {
  return isEligibleForShortFeed({
    videoType: post.videoType,
    eligibleForShortFeed: post.eligibleForShortFeed,
    hasVideoMedia: post.media.some((item) => item.kind === "video"),
    durationSeconds: post.durationSeconds,
    isPaidAd: post.isPaidAd,
  });
}

export interface VideoReelsProps {
  tenantId: string;
  viewerId: string | null;
  scope: VideosScope;
  /** Tema elegido en el menú de entrada (para la cabecera y el scroll infinito). */
  category?: VideoCategoryFilter | null;
  initialItems: PostCardModel[];
  initialCursor: string | null;
}

export function VideoReels({
  tenantId,
  viewerId,
  scope,
  category = null,
  initialItems,
  initialCursor,
}: VideoReelsProps) {
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

      {/* Qué se está viendo + la salida al menú. Llegar por el menú y no poder
          volver a él sin el botón del sistema sería un callejón: la categoría
          es un filtro, y un filtro siempre tiene que poder deshacerse. */}
      {category && <ReelCategoryBar category={category} />}

      <ReelStream
        tenantId={tenantId}
        viewerId={viewerId}
        scope={scope}
        category={category}
        initialItems={initialItems}
        initialCursor={initialCursor}
        surface="page"
      />
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// El scroll de videos, sin el marco — lo comparten la SECCIÓN y el OVERLAY
// ---------------------------------------------------------------------------

/**
 * DÓNDE ESTÁ MONTADO EL SCROLL, y lo único que cambia entre los dos lugares:
 * cuánto espacio hay que dejar libre abajo.
 *
 *  · `page` — la sección `/videos`. El contenedor vive POR DEBAJO del header y
 *    del bottom nav (z-30 < z-40), así que las acciones y la barra de progreso
 *    tienen que despejar la nav o quedan tapadas por ella.
 *  · `overlay` — el reel que abre un toque en el feed. Va ENCIMA de todo
 *    (z-[60]), tapa la nav, y el borde inferior de la pantalla es suyo.
 *
 * Es un mapa de clases y no dos componentes porque la diferencia es exactamente
 * ésta: mismos slides, mismo scroll, mismas acciones, distinto piso.
 */
export type ReelSurface = "page" | "overlay";

export interface ReelOffsets {
  videoControls: string;
  rail: string;
  caption: string;
  status: string;
  adChip: string;
}

const REEL_SURFACE: Record<ReelSurface, ReelOffsets> = {
  page: {
    videoControls: "pb-[calc(4rem+env(safe-area-inset-bottom))]",
    rail: "bottom-[calc(6.25rem+env(safe-area-inset-bottom))]",
    caption: "pb-[calc(6.25rem+env(safe-area-inset-bottom))]",
    status: "bottom-[calc(4.5rem+env(safe-area-inset-bottom))]",
    adChip: "top-[7.25rem]",
  },
  overlay: {
    videoControls: "pb-[calc(1.5rem+env(safe-area-inset-bottom))]",
    rail: "bottom-[calc(3.5rem+env(safe-area-inset-bottom))]",
    caption: "pb-[calc(3.5rem+env(safe-area-inset-bottom))]",
    status: "bottom-[calc(1.25rem+env(safe-area-inset-bottom))]",
    adChip: "top-[4.75rem]",
  },
};

/**
 * CUÁNTOS SLIDES MANTIENEN UN `<video>` VIVO alrededor del activo.
 *
 * 1 = el de arriba, el de abajo y el que se está viendo. Los demás siguen
 * OCUPANDO su lugar en el scroll (el índice activo se calcula por posición, así
 * que un slide que midiera distinto desincronizaría el reel entero) pero
 * muestran el poster en vez de montar un decodificador.
 *
 * El número no es capricho: con una tanda de 8 videos, montarlos todos son 8
 * decodificadores compitiendo en un teléfono de gama media — parte del "se
 * demoran mucho" que reportó el cliente. Con ±1, el siguiente ya está listo
 * cuando llegás y el anterior sigue vivo si volvés, que son los dos únicos
 * movimientos posibles desde donde estás parado.
 */
const MOUNT_WINDOW = 1;

export interface ReelStreamProps extends VideoReelsProps {
  surface?: ReelSurface;
}

export function ReelStream({
  tenantId,
  viewerId,
  scope,
  category = null,
  initialItems,
  initialCursor,
  surface = "page",
}: ReelStreamProps) {
  // El filtro se aplica al ENTRAR al estado, no al pintar: el índice activo se
  // calcula por posición de scroll, así que la lista que se renderiza y la que
  // se indexa tienen que ser exactamente la misma.
  const [items, setItems] = useState<PostCardModel[]>(() =>
    initialItems.filter(reelPlayable),
  );
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [activeIndex, setActiveIndex] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  /**
   * Sonido compartido entre slides: silenciar uno silencia el reel entero
   * (comportamiento estándar de Instagram/TikTok).
   *
   * Desde el 2026-09-03 es TAMBIÉN el gesto que gobierna la MÚSICA de cada
   * publicación: cada slide monta su `PostMusicProvider` controlado por este
   * estado, así que deslizar al siguiente video no vuelve al silencio — el gesto
   * ya está hecho y vale para todo el reel.
   */
  const [muted, setMuted] = useState(false);
  const loadingRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const offsets = REEL_SURFACE[surface];

  /**
   * CON LA PUERTA ABIERTA, EL VIDEO SE PARA.
   *
   * La hoja de entrada es un panel opaco que tapa el reel; el video, que es
   * pantalla completa y con audio, seguiría corriendo detrás. Quien toca ♥ sin
   * cuenta terminaría llenando un formulario de entrada mientras escucha un
   * video que ya no ve —y en un teléfono, sin poder bajarle el volumen sin
   * cerrar la hoja—. No es lo mismo que la hoja de comentarios, que es media
   * hoja de vidrio y deja el video a la vista a propósito: ahí el video es parte
   * de la conversación, acá estorba.
   */
  const authOpen = useAuthSheetOpen();

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
      const page = await loadMoreVideosAction({
        scope,
        category: category ?? undefined,
        cursor: current,
      });
      setItems((prev) => {
        const seen = new Set(prev.map((item) => item.id));
        return [
          ...prev,
          ...page.items.filter((item) => !seen.has(item.id) && reelPlayable(item)),
        ];
      });
      setCursor(page.nextCursor);
    } catch (error) {
      // Falla de red: cortamos el scroll infinito en vez de reintentar en loop.
      // Se LOGUEA: cortar el cursor y quedarse mudo es indistinguible de "no hay
      // más videos", y esa confusión ya costó una sesión de debug a ciegas.
      console.warn("[videos] no se pudo traer la próxima tanda del reel", {
        message: error instanceof Error ? error.message : String(error),
      });
      setCursor(null);
    } finally {
      loadingRef.current = false;
      setLoadingMore(false);
    }
  }, [category, cursor, scope]);

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

  // VISTAS: se registra una sola vez por post mientras este componente viva (el
  // Set en ref) — subir y bajar por el mismo video no infla el contador. Es
  // fire-and-forget: si la acción falla, el reel ni se entera.
  const viewedIds = useRef<Set<string>>(new Set());
  useEffect(() => {
    const active = items[activeIndex];
    if (!active || viewedIds.current.has(active.id)) return;
    viewedIds.current.add(active.id);
    void recordPostViewAction({ postId: active.id }).catch(() => undefined);
  }, [activeIndex, items]);

  const isEmpty = items.length === 0 && !cursor && !loadingMore;

  /**
   * SE ACABÓ EL SCROLL, Y HAY QUE DECIRLO.
   *
   * `VIDEOS_COPY.endOfFeed` estaba escrita desde el sprint de reels y no la
   * mostraba nadie: al llegar al último video el scroll simplemente dejaba de
   * traer, sin una sola señal. En un scroll vertical infinito eso no se lee
   * como "no hay más" sino como "se colgó", y el reflejo es tirar hacia arriba
   * otra vez. Se anuncia sólo parado en el ÚLTIMO slide y con el cursor ya
   * agotado — nunca mientras todavía queda algo por traer.
   */
  const atEnd =
    !cursor && !loadingMore && items.length > 0 && activeIndex >= items.length - 1;

  if (isEmpty) return <EmptyReels category={category} />;

  return (
    <>
      <div
        ref={scrollRef}
        onScroll={onScroll}
        /**
         * La marca que busca el gesto de cerrar del overlay: el arrastre hacia
         * abajo sólo cierra si ESTE scroll ya está arriba de todo. Sin el
         * atributo, ese gesto no podría distinguirse de un scroll y se comería
         * el deslizar entre videos (ver `reel-overlay.tsx`).
         */
        data-reel-scroll=""
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
            active={index === activeIndex && !authOpen}
            /**
             * Sólo el activo y sus dos vecinos montan un reproductor; el resto
             * ocupa su lugar con el poster (ver `MOUNT_WINDOW`).
             */
            mounted={Math.abs(index - activeIndex) <= MOUNT_WINDOW}
            /**
             * PRECARGA COMPLETA para el que se está viendo y para el SIGUIENTE.
             * El de abajo es el único movimiento que la persona va a hacer
             * seguro, así que cuando llegue tiene que estar listo — es la otra
             * mitad del "salen en blanco" que reportó el cliente. El de arriba
             * (que ya se vio) se queda en `metadata`: su archivo casi seguro
             * sigue en la caché del navegador.
             */
            preload={
              index === activeIndex || index === activeIndex + 1 ? "auto" : "metadata"
            }
            muted={muted}
            onMutedChange={setMuted}
            offsets={offsets}
          />
        ))}
      </div>

      {(loadingMore || atEnd) && (
        <p
          role="status"
          className={cn(
            "absolute left-1/2 z-20 max-w-[85%] -translate-x-1/2 rounded-full bg-media-scrim px-3.5 py-1.5 text-center text-xs font-medium text-on-media",
            offsets.status,
          )}
        >
          {loadingMore ? VIDEOS_COPY.loadingMore : VIDEOS_COPY.endOfFeed}
        </p>
      )}
    </>
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
  mounted,
  preload,
  muted,
  onMutedChange,
  offsets,
}: {
  post: PostCardModel;
  tenantId: string;
  viewerId: string | null;
  active: boolean;
  /** ¿Este slide monta un reproductor, o alcanza con su poster? (MOUNT_WINDOW) */
  mounted: boolean;
  /** Cuánto se baja de este archivo antes de que nadie lo mire. */
  preload: "none" | "metadata" | "auto";
  muted: boolean;
  onMutedChange: (muted: boolean) => void;
  offsets: ReelOffsets;
}) {
  const reduce = usePrefersReducedMotion();
  const like = useReelLike({ post, tenantId, viewerId });
  const [bursts, setBursts] = useState(0);
  const videoItem = post.media.find((item) => item.kind === "video");
  const videoUrl = videoItem?.url;
  /**
   * Video alojado en Mux: se reproduce con su reproductor y `url` es sólo la
   * miniatura. Ausente = archivo del bucket, el camino de siempre.
   */
  const muxPlaybackId = videoItem?.muxPlaybackId ?? null;
  /**
   * Primer cuadro capturado al subir (0132). En un video de Mux no hace falta:
   * su `url` YA es la miniatura que genera Mux, así que se usa ésa.
   */
  const posterUrl = videoItem?.posterUrl ?? (muxPlaybackId ? videoItem?.url : null) ?? null;
  const entity = post.entity;
  const displayTitle = entity ? entity.title : post.author.displayName;

  /**
   * Defensa barata (la query ya garantiza video), ahora con la variante de Mux:
   * hay algo que reproducir si hay archivo O si el video de Mux ya está listo.
   *
   * UN VIDEO TODAVÍA EN PREPARACIÓN NO ENTRA AL REEL, y es deliberado: Videos
   * Cortos es un scroll de pantalla completa donde cada deslizada tiene que
   * traer un video. Una diapositiva que dice "esperá un rato" es un pozo en el
   * medio del scroll. En el FEED sí se muestra —ahí la tarjeta convive con
   * texto y contexto, y quien publicó necesita ver que su video salió—, y
   * cuando termina de procesarse aparece acá con la siguiente tanda.
   */
  if (!videoUrl && !muxPlaybackId) return null;

  /**
   * Doble toque sobre el video = me gusta, igual que en la card del feed.
   * IDEMPOTENTE: nunca quita el me gusta (para eso está el corazón del riel).
   * El corazón grande sólo aparece con sesión — sin sesión el toggle abre la
   * hoja de entrada, y celebrar un me gusta que todavía no se guardó sería
   * mentirle a la persona justo antes de pedirle que se registre.
   */
  function handleDoubleTap() {
    if (!viewerId) {
      like.toggle(true); // sin sesión el toggle pide la puerta, no reacciona
      return;
    }
    setBursts((current) => current + 1);
    if (!like.liked) like.toggle(true);
  }

  return (
    <section
      aria-label={VIDEOS_COPY.videoOf(displayTitle)}
      className="relative h-full w-full snap-start snap-always"
    >
      {/**
       * LA MÚSICA DE LA PUBLICACIÓN, TAMBIÉN ACÁ (cliente 2026-09-03, 17:23:
       * «ahí no te sale la música»).
       *
       * El reel montaba el video y nada más: una publicación con canción sonaba
       * en el feed y llegaba muda a Videos Cortos. `PostMusicProvider` es el
       * mismo que usa la tarjeta —mismo `<audio>`, mismo recorte con sus
       * desvanecidos, mismo árbitro (`resolveAudioMix`)— montado acá con DOS
       * diferencias que hacen a un reel:
       *
       *  · CONTROLADO por el sonido del reel entero: el gesto es "que este reel
       *    suene", no "que suene esta publicación". Sin eso, cada deslizada
       *    montaba un provider nuevo en silencio y había que volver a tocar.
       *  · SIN su altavoz propio (`PostMusicSpeaker`): el reel ya tiene el suyo
       *    en el riel derecho, y dos controles para el mismo estado, en dos
       *    esquinas distintas, es peor que uno.
       *
       * Es también quien decide si el VIDEO va mudo: con canción, manda la
       * canción (regla 2 de `audio-mix`), igual que en el feed.
       */}
      <ReelSlideMedia
        post={post}
        active={active}
        mounted={mounted}
        preload={preload}
        muted={muted}
        onMutedChange={onMutedChange}
        videoUrl={videoUrl ?? ""}
        muxPlaybackId={muxPlaybackId}
        posterUrl={posterUrl}
        displayTitle={displayTitle}
        onDoubleTap={handleDoubleTap}
        offsets={offsets}
      />

      {/* Corazón grande del doble-tap (decorativo: el estado lo dice el riel). */}
      {bursts > 0 && (
        <span
          className="pointer-events-none absolute inset-0 z-10 grid place-items-center"
          aria-hidden="true"
        >
          <Heart
            key={bursts}
            weight="fill"
            size={110}
            className={cn(
              "text-on-media drop-shadow-lg",
              reduce ? heartStyles.heartFade : heartStyles.heartPop,
            )}
          />
        </span>
      )}

      {/* Chip honesto de campaña paga (igual que la card del feed) */}
      {post.isPromoted && (
        <div className={cn("pointer-events-none absolute right-4 z-10", offsets.adChip)}>
          <Chip variant="brand" size="sm">
            <Megaphone size={14} weight="fill" aria-hidden="true" />
            {VIDEOS_COPY.adChip}
          </Chip>
        </div>
      )}

      {/* Info del autor + cuerpo, sobre el degradado del propio ViewerVideo */}
      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 bottom-0 z-10",
          offsets.caption,
        )}
      >
        <div className="mx-auto w-full max-w-lg px-4 pr-20">
          <div className="pointer-events-auto flex items-center gap-2.5">
            {/* La FOTO de la ficha cuando el video salió como negocio (0116), no
                la de la persona: ver el bloque de privacidad de abajo — la cara
                filtra lo mismo que el nombre. */}
            <Avatar
              size="sm"
              name={displayTitle}
              src={entity ? (entity.photoUrl ?? null) : post.author.avatarUrl}
            />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-on-media drop-shadow-md">
                {displayTitle}
              </p>
              <div className="flex min-w-0 items-center gap-1.5">
                {/* ── SIN "por {persona}" CUANDO EL VIDEO ES DE UNA FICHA ─────
                    Misma regla y mismo motivo que la tarjeta del feed (ver el
                    docblock de `EntityHeader` en components/feed/post-card.tsx):
                    `post.entity` sale SIEMPRE de `posts.entity_listing_id`, que
                    la 0023 define como la FIRMA de la publicación. O sea que el
                    video se emitió con la cara del negocio, y poner debajo el
                    nombre personal de quien lo subió expone a alguien que eligió
                    no aparecer. El reel es además la superficie con MÁS alcance
                    de la app: acá una fuga se ve más que en ningún otro lado.

                    El Trust Score sigue siendo de la PERSONA, así que tampoco
                    se pinta con firma de negocio: sin firma se muestra entero,
                    con firma no se muestra nada. */}
                {entity ? null : (
                  post.author.profileId && (
                    <span className="inline-flex rounded-full bg-media-scrim px-1.5 py-0.5">
                      <PublisherTrust
                        displayName={post.author.displayName}
                        firstName={firstNameOf(post.author.displayName)}
                        score={post.author.score}
                        level={post.author.level}
                        signals={post.author.signals}
                        size="inline"
                        // "Ver el perfil de…" también acá: el reel es donde más
                        // aparece gente que no conocés (call 29/7, 1:02:24).
                        profileId={post.author.profileId}
                      />
                    </span>
                  )
                )}
                <span className="shrink-0 text-xs text-on-media/70 drop-shadow-md">
                  {post.timeAgoLabel}
                </span>
                {/* Vistas: dato social, no métrica de panel — va discreto, al
                    lado de "hace 2 h", y desaparece si todavía no hay ninguna. */}
                {post.viewCount > 0 && (
                  <span className="numeric shrink-0 text-xs text-on-media/70 drop-shadow-md">
                    · {VIDEOS_COPY.viewsLabel(post.viewCount)}
                  </span>
                )}
              </div>
            </div>
          </div>
          {post.body && (
            <p className="mt-2 line-clamp-2 text-sm leading-snug text-on-media drop-shadow-md">
              {post.body}
            </p>
          )}
          {/* La canción de la publicación, con el mismo rótulo que en el feed:
              quien la escucha tiene que poder saber qué está sonando. */}
          {post.music && (
            <div className="pointer-events-auto mt-2 flex">
              <MusicBadge
                title={post.music.track.title}
                artist={post.music.track.artist}
                attribution={attributionLine(post.music.track)}
              />
            </div>
          )}
        </div>
      </div>

      {/* Riel de acciones (like + comentarios + guardar + compartir + sonido) */}
      <ReelActions
        post={post}
        viewerId={viewerId}
        like={like}
        muted={muted}
        onMutedChange={onMutedChange}
        offsets={offsets}
      />
    </section>
  );
}

/**
 * EL RECTÁNGULO DEL VIDEO: su pista, su reproductor y —cuando el slide está
 * lejos del activo o el archivo todavía no llegó— su poster.
 *
 * Vive aparte de `ReelSlide` por una razón mecánica: `videoMuted` sale del
 * contexto que monta `PostMusicProvider`, y un componente no puede consumir un
 * contexto que él mismo monta. El de afuera declara la pista; éste la usa. Es
 * exactamente el mismo par que `CardPostMedia` / `PostMediaLayers` en el feed.
 */
function ReelSlideMedia({
  post,
  active,
  mounted,
  preload,
  muted,
  onMutedChange,
  videoUrl,
  muxPlaybackId,
  posterUrl,
  displayTitle,
  onDoubleTap,
  offsets,
}: {
  post: PostCardModel;
  active: boolean;
  mounted: boolean;
  preload: "none" | "metadata" | "auto";
  muted: boolean;
  onMutedChange: (muted: boolean) => void;
  videoUrl: string;
  muxPlaybackId: string | null;
  posterUrl: string | null;
  displayTitle: string;
  onDoubleTap: () => void;
  offsets: ReelOffsets;
}) {
  return (
    <PostMusicProvider
      music={post.music}
      // Todo slide del reel ES un video, así que siempre hay algo que escuchar.
      hasVideo
      // El gesto es del REEL, no de esta publicación (ver el docblock del
      // slide). `muted` invertido: acá se habla de "sonido encendido".
      soundOn={!muted}
      onSoundOnChange={(soundOn) => onMutedChange(!soundOn)}
      className="mx-auto h-full w-full max-w-lg"
    >
      {mounted ? (
        <ReelVideo
          videoUrl={videoUrl}
          muxPlaybackId={muxPlaybackId}
          posterUrl={posterUrl}
          preload={preload}
          active={active}
          onMutedChange={onMutedChange}
          displayTitle={displayTitle}
          onDoubleTap={onDoubleTap}
          offsets={offsets}
        />
      ) : (
        /**
         * FUERA DE LA VENTANA DE MONTAJE. El slide conserva su tamaño exacto
         * —el índice activo se calcula por posición de scroll— y muestra el
         * poster. No monta `<video>`: ocho decodificadores a la vez en un
         * teléfono es parte de por qué el reel "se demora mucho".
         */
        <ReelPoster posterUrl={posterUrl} />
      )}
    </PostMusicProvider>
  );
}

/** El reproductor, ya con el veredicto de audio de la publicación aplicado. */
function ReelVideo({
  videoUrl,
  muxPlaybackId,
  posterUrl,
  preload,
  active,
  onMutedChange,
  displayTitle,
  onDoubleTap,
  offsets,
}: {
  videoUrl: string;
  muxPlaybackId: string | null;
  posterUrl: string | null;
  preload: "none" | "metadata" | "auto";
  active: boolean;
  onMutedChange: (muted: boolean) => void;
  displayTitle: string;
  onDoubleTap: () => void;
  offsets: ReelOffsets;
}) {
  const postMusic = usePostMusic();
  /**
   * Quién habla lo decide `resolveAudioMix`, no este componente: con canción, el
   * video va mudo y suena la pista (regla 2 de audio-mix). Sin provider —que no
   * puede pasar acá, pero el hook es opcional por contrato— el video queda mudo,
   * que es el default seguro de siempre.
   */
  const videoMuted = postMusic?.mix.videoMuted ?? true;

  return (
    <ViewerVideo
      url={videoUrl}
      muxPlaybackId={muxPlaybackId}
      active={active}
      muted={videoMuted}
      /**
       * El único caso en que el reproductor pide cambiar el mute es cuando el
       * navegador RECHAZA el autoplay con audio. Eso es un "no se pudo" del
       * sistema, no un gesto: se propaga al sonido del reel para que el altavoz
       * del riel diga la verdad y un toque lo desbloquee.
       */
      onMutedChange={onMutedChange}
      authorLabel={displayTitle}
      fit="cover"
      showMute={false}
      onDoubleTap={onDoubleTap}
      posterUrl={posterUrl}
      preload={preload}
      // Videos Cortos es corto también cuando el archivo no lo es: los 7
      // videos anteriores a la 0046 no declaran duración, y su archivo puede
      // durar lo que sea. A los 90 s el reel vuelve a empezar.
      maxPlaybackSeconds={playbackCapSeconds("reel")}
      // La barra de progreso queda por ENCIMA del bottom nav (z-40 fijo) cuando
      // el reel es la sección; en el overlay no hay nav que despejar.
      controlsClassName={offsets.videoControls}
    />
  );
}

/**
 * LO QUE SE VE MIENTRAS NO HAY VIDEO — y nunca es un rectángulo en blanco.
 *
 * Dos casos, un solo respaldo: el slide está fuera de la ventana de montaje, o
 * el video no tiene poster (los anteriores a la 0132, o un archivo que el
 * navegador no pudo decodificar al subir).
 *
 * Sin poster no se pinta un vacío: va un fondo con los tokens de la marca —un
 * degradado cálido sobre el `media-shade`, nunca negro plano— y un ícono que
 * dice que ahí abajo hay un video cargando. Es la diferencia entre "se rompió"
 * y "ya viene", que es literalmente lo que el cliente no podía distinguir.
 */
function ReelPoster({ posterUrl }: { posterUrl: string | null }) {
  return (
    <div className="relative h-full w-full overflow-hidden" aria-hidden="true">
      <div className="absolute inset-0 bg-media-shade bg-[radial-gradient(115%_85%_at_50%_20%,var(--color-brand-900),var(--color-media-shade)_70%)]" />
      {posterUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- poster del bucket a pantalla completa, sin optimizador
        <img
          src={posterUrl}
          alt=""
          className="relative h-full w-full object-cover"
          draggable={false}
        />
      ) : (
        <span className="absolute inset-0 grid place-items-center">
          <FilmSlate size={40} className="animate-pulse text-on-media/45" />
        </span>
      )}
    </div>
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

interface ReelLikeState {
  liked: boolean;
  count: number;
  toggle: (next: boolean) => void;
}

/**
 * Me gusta optimista del post del slide. Vive en ReelSlide (no en el riel)
 * porque lo comparten DOS gestos: el doble toque sobre el video y el corazón
 * del riel — con estados separados se desincronizaban, igual que pasaba en la
 * card del feed antes de CardLikeProvider.
 */
function useReelLike({
  post,
  tenantId,
  viewerId,
}: {
  post: PostCardModel;
  tenantId: string;
  viewerId: string | null;
}): ReelLikeState {
  const requireAuth = useRequireAuth();
  // Mismo criterio que el feed: el me gusta sale a nombre de la cara activa
  // (0117). El reel y la card comparten la promesa, así que comparten la fuente.
  const firma = useFirmaActiva();
  const [liked, setLiked] = useState(post.likedByViewer);
  const [count, setCount] = useState(post.likeCount);

  /**
   * El me gusta que quedó pendiente mientras la persona entraba.
   *
   * Mismo caso que en el feed (`card-like-context`): el insert en `reactions`
   * escribe `profile_id` con el `viewerId` que baja del servidor, y al momento
   * de reanudar ese prop todavía dice `null` —el closure es el de antes de
   * entrar—. Así que el deseo se guarda acá y se ejecuta recién cuando el
   * `router.refresh()` de la hoja trae el viewer verdadero.
   */
  const pendingLike = useRef<boolean | null>(null);

  /**
   * Pide sesión sin sacar a nadie del reel (cliente 2026-08-20: "mientras menos
   * pasos mejor"). Antes esto era un `router.push` a /entrar: la persona perdía
   * el video, la posición del scroll infinito y el sonido que había desbloqueado
   * — y volvía al primer video de la lista, no al que le había gustado.
   *
   * El deseo se arma DENTRO de `onAuthenticated` y nunca antes: quien toca el
   * corazón sin cuenta y cierra la hoja sin entrar no puede terminar con un me
   * gusta fantasma aplicado en la próxima entrada, por otro motivo, a un video
   * que ya ni está en pantalla.
   */
  function requireLike(nextLiked: boolean) {
    requireAuth({
      reason: AUTH_REASON.like,
      onAuthenticated: () => {
        pendingLike.current = nextLiked;
      },
    });
  }

  function toggle(nextLiked: boolean) {
    if (!viewerId) {
      requireLike(nextLiked);
      return;
    }
    applyToggle(nextLiked);
  }

  /** El camino con sesión: optimista + persistencia. */
  function applyToggle(nextLiked: boolean) {
    if (nextLiked === liked) return; // ya está en ese estado: nada que hacer
    // Sólo se llega acá con sesión (`toggle` corta a los anónimos y el efecto de
    // abajo espera al viewer verdadero); el guard además narrowea `viewerId` a
    // string para las escrituras.
    if (!viewerId) return;
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
          entity_listing_id: firma.listingId,
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

  useEffect(() => {
    if (!viewerId || pendingLike.current === null) return;
    const wanted = pendingLike.current;
    pendingLike.current = null;
    // El efecto va DEBAJO de `applyToggle`: leer desde un efecto una función
    // declarada más abajo congela la versión vieja y el compilador de React lo
    // rechaza. Diferido a un frame porque el efecto corre dentro del commit del
    // refresh y un setState sincrónico acá encadena renders.
    const raf = requestAnimationFrame(() => applyToggle(wanted));
    return () => cancelAnimationFrame(raf);
    // `applyToggle` se redefine en cada render; el disparador real es viewerId.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewerId]);

  return { liked, count, toggle };
}

function ReelActions({
  post,
  viewerId,
  like,
  muted,
  onMutedChange,
  offsets,
}: {
  post: PostCardModel;
  viewerId: string | null;
  like: ReelLikeState;
  muted: boolean;
  onMutedChange: (muted: boolean) => void;
  offsets: ReelOffsets;
}) {
  const requireAuth = useRequireAuth();
  const { toast } = useToast();
  const commentsSheet = useCommentsSheet();
  const { liked, count, toggle: toggleLike } = like;
  const [saved, setSaved] = useState(post.savedByViewer);
  const [savePending, setSavePending] = useState(false);

  /**
   * Pide sesión con el guardado ya cargado para aplicarlo apenas entra.
   *
   * Reanuda por `applySave` y no por `toggleSave`: éste vuelve a mirar
   * `viewerId`, que en el closure de antes de entrar sigue siendo `null` —
   * reabriría la hoja que la persona acaba de cerrar, en bucle. El server action
   * deriva quién guarda desde la cookie, que ya está escrita.
   */
  function requireSave(next: boolean) {
    requireAuth({
      reason: AUTH_REASON.save,
      onAuthenticated: () => applySave(next),
    });
  }

  /**
   * Guardar/quitar de guardados. Optimista local: el ícono responde al toque y
   * se revierte si el server dice que no. Sin sesión, guardar no tiene dónde
   * guardarse: se pide acá mismo, sin dejar el video.
   */
  function toggleSave() {
    if (savePending) return;
    const next = !saved;
    if (!viewerId) {
      requireSave(next);
      return;
    }
    applySave(next);
  }

  /** El camino con sesión. */
  function applySave(next: boolean) {
    if (savePending) return;
    setSaved(next);
    setSavePending(true);
    try {
      navigator.vibrate?.(10);
    } catch {
      // sin soporte háptico
    }
    void (async () => {
      try {
        const result = await toggleSaveAction({
          subjectKind: "post",
          subjectId: post.id,
          save: next,
        });
        if (!result.ok) {
          setSaved(!next); // la UI no puede mentir sobre lo guardado
          if (result.code === "unauthenticated") {
            // La sesión se venció entre el toque y el viaje: se vuelve a pedir
            // la puerta, no un error que no explica nada.
            requireSave(next);
            return;
          }
          toast({
            title: VIDEOS_COPY.saveErrorTitle,
            description: result.message ?? VIDEOS_COPY.saveErrorBody,
            variant: "danger",
          });
        }
      } catch {
        setSaved(!next);
        toast({
          title: VIDEOS_COPY.saveErrorTitle,
          description: VIDEOS_COPY.saveErrorBody,
          variant: "danger",
        });
      } finally {
        setSavePending(false);
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
    <div
      className={cn(
        "pointer-events-none absolute right-2 z-10 flex flex-col items-center gap-3",
        offsets.rail,
      )}
    >
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
          commentsSheet.open({
            postId: post.id,
            commentCount: post.commentCount,
            // Media hoja de vidrio: el video sigue arriba, visible y corriendo
            // (feedback cliente 2026-07-27: "le bloqueó todo el video").
            surface: "video",
          })
        }
        aria-label={`${VIDEOS_COPY.comments} (${post.commentCount})`}
        className={railButtonClass}
      >
        <ChatCircle size={26} aria-hidden="true" />
        <span className="numeric text-xs font-medium">{post.commentCount}</span>
      </button>

      <button
        type="button"
        onClick={toggleSave}
        aria-label={saved ? VIDEOS_COPY.unsave : VIDEOS_COPY.save}
        aria-pressed={saved}
        // El estado se lee por el ícono RELLENO + la etiqueta, no por un color:
        // sobre un video cualquiera un acento no garantiza contraste AA.
        className={railButtonClass}
      >
        <BookmarkSimple size={26} weight={saved ? "fill" : "regular"} aria-hidden="true" />
        <span className="text-xs font-medium">
          {saved ? VIDEOS_COPY.saved : VIDEOS_COPY.save}
        </span>
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
// Cabecera del reel filtrado — qué estoy viendo y cómo vuelvo a elegir
// ---------------------------------------------------------------------------

/** Etiqueta legible del filtro activo ("Todos" incluido). */
function categoryLabel(category: VideoCategoryFilter): string {
  return category === ALL_CATEGORIES
    ? VIDEOS_COPY.reel.allLabel
    : VIDEO_CATEGORY_LABELS[category as VideoCategory];
}

function ReelCategoryBar({ category }: { category: VideoCategoryFilter }) {
  const label = categoryLabel(category);
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[4.25rem] z-20 px-4">
      <div className="mx-auto w-full max-w-lg">
        <Link
          href="/videos"
          // El nombre accesible dice las DOS cosas: qué se está viendo y adónde
          // lleva el toque. Visualmente alcanza con el nombre del tema.
          aria-label={`${VIDEOS_COPY.reel.activeCategory(label)}. ${VIDEOS_COPY.reel.backToMenu}`}
          className={cn(
            "pointer-events-auto inline-flex min-h-11 items-center gap-2 rounded-full",
            "bg-media-scrim px-3.5 text-sm font-semibold text-on-media backdrop-blur-sm",
            "transition-transform duration-(--duration-fast) ease-(--ease-spring) active:scale-[0.96]",
            "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-on-media/60",
          )}
        >
          <SlidersHorizontal size={16} weight="bold" aria-hidden="true" />
          {label}
        </Link>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Estado vacío — cálido y con salida clara (publicar desde el feed)
// ---------------------------------------------------------------------------

function EmptyReels({ category }: { category?: VideoCategoryFilter | null }) {
  // Un tema sin videos no es "no hay videos": es "acá todavía no". La salida
  // cambia igual — de una categoría vacía se sale viendo todos, no yendo a
  // publicar (que es la salida cuando de verdad no hay nada).
  const filtered = Boolean(category) && category !== ALL_CATEGORIES;
  const label = category ? categoryLabel(category) : "";

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4 px-8 text-center">
      <FilmSlate size={44} className="text-on-media/70" aria-hidden="true" />
      <div>
        <h2 className="font-display text-lg font-bold text-on-media">
          {filtered ? VIDEOS_COPY.emptyCategoryTitle(label) : VIDEOS_COPY.emptyTitle}
        </h2>
        <p className="mt-1.5 text-sm leading-relaxed text-on-media/80">
          {filtered ? VIDEOS_COPY.emptyCategoryMessage : VIDEOS_COPY.emptyMessage}
        </p>
      </div>
      <Link
        href={filtered ? `/videos?cat=${ALL_CATEGORIES}` : "/feed"}
        className={buttonVariants({ variant: "primary", size: "md" })}
      >
        {filtered ? VIDEOS_COPY.emptyCategoryCta : VIDEOS_COPY.emptyCta}
      </Link>
    </div>
  );
}
