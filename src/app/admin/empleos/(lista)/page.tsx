import { Briefcase, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { EmptyState } from "@/components/ui";
import { CommunitySwitcher } from "@/components/admin/community-switcher";
import { JobListingRow } from "@/components/admin/job-listing-row";
import { getTenant } from "@/lib/tenant/resolve";
import { requireStaff } from "../../guard";
import { COMMUNITY_PARAM, firstParam, resolveAdminScope } from "../../scope";
import { fetchAdminJobs, type AdminJobRow } from "../queries";

export const metadata = { title: "Empleos" };

/**
 * Panel de EMPLEOS (domain_admin+): los avisos de trabajo de la comunidad con
 * cuántas postulaciones entraron y cuántas siguen sin respuesta.
 *
 * Rol mínimo `domain_admin`, no `moderator`: esto no es una cola de moderación
 * de contenido, es la operación de una sección de la comunidad (el mismo nivel
 * que /admin/dominio). Cuantas menos personas puedan abrir la bandeja de un
 * aviso, mejor.
 *
 * Esta pantalla NO expone nada privado: título, estado, quién publicó (público
 * en el aviso) y CONTEOS. Por eso no se audita — la auditoría empieza cuando se
 * abre el detalle de un aviso (ver [id]/page.tsx).
 *
 * SELECTOR DE COMUNIDAD (súper admin). Mirando otra comunidad los conteos SÍ se
 * muestran: la 0075 le dio a `job_application_tally` su rama
 * `app.is_global_admin()` y la RPC ya cuenta en toda la plataforma. Lo que sigue
 * gateado contra el tenant del JWT es la BANDEJA de un aviso —quién se postuló y
 * qué escribió, que es dato de personas—, así que el listado queda en SOLO
 * LECTURA: se ven los números, no se entra al detalle.
 */

const COPY = {
  title: "Empleos de la comunidad",
  intro:
    "Los avisos de trabajo y cuánta gente se postuló. Entrá a uno para ver el detalle de sus postulaciones.",
  pendingSummary: (n: number) =>
    n === 1
      ? "1 postulación esperando respuesta"
      : `${n} postulaciones esperando respuesta`,
  allAnswered: "Todas las postulaciones están respondidas.",
  emptyTitle: "Todavía no hay avisos de trabajo",
  emptyMessage:
    "Cuando alguien publique un empleo va a aparecer acá, con las postulaciones que reciba.",
  errorTitle: "No pudimos cargar los avisos",
  errorMessage: "Puede ser algo pasajero. Recargá la página en un momento.",
  foreignNote:
    "Estás mirando los avisos de otra comunidad. Ves cuántas postulaciones tiene cada uno, pero para abrir una postulación y ver quién la mandó hay que entrar desde la comunidad dueña del aviso.",
} as const;

export default async function AdminEmpleosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireStaff("domain_admin");
  const { supabase, tenantId: jwtTenantId } = ctx;
  const tenant = await getTenant();
  const scope = await resolveAdminScope(ctx, firstParam((await searchParams)[COMMUNITY_PARAM]));
  // El tenant REAL del staff es el del JWT (el Host header es cosmético acá).
  const tenantId = scope.tenantId ?? jwtTenantId ?? tenant.id;

  let jobs: AdminJobRow[] = [];
  let failed = false;
  try {
    jobs = await fetchAdminJobs(supabase, tenantId);
  } catch {
    // Error VISIBLE: nada de una lista vacía que miente diciendo "no hay avisos".
    failed = true;
  }

  if (failed) {
    return (
      <section aria-labelledby="empleos-title" className="flex flex-col gap-4">
        <header>
          <h2 id="empleos-title" className="font-display text-2xl font-bold text-foreground">
            {COPY.title}
          </h2>
        </header>
        <EmptyState
          icon={<WarningCircle />}
          title={COPY.errorTitle}
          message={COPY.errorMessage}
        />
      </section>
    );
  }

  const pendingTotal = jobs.reduce((sum, job) => sum + job.pending, 0);

  return (
    <section aria-labelledby="empleos-title" className="flex flex-col gap-4">
      <header>
        <h2 id="empleos-title" className="font-display text-2xl font-bold text-foreground">
          {COPY.title}
        </h2>
        <p className="mt-1 text-sm text-foreground-secondary">{COPY.intro}</p>
        {jobs.length > 0 && (
          <p className="mt-2 text-xs font-medium tabular-nums text-foreground-muted">
            {pendingTotal > 0 ? COPY.pendingSummary(pendingTotal) : COPY.allAnswered}
          </p>
        )}
      </header>

      {scope.canSwitch && (
        <CommunitySwitcher
          basePath="/admin/empleos"
          communities={scope.communities}
          activeTenantId={scope.tenantId}
          isForeign={scope.isForeign}
        />
      )}

      {scope.isForeign && (
        <p className="rounded-md border border-border-subtle bg-surface-subtle px-3 py-2 text-xs leading-relaxed text-foreground-secondary">
          {COPY.foreignNote}
        </p>
      )}

      {jobs.length === 0 ? (
        <EmptyState
          icon={<Briefcase />}
          title={COPY.emptyTitle}
          message={COPY.emptyMessage}
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {jobs.map((job) => (
            <JobListingRow key={job.id} job={job} readOnly={scope.isForeign} />
          ))}
        </ul>
      )}
    </section>
  );
}
