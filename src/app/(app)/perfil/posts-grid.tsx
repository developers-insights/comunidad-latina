import Link from "next/link";
import {
  CaretDown,
  ChatCircle,
  Play,
} from "@phosphor-icons/react/dist/ssr";
import { buttonVariants } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { PostTile } from "./post-tiles";

const COPY = {
  heading: "Publicaciones",
  loadMore: "Ver más",
  openPost: "Abrir la publicación",
  question: "Pregunta a la comunidad",
} as const;

export interface ProfilePostsGridProps {
  tiles: PostTile[];
  /** URL de la siguiente página (keyset), o null si no hay más. */
  nextHref: string | null;
  /** Mensaje cálido cuando la persona todavía no publicó nada. */
  emptyMessage: string;
  /** Título de sección; por defecto "Publicaciones". */
  heading?: string;
}

/** Recorta el cuerpo para el aria-label sin arrastrar párrafos enteros al SR. */
function shortText(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return "";
  return clean.length > 80 ? `${clean.slice(0, 80)}…` : clean;
}

/**
 * Grid de publicaciones tipo red social: 3 columnas de thumbnails cuadrados.
 * Server component — el `<video>` pinta su primer frame con `preload="metadata"`
 * y no necesita JS. Cada tile abre el detalle en /feed/[id].
 */
export function ProfilePostsGrid({
  tiles,
  nextHref,
  emptyMessage,
  heading = COPY.heading,
}: ProfilePostsGridProps) {
  return (
    <section aria-label={heading} className="flex flex-col gap-3">
      <h2 className="font-display text-lg font-bold text-foreground">{heading}</h2>

      {tiles.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border bg-surface-subtle px-4 py-8 text-center text-sm text-foreground-muted">
          {emptyMessage}
        </p>
      ) : (
        <>
          <ul className="grid grid-cols-3 gap-1.5">
            {tiles.map((tile) => (
              <li key={tile.id}>
                <Link
                  href={`/feed/${tile.id}`}
                  aria-label={
                    shortText(tile.text) ||
                    (tile.isQuestion ? COPY.question : COPY.openPost)
                  }
                  className={cn(
                    "group relative block aspect-square overflow-hidden rounded-lg bg-surface-subtle",
                    "transition-transform duration-(--duration-instant) ease-(--ease-spring) active:scale-[0.98]",
                    "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
                  )}
                >
                  <PostTileMedia tile={tile} />
                </Link>
              </li>
            ))}
          </ul>

          {nextHref && (
            <Link
              href={nextHref}
              className={cn(
                buttonVariants({ variant: "outline", size: "md" }),
                "w-full",
              )}
            >
              {COPY.loadMore}
              <CaretDown size={16} aria-hidden="true" />
            </Link>
          )}
        </>
      )}
    </section>
  );
}

/** Contenido de un tile según su tipo (foto / video / texto). Todo aria-hidden:
 *  el aria-label del Link ya describe la publicación. */
function PostTileMedia({ tile }: { tile: PostTile }) {
  if (tile.tileKind === "image" && tile.mediaUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- thumbnail del bucket post-media; el LCP del perfil no pasa por acá
      <img
        src={tile.mediaUrl}
        alt=""
        loading="lazy"
        aria-hidden="true"
        className="size-full object-cover transition-transform duration-(--duration-normal) ease-(--ease-out-premium) group-hover:scale-[1.03]"
      />
    );
  }

  if (tile.tileKind === "video" && tile.mediaUrl) {
    return (
      <>
        <video
          // `#t=0.1` empuja al navegador a pintar el primer frame como póster
          // (Chrome/Safari) sin generar una imagen aparte. `muted`/`playsInline`
          // evitan cualquier reproducción; es un thumbnail, no un reproductor.
          src={`${tile.mediaUrl}#t=0.1`}
          preload="metadata"
          muted
          playsInline
          aria-hidden="true"
          tabIndex={-1}
          className="size-full object-cover"
        />
        {/* Glyph de Play: aunque el frame no cargue, el tile se lee como video. */}
        <span
          aria-hidden="true"
          className="absolute inset-0 flex items-center justify-center"
        >
          <span className="cl-print-fill flex size-9 items-center justify-center rounded-full bg-media-scrim text-on-media backdrop-blur-sm">
            <Play size={18} weight="fill" />
          </span>
        </span>
      </>
    );
  }

  // Sin medios: tile de texto (post viejo o pregunta). El cuerpo, recortado.
  return (
    <div
      aria-hidden="true"
      className="flex size-full flex-col justify-between gap-2 p-3"
    >
      <ChatCircle
        size={18}
        weight={tile.isQuestion ? "fill" : "regular"}
        className={tile.isQuestion ? "text-brand" : "text-foreground-muted"}
      />
      <p className="line-clamp-4 text-xs leading-snug text-foreground-secondary">
        {tile.text || (tile.isQuestion ? COPY.question : COPY.openPost)}
      </p>
    </div>
  );
}
