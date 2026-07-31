import { Suspense } from "react";
import Link from "next/link";
import { Briefcase, CaretLeft } from "@phosphor-icons/react/dist/ssr";
import { EmptyState, SectionHeading, Skeleton, buttonVariants } from "@/components/ui";
import { COPY } from "@/components/empleos/copy";
import { MyApplicationCard } from "@/components/empleos/my-application-card";
import { isTerminalStatus } from "@/lib/empleos/application-status";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { cn } from "@/lib/utils";
import { fetchMyApplications } from "../queries";

export const metadata = { title: "Mis postulaciones" };

const C = COPY.myApplications;

/** Acento + ícono 3D de la sección (los mismos del menú y de /buscar). */
const SECCION = {
  accent: "var(--accent-empleos)",
  image: "/icons/menu/empleos.webp",
} as const;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

type Filter = "todas" | "en-curso" | "cerradas";

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: "todas", label: C.filterAll },
  { value: "en-curso", label: C.filterOpen },
  { value: "cerradas", label: C.filterClosed },
];

function parseFilter(value: string | string[] | undefined): Filter {
  const raw = (Array.isArray(value) ? value[0] : value) ?? "";
  return raw === "en-curso" || raw === "cerradas" ? raw : "todas";
}

export default async function MisAplicacionesPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const filter = parseFilter((await searchParams).estado);

  return (
    <Suspense key={filter} fallback={<PageSkeleton />}>
      <Content filter={filter} />
    </Suspense>
  );
}

// ---------------------------------------------------------------------------
// Contenido (streamed): la RLS ya limita las filas a las propias
// ---------------------------------------------------------------------------

async function Content({ filter }: { filter: Filter }) {
  const [tenant, supabase] = await Promise.all([getTenant(), createClient()]);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <>
        <Header />
        <EmptyState
          icon={<Briefcase />}
          title={C.needLoginTitle}
          message={C.needLoginBody}
          action={
            <Link
              href={`/entrar?next=${encodeURIComponent("/empleos/mis-aplicaciones")}`}
              className={buttonVariants({ variant: "primary", size: "md" })}
            >
              {C.needLoginCta}
            </Link>
          }
        />
      </>
    );
  }

  const all = await fetchMyApplications({ tenantId: tenant.id, viewerId: user.id });
  const applications = all.filter((application) => {
    if (filter === "en-curso") return !isTerminalStatus(application.status);
    if (filter === "cerradas") return isTerminalStatus(application.status);
    return true;
  });

  // Sin ninguna postulación el filtro no significa nada: se muestra el estado
  // vacío de verdad, con la salida que la persona necesita (ver avisos).
  if (all.length === 0) {
    return (
      <>
        <Header />
        <EmptyState
          illustration="/images/empty-state-search.png"
          title={C.emptyTitle}
          message={C.emptyMessage}
          action={
            <Link
              href="/empleos"
              className={buttonVariants({ variant: "primary", size: "md" })}
            >
              <Briefcase size={18} weight="fill" aria-hidden="true" />
              {C.emptyCta}
            </Link>
          }
        />
      </>
    );
  }

  return (
    <>
      <Header />

      <nav aria-label={C.filterAll} className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((option) => {
          const active = option.value === filter;
          return (
            <Link
              key={option.value}
              href={
                option.value === "todas"
                  ? "/empleos/mis-aplicaciones"
                  : `/empleos/mis-aplicaciones?estado=${option.value}`
              }
              aria-current={active ? "page" : undefined}
              scroll={false}
              style={
                active
                  ? {
                      borderColor: "color-mix(in oklab, var(--accent-empleos) 55%, transparent)",
                      backgroundColor: "color-mix(in oklab, var(--accent-empleos) 14%, transparent)",
                    }
                  : undefined
              }
              className={cn(
                "inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-semibold",
                "transition-[background-color,border-color] duration-(--duration-fast)",
                "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
                active
                  ? "text-foreground"
                  : "border-border bg-surface text-foreground-secondary hover:bg-surface-subtle",
              )}
            >
              {option.label}
            </Link>
          );
        })}
      </nav>

      {applications.length === 0 ? (
        <EmptyState
          icon={<Briefcase />}
          title={filter === "en-curso" ? C.emptyOpenTitle : C.emptyClosedTitle}
          message={filter === "en-curso" ? C.emptyOpenMessage : C.emptyClosedMessage}
          action={
            <Link
              href="/empleos"
              className={buttonVariants({ variant: "outline", size: "md" })}
            >
              {C.backToJobs}
            </Link>
          }
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {applications.map((application) => (
            <MyApplicationCard key={application.id} application={application} />
          ))}
        </ul>
      )}
    </>
  );
}

function Header() {
  return (
    <>
      <Link
        href="/empleos"
        className={cn(
          "mb-2 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-foreground-secondary",
          "hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
        )}
      >
        <CaretLeft size={16} weight="bold" aria-hidden="true" />
        {C.backToJobs}
      </Link>
      <SectionHeading
        accent={SECCION.accent}
        image={SECCION.image}
        title={C.title}
        subtitle={C.subtitle}
      />
      <div className="mb-4" />
    </>
  );
}

function PageSkeleton() {
  return (
    <div aria-busy="true">
      <Header />
      <div className="mb-4 flex gap-2">
        <Skeleton className="h-11 w-24 rounded-full" />
        <Skeleton className="h-11 w-28 rounded-full" />
        <Skeleton className="h-11 w-28 rounded-full" />
      </div>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-40 w-full rounded-lg" />
        <Skeleton className="h-40 w-full rounded-lg" />
      </div>
    </div>
  );
}
