import Link from "next/link";
import { ArrowRight, BookOpen } from "@phosphor-icons/react/dist/ssr";
import { Chip, buttonVariants } from "@/components/ui";
import { cn } from "@/lib/utils";
import { COPY } from "./copy";
import type { GuideCardModel } from "./helpers";

/**
 * Card editorial de guía destacada (§4.b): formato de "artículo" con ícono
 * de libro y tiempo de lectura — nunca se confunde con un post ni un listing.
 */
export function GuideCard({ guide }: { guide: GuideCardModel }) {
  return (
    <article
      aria-label={guide.title}
      className="rounded-lg border border-border-subtle bg-surface-subtle p-5"
    >
      <Chip size="sm" variant="brand" icon={<BookOpen aria-hidden="true" />}>
        {COPY.guide.chip}
      </Chip>
      <h3 className="mt-3 font-display text-lg font-bold leading-snug text-foreground">
        {guide.title}
      </h3>
      {guide.summary && (
        <p className="mt-1.5 line-clamp-3 text-sm leading-relaxed text-foreground-secondary">
          {guide.summary}
        </p>
      )}
      <Link
        href={`/guias/${guide.slug}`}
        className={cn(buttonVariants({ variant: "secondary", size: "md" }), "mt-4 w-full")}
      >
        {COPY.guide.read(guide.readingMinutes)}
        <ArrowRight size={16} aria-hidden="true" />
      </Link>
    </article>
  );
}
