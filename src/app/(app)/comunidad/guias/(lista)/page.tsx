import { Suspense } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, BookOpenText, Clock } from "@phosphor-icons/react/dist/ssr";
import { Chip, EmptyState } from "@/components/ui";
import { ComunidadHeading, GuiaListSkeleton, OrigenNota } from "@/components/comunidad";
import { GUIDE_COVERS } from "@/components/marketing/copy";
import { estimateReadingMinutes, fetchPublishedGuides } from "@/components/marketing/data";
import { COMUNIDAD_COPY } from "@/lib/comunidad";
import { cn } from "@/lib/utils";

export const metadata = { title: "Guías para los trámites" };

const C = COMUNIDAD_COPY.guias;

/**
 * LAS GUÍAS, DENTRO DE COMUNIDAD.
 *
 * El pedido del cliente fue textual: «lo que ustedes tienen en Guía saldría
 * aquí en el módulo de Comunidad». Así que esto NO es contenido nuevo ni una
 * tabla nueva: es la MISMA `public.guides` (0007), leída con las MISMAS
 * funciones que ya usa el sitio público (`fetchPublishedGuides`, con su cache
 * de 600s por tenant y su tag "guides").
 *
 * ── POR QUÉ HAY UNA PANTALLA ACÁ SI YA EXISTE /guias ────────────────────────
 * `/guias` es una ruta de marketing: página pública, indexable, con JSON-LD y
 * un CTA a registrarse. Mandar ahí a alguien que YA está adentro de la app lo
 * saca del shell (pierde el menú, el back del sistema y la sesión visual) y le
 * ofrece crear la cuenta que ya tiene. Esta pantalla lee lo mismo y lo muestra
 * adentro. La ruta de SEO se queda intacta y sigue siendo la canónica: no se
 * duplicó ni una línea de datos, sólo la presentación.
 */
export default function ComunidadGuiasPage() {
  return (
    <>
      <ComunidadHeading
        className="mt-2"
        icon={<BookOpenText size={30} weight="fill" aria-hidden="true" />}
        title={C.title}
        subtitle={C.subtitle}
      />

      <OrigenNota className="mt-5" incluirMigracion />

      <Suspense fallback={<div className="mt-8"><GuiaListSkeleton /></div>}>
        <Listado />
      </Suspense>
    </>
  );
}

async function Listado() {
  const guias = await fetchPublishedGuides();

  if (guias.length === 0) {
    return (
      <EmptyState
        className="mt-8"
        illustration="/images/empty-state-search.png"
        title={C.emptyTitle}
        message={C.emptyMessage}
      />
    );
  }

  return (
    <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
      {guias.map((guia) => {
        const minutos = guia.reading_minutes ?? estimateReadingMinutes(guia.body_md);
        const cover = GUIDE_COVERS[guia.slug] ?? null;

        return (
          <Link
            key={guia.slug}
            href={`/comunidad/guias/${guia.slug}`}
            className={cn(
              "group flex h-full flex-col overflow-hidden rounded-lg border border-border-subtle bg-surface shadow-sm",
              "transition-[box-shadow,transform] duration-(--duration-base) ease-(--ease-out-premium)",
              "hover:-translate-y-0.5 hover:shadow-md motion-reduce:hover:translate-y-0",
              "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
            )}
          >
            {cover ? (
              <div className="relative aspect-[16/9] w-full overflow-hidden bg-surface-subtle">
                <Image
                  src={cover}
                  alt=""
                  fill
                  sizes="(min-width: 640px) 45vw, 90vw"
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
              {guia.topics.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {guia.topics.slice(0, 3).map((tema) => (
                    <Chip key={tema} size="sm">
                      {tema}
                    </Chip>
                  ))}
                </div>
              )}

              <h2 className="font-display text-lg font-semibold leading-snug text-foreground">
                {guia.title}
              </h2>

              {guia.summary && (
                <p className="line-clamp-3 text-sm leading-relaxed text-foreground-secondary">
                  {guia.summary}
                </p>
              )}

              <div className="mt-auto flex items-center justify-between pt-2 text-sm text-foreground-muted">
                <span className="inline-flex items-center gap-1.5">
                  <Clock size={16} aria-hidden="true" />
                  {C.readingTime(minutos)}
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
      })}
    </div>
  );
}
