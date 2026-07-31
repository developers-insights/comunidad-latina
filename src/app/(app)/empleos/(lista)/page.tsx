import { Suspense } from "react";
import Link from "next/link";
import { CaretDown, CaretRight, ClipboardText, Plus } from "@phosphor-icons/react/dist/ssr";
import { EmptyState, SectionCta, SectionHeading, Skeleton, buttonVariants } from "@/components/ui";
import { COPY } from "@/components/empleos/copy";
import { EmploymentTypeChips } from "@/components/empleos/employment-type-chips";
import { EMPLOYMENT_TYPES, type EmploymentType } from "@/components/empleos/helpers";
import { JobCard } from "@/components/empleos/job-card";
import { JobListSkeleton } from "@/components/empleos/job-skeletons";
import { t } from "@/lib/i18n";
import { getTenant } from "@/lib/tenant/resolve";
import { cn } from "@/lib/utils";
import { fetchJobsPage } from "../queries";

export const metadata = { title: "Empleos" };

const C = COPY.list;

/** Acento + ícono 3D de la sección (los mismos del menú y de /buscar). */
const SECCION = {
  accent: "var(--accent-empleos)",
  image: "/icons/menu/empleos.webp",
  publicarHref: "/empleos/publicar",
} as const;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

interface Filters {
  tipo: EmploymentType | "";
  cursor: string;
}

function firstValue(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

function isEmploymentType(value: string): value is EmploymentType {
  return (EMPLOYMENT_TYPES as readonly string[]).includes(value);
}

function parseFilters(sp: Record<string, string | string[] | undefined>): Filters {
  const tipo = firstValue(sp.tipo).slice(0, 20);
  return {
    tipo: isEmploymentType(tipo) ? tipo : "",
    cursor: firstValue(sp.cursor).slice(0, 200),
  };
}

export default async function EmpleosPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const filters = parseFilters(sp);

  // La key remonta el Suspense en cada cambio de filtro/página: el skeleton
  // vuelve a aparecer en vez de dejar la lista vieja congelada.
  return (
    <Suspense key={JSON.stringify(filters)} fallback={<PageSkeleton />}>
      <EmpleosContent filters={filters} />
    </Suspense>
  );
}

// ---------------------------------------------------------------------------
// Contenido (streamed): datos reales con RLS del usuario
// ---------------------------------------------------------------------------

async function EmpleosContent({ filters }: { filters: Filters }) {
  const tenant = await getTenant();

  const { items, nextCursor } = await fetchJobsPage({
    tenantId: tenant.id,
    employmentType: filters.tipo || null,
    cursor: filters.cursor || null,
  });

  const nextParams = new URLSearchParams();
  if (filters.tipo) nextParams.set("tipo", filters.tipo);
  if (nextCursor) nextParams.set("cursor", nextCursor);

  return (
    <>
      {/* El título largo ("Empleos en tu comunidad") ya no compite con un botón
          a su derecha: publicar se fue a su propia burbuja, debajo. Adiós al
          label que se acortaba en móvil. */}
      <SectionHeading
        accent={SECCION.accent}
        image={SECCION.image}
        title={C.title}
        subtitle={C.subtitle}
      />

      <SectionCta
        accent={SECCION.accent}
        href={SECCION.publicarHref}
        title={t("sections", "publishJobTitle")}
        hint={t("sections", "publishJobHint")}
        className="mb-3 mt-3"
      />

      {/* Entrada a "Mis postulaciones": quien busca trabajo vuelve todos los
          días a ver si le contestaron, y el único camino no puede ser abrir
          aviso por aviso. Va acá arriba, antes de los filtros, porque es una
          visita RECURRENTE — no una acción del listado. */}
      <Link
        href="/empleos/mis-aplicaciones"
        className={cn(
          "mb-5 flex min-h-11 items-center gap-2 rounded-full border border-border bg-surface px-4 py-2",
          "text-sm font-semibold text-foreground-secondary",
          "transition-colors duration-(--duration-fast) hover:bg-surface-subtle hover:text-foreground",
          "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
        )}
      >
        <ClipboardText size={18} aria-hidden="true" className="text-[var(--accent-empleos)]" />
        {COPY.myApplications.title}
        <CaretRight size={14} weight="bold" aria-hidden="true" className="ml-auto" />
      </Link>

      <EmploymentTypeChips className="mb-5" />

      {items.length === 0 ? (
        <EmptyState
          illustration="/images/empty-state-search.png"
          title={filters.tipo ? C.emptyFilteredTitle : C.emptyTitle}
          message={filters.tipo ? C.emptyFilteredMessage : C.emptyMessage}
          action={
            <Link
              href="/empleos/publicar"
              className={buttonVariants({ variant: "primary", size: "md" })}
            >
              <Plus size={18} aria-hidden="true" />
              {C.emptyPublishCta}
            </Link>
          }
        />
      ) : (
        <div className="flex flex-col gap-4">
          {/* El shell de la app está capado en max-w-lg, así que una tercera
              columna nunca entraría: una card ancha por fila en el celular
              (misma lectura de red social que /eventos) y dos desde sm. */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {items.map((job) => (
              <JobCard key={job.id} job={job} />
            ))}
          </div>

          {nextCursor && (
            <Link
              href={`/empleos?${nextParams.toString()}`}
              className={cn(buttonVariants({ variant: "outline", size: "md" }), "w-full")}
            >
              {C.loadMore}
              <CaretDown size={16} aria-hidden="true" />
            </Link>
          )}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Fallback: silueta del header + chips + cards (shimmer, §5.2)
// ---------------------------------------------------------------------------

function PageSkeleton() {
  return (
    <div aria-busy="true">
      <SectionHeading
        accent={SECCION.accent}
        image={SECCION.image}
        title={C.title}
        subtitle={C.subtitle}
      />
      <SectionCta
        accent={SECCION.accent}
        href={SECCION.publicarHref}
        title={t("sections", "publishJobTitle")}
        hint={t("sections", "publishJobHint")}
        className="mb-4 mt-3"
      />
      <div className="mb-5 flex gap-2">
        <Skeleton className="h-11 w-20 rounded-full" />
        <Skeleton className="h-11 w-36 rounded-full" />
        <Skeleton className="h-11 w-32 rounded-full" />
      </div>
      <JobListSkeleton />
    </div>
  );
}
