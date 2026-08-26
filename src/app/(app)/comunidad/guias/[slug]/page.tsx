import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowSquareOut, Buildings, Clock } from "@phosphor-icons/react/dist/ssr";
import { BezelCard, Chip } from "@/components/ui";
import {
  estimateReadingMinutes,
  fetchGuideBySlug,
  parseGuideSources,
} from "@/components/marketing/data";
import { Markdown } from "@/components/marketing/markdown";
import { COMUNIDAD_COPY } from "@/lib/comunidad";
import { formatDate } from "@/lib/utils";

const C = COMUNIDAD_COPY.guias;

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const guia = await fetchGuideBySlug(slug);
  return guia ? { title: guia.title } : {};
}

/**
 * LECTURA DE UNA GUÍA DENTRO DE LA APP.
 *
 * Misma fila de `public.guides` que sirve `/guias/[slug]`, mismo
 * `fetchGuideBySlug` cacheado, mismo renderer de Markdown (que construye nodos
 * React y jamás usa dangerouslySetInnerHTML). Lo que cambia respecto de la
 * página pública, y por qué:
 *
 *  · SIN JSON-LD ni canonical: la ruta indexable es `/guias/[slug]`, y dos URLs
 *    peleándose el mismo artículo es exactamente lo que no se hace.
 *  · SIN el CTA a `/registro`: quien está acá ya entró.
 *  · CON las fuentes arriba del fold, igual que en la pública. Eso no se toca:
 *    es lo que sostiene que la guía INFORMA y no asesora (§11). La guía además
 *    no se pudo publicar sin citarlas — lo impide el CHECK
 *    `guides_published_need_sources` de la 0007.
 */
export default async function ComunidadGuiaPage({ params }: Props) {
  const { slug } = await params;
  const guia = await fetchGuideBySlug(slug);
  if (!guia) notFound();

  const fuentes = parseGuideSources(guia.sources);
  const minutos = guia.reading_minutes ?? estimateReadingMinutes(guia.body_md);

  return (
    <article>
      <Link
        href="/comunidad/guias"
        className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-foreground-secondary transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
      >
        <ArrowLeft size={16} aria-hidden="true" />
        {C.back}
      </Link>

      <header className="mt-4">
        {guia.topics.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {guia.topics.map((tema) => (
              <Chip key={tema} size="sm">
                {tema}
              </Chip>
            ))}
          </div>
        )}

        <h1 className="font-display text-2xl font-bold leading-tight tracking-tight text-foreground sm:text-3xl">
          {guia.title}
        </h1>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-foreground-muted">
          <span className="inline-flex items-center gap-1.5">
            <Clock size={16} aria-hidden="true" />
            {C.readingTime(minutos)}
          </span>
          <span>{C.updated(formatDate(guia.updated_at, { style: "long" }))}</span>
        </div>
      </header>

      {/* Fuentes oficiales — SIEMPRE arriba del texto, nunca al pie. */}
      {fuentes.length > 0 && (
        <BezelCard variant="featured" className="mt-6" coreClassName="p-5">
          <h2 className="flex items-center gap-2 font-display text-base font-semibold text-foreground">
            {/* `Buildings` y no `SealCheck`: el sello con tilde es la marca de
                un plan contratado (check azul, Presencia Verificada). Este
                bloque sólo dice de dónde sale la información — no certifica a
                nadie ni la plataforma la avala. */}
            <Buildings size={18} weight="fill" aria-hidden="true" className="text-brand-ink" />
            {C.sourcesTitle}
          </h2>
          <ul className="mt-3 space-y-2">
            {fuentes.map((fuente) => (
              <li key={fuente.url}>
                <a
                  href={fuente.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-start gap-1.5 text-sm font-medium text-brand-ink underline decoration-brand-subtle underline-offset-2 hover:decoration-brand-ink focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
                >
                  <span>{fuente.label}</span>
                  <ArrowSquareOut size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
                </a>
                {fuente.checkedAt && (
                  <span className="ml-2 text-xs text-foreground-muted">
                    {C.checked(formatDate(fuente.checkedAt, { style: "medium" }))}
                  </span>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-3 border-t border-border-subtle pt-3 text-xs leading-relaxed text-foreground-secondary">
            {COMUNIDAD_COPY.disclaimer.notAdvice}
          </p>
        </BezelCard>
      )}

      <div className="mt-8">
        <Markdown source={guia.body_md} />
      </div>
    </article>
  );
}
