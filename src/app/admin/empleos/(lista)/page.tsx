import { Briefcase, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { EmptyState } from "@/components/ui";
import { JobListingRow } from "@/components/admin/job-listing-row";
import { getTenant } from "@/lib/tenant/resolve";
import { requireStaff } from "../../guard";
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
} as const;

export default async function AdminEmpleosPage() {
  const { supabase, tenantId: jwtTenantId } = await requireStaff("domain_admin");
  const tenant = await getTenant();
  // El tenant REAL del staff es el del JWT (el Host header es cosmético acá).
  const tenantId = jwtTenantId ?? tenant.id;

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

      {jobs.length === 0 ? (
        <EmptyState
          icon={<Briefcase />}
          title={COPY.emptyTitle}
          message={COPY.emptyMessage}
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {jobs.map((job) => (
            <JobListingRow key={job.id} job={job} />
          ))}
        </ul>
      )}
    </section>
  );
}
