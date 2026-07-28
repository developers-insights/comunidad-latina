import Link from "next/link";
import {
  Bookmark,
  BookmarkSimple,
  Briefcase,
  CalendarBlank,
  CaretRight,
  ChatCircle,
  House,
  Package,
  Play,
  UserCircle,
} from "@phosphor-icons/react/dist/ssr";
import { BezelCard, EmptyState, buttonVariants } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { PostTile } from "../post-tiles";
import type { SavedItem, SavedListingTile } from "./saved-tile";

/**
 * Lista de "Guardados" (§ perfil): posts y avisos guardados, ya en el orden
 * cronológico que trae la query (más nuevo primero). Server component puro —
 * sin hooks, sin "use client" — misma filosofía que ProfilePostsGrid.
 */

const COPY = {
  emptyTitle: "Todavía no guardaste nada",
  emptyMessage:
    "Tocá el marcador en una publicación o un aviso para guardarlo acá y encontrarlo fácil cuando lo necesites.",
  loadMore: "Ver más",
  openPost: "Abrir la publicación",
  question: "Pregunta a la comunidad",
  postKindLabel: "Publicación",
  questionKindLabel: "Pregunta",
} as const;

const LISTING_KIND_ICON: Record<string, React.ReactNode> = {
  property: <House size={22} aria-hidden="true" />,
  professional: <UserCircle size={22} aria-hidden="true" />,
  event: <CalendarBlank size={22} aria-hidden="true" />,
  job: <Briefcase size={22} aria-hidden="true" />,
  product: <Package size={22} aria-hidden="true" />,
};

/** Recorta el cuerpo para el título/aria-label sin arrastrar párrafos enteros. */
function shortText(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return "";
  return clean.length > 80 ? `${clean.slice(0, 80)}…` : clean;
}

export interface SavedListProps {
  items: SavedItem[];
  /** URL de la siguiente página (keyset), o null si no hay más. */
  nextHref: string | null;
}

export function SavedList({ items, nextHref }: SavedListProps) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={<BookmarkSimple weight="light" />}
        title={COPY.emptyTitle}
        message={COPY.emptyMessage}
      />
    );
  }

  return (
    <>
      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <li key={item.key}>
            {item.subjectKind === "post" ? (
              <SavedPostRow tile={item.post} />
            ) : (
              <SavedListingRow tile={item.listing} />
            )}
          </li>
        ))}
      </ul>

      {nextHref && (
        <Link
          href={nextHref}
          className={cn(buttonVariants({ variant: "outline", size: "md" }), "w-full")}
        >
          {COPY.loadMore}
        </Link>
      )}
    </>
  );
}

/** Cáscara compartida de fila: thumbnail + título/meta + chevron, un solo tap target. */
function SavedRowShell({
  href,
  ariaLabel,
  thumb,
  title,
  meta,
}: {
  href: string;
  ariaLabel: string;
  thumb: React.ReactNode;
  title: string;
  meta: string;
}) {
  return (
    <Link
      href={href}
      aria-label={ariaLabel}
      className="group block rounded-xl focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
    >
      <BezelCard coreClassName="flex items-center gap-3 p-3">
        <span
          aria-hidden="true"
          className="relative flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-surface-subtle text-foreground-muted"
        >
          {thumb}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-display text-sm font-semibold text-foreground">
            {title}
          </span>
          <span className="mt-0.5 block truncate text-xs text-foreground-secondary">{meta}</span>
        </span>
        <CaretRight
          size={18}
          aria-hidden="true"
          className="shrink-0 text-foreground-muted transition-transform duration-(--duration-fast) ease-(--ease-out-premium) group-hover:translate-x-0.5"
        />
      </BezelCard>
    </Link>
  );
}

function SavedPostRow({ tile }: { tile: PostTile }) {
  const title =
    shortText(tile.text) || (tile.isQuestion ? COPY.question : COPY.openPost);
  const meta = tile.isQuestion ? COPY.questionKindLabel : COPY.postKindLabel;

  return (
    <SavedRowShell
      href={`/feed/${tile.id}`}
      ariaLabel={title}
      title={title}
      meta={meta}
      thumb={<PostThumb tile={tile} />}
    />
  );
}

function PostThumb({ tile }: { tile: PostTile }) {
  if (tile.tileKind === "image" && tile.mediaUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- thumbnail chico del bucket post-media
      <img src={tile.mediaUrl} alt="" className="size-full object-cover" />
    );
  }
  if (tile.tileKind === "video" && tile.mediaUrl) {
    return (
      <>
        <video
          src={`${tile.mediaUrl}#t=0.1`}
          preload="metadata"
          muted
          playsInline
          tabIndex={-1}
          className="size-full object-cover"
        />
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="cl-print-fill flex size-6 items-center justify-center rounded-full bg-media-scrim text-on-media backdrop-blur-sm">
            <Play size={13} weight="fill" />
          </span>
        </span>
      </>
    );
  }
  return <ChatCircle size={22} weight={tile.isQuestion ? "fill" : "regular"} />;
}

function SavedListingRow({ tile }: { tile: SavedListingTile }) {
  const detail = tile.priceLabel ?? tile.areaLabel;
  const meta = detail ? `${tile.kindLabel} · ${detail}` : tile.kindLabel;
  const ariaLabel = [tile.title, tile.priceLabel, tile.areaLabel].filter(Boolean).join(", ");

  return (
    <SavedRowShell
      href={tile.href}
      ariaLabel={ariaLabel}
      title={tile.title}
      meta={meta}
      thumb={<ListingThumb tile={tile} />}
    />
  );
}

function ListingThumb({ tile }: { tile: SavedListingTile }) {
  if (tile.photoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- thumbnail chico del bucket listing-photos
      <img src={tile.photoUrl} alt="" className="size-full object-cover" />
    );
  }
  return <>{LISTING_KIND_ICON[tile.kind] ?? <Bookmark size={22} aria-hidden="true" />}</>;
}
