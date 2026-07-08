import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ArrowSquareOut,
  Clock,
  SealCheck,
} from "@phosphor-icons/react/dist/ssr";
import { getTenant } from "@/lib/tenant/resolve";
import { formatDate } from "@/lib/utils";
import { BezelCard, Chip, buttonVariants } from "@/components/ui";
import { COPY } from "@/components/marketing/copy";
import {
  estimateReadingMinutes,
  fetchGuideBySlug,
  parseGuideSources,
} from "@/components/marketing/data";
import { JsonLd } from "@/components/marketing/json-ld";
import { Markdown } from "@/components/marketing/markdown";
import { SaveOfflineButton } from "@/components/marketing/save-offline-button";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://comunidadlatina.com";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const guide = await fetchGuideBySlug(slug);
  if (!guide) return {};

  const tenant = await getTenant();
  const description =
    guide.summary ?? `Guía paso a paso de ${tenant.name}, con fuentes oficiales citadas.`;

  return {
    title: guide.title,
    description,
    keywords: guide.topics,
    alternates: { canonical: `${SITE_URL}/guias/${guide.slug}` },
    openGraph: {
      title: guide.title,
      description,
      type: "article",
      locale: "es_US",
      publishedTime: guide.published_at ?? undefined,
      modifiedTime: guide.updated_at,
      images: [{ url: "/images/og-default.png", width: 1200, height: 630 }],
    },
  };
}

export default async function GuiaDetallePage({ params }: Props) {
  const { slug } = await params;
  const guide = await fetchGuideBySlug(slug);
  if (!guide) notFound();

  const tenant = await getTenant();
  const sources = parseGuideSources(guide.sources);
  const readingMinutes = guide.reading_minutes ?? estimateReadingMinutes(guide.body_md);
  const checkedAt = sources.find((source) => source.checkedAt)?.checkedAt ?? null;

  return (
    <article className="mx-auto w-full max-w-3xl px-4 py-12 sm:py-16">
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "Article",
          headline: guide.title,
          description: guide.summary ?? undefined,
          inLanguage: "es",
          datePublished: guide.published_at ?? undefined,
          dateModified: guide.updated_at,
          author: { "@type": "Organization", name: tenant.name },
          publisher: { "@type": "Organization", name: tenant.name, url: SITE_URL },
          mainEntityOfPage: `${SITE_URL}/guias/${guide.slug}`,
        }}
      />

      <Link
        href="/guias"
        className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-foreground-secondary transition-colors hover:text-foreground"
      >
        <ArrowLeft size={16} aria-hidden="true" />
        {COPY.guideDetail.backToGuides}
      </Link>

      <header className="mt-6">
        {guide.topics.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-1.5">
            {guide.topics.map((topic) => (
              <Chip key={topic} size="sm">
                {topic}
              </Chip>
            ))}
          </div>
        )}

        <h1 className="font-display text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
          {guide.title}
        </h1>

        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-foreground-muted">
          <span className="inline-flex items-center gap-1.5">
            <Clock size={16} aria-hidden="true" />
            {COPY.guides.readingTime(readingMinutes)}
          </span>
          <span>{COPY.guideDetail.updated(formatDate(guide.updated_at, { style: "long" }))}</span>
        </div>

        <div className="mt-5">
          <SaveOfflineButton
            slug={guide.slug}
            title={guide.title}
            summary={guide.summary}
            bodyMd={guide.body_md}
          />
        </div>
      </header>

      {/* Fuentes oficiales — SIEMPRE visible arriba del fold */}
      {sources.length > 0 && (
        <BezelCard variant="featured" className="mt-8" coreClassName="p-5">
          <h2 className="flex items-center gap-2 font-display text-base font-semibold">
            <SealCheck size={18} weight="fill" className="text-brand-ink" aria-hidden="true" />
            {COPY.guideDetail.sourcesTitle}
          </h2>
          <ul className="mt-3 space-y-2">
            {sources.map((source) => (
              <li key={source.url}>
                <a
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group inline-flex items-start gap-1.5 text-sm font-medium text-brand-ink underline decoration-brand-subtle underline-offset-2 hover:decoration-brand-ink"
                >
                  <span>{source.label}</span>
                  <ArrowSquareOut size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                </a>
                {source.checkedAt && (
                  <span className="ml-2 text-xs text-foreground-muted">
                    {COPY.guideDetail.sourcesChecked(
                      formatDate(source.checkedAt, { style: "medium" }),
                    )}
                  </span>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-3 border-t border-border-subtle pt-3 text-xs leading-relaxed text-foreground-secondary">
            {COPY.guideDetail.sourcesDisclaimer}
          </p>
        </BezelCard>
      )}

      <div className="mt-10">
        <Markdown source={guide.body_md} />
      </div>

      {/* CTA final contextual */}
      <BezelCard variant="featured" className="mt-14" coreClassName="flex flex-col items-start gap-4 p-7 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-xl font-bold tracking-tight">
            {COPY.guideDetail.ctaTitle}
          </h2>
          <p className="mt-1.5 max-w-md text-sm leading-relaxed text-foreground-secondary">
            {COPY.guideDetail.ctaBody}
          </p>
        </div>
        <Link
          href="/registro"
          className={buttonVariants({ variant: "primary", size: "md" })}
        >
          {COPY.guideDetail.ctaButton}
        </Link>
      </BezelCard>

      {checkedAt && (
        <p className="mt-8 text-xs leading-relaxed text-foreground-muted">
          Fuentes consultadas al {formatDate(checkedAt, { style: "long" })}. Esta guía informa,
          no asesora: para tu caso puntual, confirmá siempre con la fuente oficial o con un
          profesional.
        </p>
      )}
    </article>
  );
}
