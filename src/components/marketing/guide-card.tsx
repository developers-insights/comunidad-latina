import Image from "next/image";
import Link from "next/link";
import { ArrowRight, BookOpenText, Clock } from "@phosphor-icons/react/dist/ssr";
import { Chip } from "@/components/ui";
import { cn } from "@/lib/utils";
import { COPY } from "./copy";

/** Forma plana de guía que consumen la landing y el índice /guias. */
export interface GuideCardData {
  slug: string;
  title: string;
  summary: string | null;
  topics: string[];
  readingMinutes: number;
  /** Ruta local en /public/images o null → cabecera editorial con ícono. */
  cover: string | null;
}

/**
 * Card editorial de guía — estructura de "artículo" (§4.b: nunca se confunde
 * con un post ni un listing): cabecera visual + chips de tema + tiempo de lectura.
 */
export function GuideCard({
  guide,
  priority = false,
  className,
}: {
  guide: GuideCardData;
  /** true solo para covers above-the-fold en la landing. */
  priority?: boolean;
  className?: string;
}) {
  return (
    <Link
      href={`/guias/${guide.slug}`}
      className={cn(
        "group flex h-full flex-col overflow-hidden rounded-lg border border-border-subtle bg-surface shadow-sm",
        "transition-[box-shadow,transform] duration-(--duration-base) ease-(--ease-out-premium)",
        "hover:-translate-y-0.5 hover:shadow-md motion-reduce:hover:translate-y-0",
        className,
      )}
    >
      {guide.cover ? (
        <div className="relative aspect-[16/9] w-full overflow-hidden bg-surface-subtle">
          <Image
            src={guide.cover}
            alt=""
            fill
            priority={priority}
            sizes="(min-width: 1024px) 320px, (min-width: 640px) 45vw, 90vw"
            className="object-cover transition-transform duration-(--duration-slow) ease-(--ease-out-premium) group-hover:scale-[1.03] motion-reduce:group-hover:scale-100"
          />
        </div>
      ) : (
        <div
          aria-hidden="true"
          className="flex aspect-[16/9] w-full items-center justify-center bg-gradient-to-br from-brand-tint to-surface-subtle"
        >
          <BookOpenText size={40} weight="light" className="text-brand-ink" />
        </div>
      )}

      <div className="flex flex-1 flex-col gap-3 p-5">
        {guide.topics.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {guide.topics.slice(0, 3).map((topic) => (
              <Chip key={topic} size="sm">
                {topic}
              </Chip>
            ))}
          </div>
        )}

        <h3 className="font-display text-lg font-semibold leading-snug text-foreground">
          {guide.title}
        </h3>

        {guide.summary && (
          <p className="line-clamp-3 text-sm leading-relaxed text-foreground-secondary">
            {guide.summary}
          </p>
        )}

        <div className="mt-auto flex items-center justify-between pt-2 text-sm text-foreground-muted">
          <span className="inline-flex items-center gap-1.5">
            <Clock size={16} aria-hidden="true" />
            {COPY.guides.readingTime(guide.readingMinutes)}
          </span>
          <span
            aria-hidden="true"
            className="inline-flex items-center gap-1 font-medium text-brand-ink transition-transform duration-(--duration-fast) group-hover:translate-x-0.5 motion-reduce:group-hover:translate-x-0"
          >
            Leer
            <ArrowRight size={16} />
          </span>
        </div>
      </div>
    </Link>
  );
}
