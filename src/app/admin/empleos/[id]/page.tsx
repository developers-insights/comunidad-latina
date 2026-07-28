import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Briefcase,
  Lock,
  WarningCircle,
} from "@phosphor-icons/react/dist/ssr";
import { Badge, Banner, EmptyState, type BadgeProps } from "@/components/ui";
import { JobApplicantCard } from "@/components/admin/job-applicant-card";
import { getTenant } from "@/lib/tenant/resolve";
import { requireStaff, logAdminAction } from "../../guard";
import { fetchAdminJobDetail, type AdminJobDetail } from "../queries";

/**
 * Detalle de un aviso de empleo en el panel (domain_admin+): quién se postuló
 * y —solo si corresponde— qué respondió.
 *
 * DOS FRONTERAS, las dos server-side:
 *
 *  1. ROL — `requireStaff("domain_admin")`. Un moderator no entra: modera
 *     contenido, no opera la bolsa de trabajo.
 *
 *  2. DIVULGACIÓN — `jobDisclosure()` en ../policy.ts. Sobre un aviso de un
 *     MIEMBRO, las respuestas y la nota no se leen siquiera de la DB (ver
 *     ../queries.ts): la página muestra cuántas postulaciones hay y en qué
 *     estado, y explica por qué no muestra más.
 *
 * AUDITORÍA — abrir esta pantalla es acceso administrativo a datos de personas,
 * así que se registra SIEMPRE, con `revealed` diciendo si además se vio el
 * contenido. `meta` lleva ids y conteos, nunca contenido (§5.4). Se audita en
 * el render y no detrás de un botón a propósito: el prefetch de Next también
 * transfiere estos datos al browser — si viajaron, hubo acceso.
 */

export const metadata = { title: "Postulaciones" };

// El audit_log tiene que registrar CADA apertura: sin esto, una segunda visita
// se serviría de caché y el acceso no dejaría rastro.
export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const COPY = {
  back: "Volver a Empleos",
  statusLabel: {
    published: "Activo",
    pending_review: "En revisión",
    draft: "Borrador",
    removed: "Dado de baja",
  } as Record<string, string>,
  publishedBy: (name: string) => `Publicado por ${name}`,
  applicationsTitle: "Postulaciones",
  countLine: (total: number, pending: number) =>
    pending > 0
      ? `${total} en total · ${pending} sin responder`
      : `${total} en total · todas respondidas`,
  platformNotice:
    "Este aviso es de la plataforma, así que podés leer las respuestas y contestar vos mismo. Quien se postuló va a ver que responde el equipo de la comunidad.",
  memberNoticeTitle: "Las respuestas son privadas",
  memberNotice:
    "Este aviso es de un miembro de la comunidad. Lo que la gente responde queda entre esa persona y quien publicó. Acá ves cuántas postulaciones llegaron y si siguen sin respuesta.",
  tallyTotal: "Postulaciones recibidas",
  tallyPending: "Sin responder",
  tallyEmpty: "Todavía no se postuló nadie a este aviso.",
  tallyWaiting:
    "Hay gente esperando respuesta. Si el aviso lleva mucho así, escribile a quien lo publicó.",
  tallyAnswered: "Quien publicó el aviso ya respondió todas.",
  emptyTitle: "Todavía nadie se postuló",
  emptyMessage:
    "Cuando alguien se postule a este aviso vas a verlo acá, con la fecha y su estado.",
  errorTitle: "No pudimos cargar las postulaciones",
  errorMessage: "Puede ser algo pasajero. Recargá la página en un momento.",
  openPublic: "Ver el aviso como lo ve la comunidad",
  auditDownTitle: "No podemos mostrar las respuestas ahora",
  auditDown:
    "Cada vez que alguien del equipo abre las respuestas de una persona queda registrado, y ese registro no está funcionando. Mientras tanto ves solo cuántas postulaciones hay. Avisale al equipo técnico.",
} as const;

const STATUS_VARIANT: Record<string, NonNullable<BadgeProps["variant"]>> = {
  published: "success",
  pending_review: "warning",
  draft: "neutral",
  removed: "neutral",
};

export default async function AdminEmpleoDetallePage({ params }: { params: Params }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const { supabase, user, tenantId: jwtTenantId } = await requireStaff("domain_admin");
  const tenant = await getTenant();
  const tenantId = jwtTenantId ?? tenant.id;

  let detail: AdminJobDetail | null = null;
  let failed = false;
  try {
    detail = await fetchAdminJobDetail(supabase, { jobId: id, tenantId, staffId: user.id });
  } catch {
    failed = true;
  }

  if (failed) {
    return (
      <div className="flex flex-col gap-4">
        <BackLink />
        <EmptyState icon={<WarningCircle />} title={COPY.errorTitle} message={COPY.errorMessage} />
      </div>
    );
  }
  if (!detail) notFound();

  // Acceso administrativo a datos de personas → auditado en cada apertura.
  // Solo ids y conteos: ni nombres ni respuestas entran nunca al audit_log.
  const audited = await logAdminAction({
    actorId: user.id,
    action: "job_applications.viewed",
    tenantId,
    subjectKind: "listing",
    subjectId: detail.id,
    meta: {
      applications: detail.totals.total,
      pending: detail.totals.pending,
      revealed: detail.disclosure === "platform",
    },
  });

  /**
   * SIN AUDITORÍA NO HAY DIVULGACIÓN.
   *
   * El registro es lo que hace que leer las respuestas de alguien sea un acto
   * del que se rinde cuentas. Si `logAdminAction` no pudo asentarlo (falta la
   * service role key, la tabla no responde), mostrar igual el contenido sería
   * quedarse con el poder y perder el control: la pantalla degrada al nivel
   * "member" —solo metadatos— y lo dice. Es el único caso del panel donde una
   * auditoría caída cambia lo que se ve.
   */
  const canResolve = detail.disclosure === "platform" && audited;
  const suppressed = detail.disclosure === "platform" && !audited;
  const applications = suppressed
    ? detail.applications.map((application) => ({
        ...application,
        displayName: null,
        avatarUrl: null,
        message: null,
        answers: [],
      }))
    : detail.applications;

  return (
    <div className="flex flex-col gap-6">
      <BackLink />

      <header>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={STATUS_VARIANT[detail.status] ?? "neutral"}>
            {COPY.statusLabel[detail.status] ?? detail.status}
          </Badge>
          {detail.areaLabel && (
            <span className="text-xs text-foreground-muted">{detail.areaLabel}</span>
          )}
        </div>
        <h2 className="mt-2 font-display text-2xl font-bold text-foreground">{detail.title}</h2>
        <p className="mt-1 text-sm text-foreground-secondary">
          {COPY.publishedBy(detail.publisherLabel)} · {detail.createdAtLabel}
        </p>
        {detail.status === "published" && (
          <Link
            href={`/empleos/${detail.id}`}
            className="mt-2 inline-flex min-h-11 items-center text-sm font-medium text-brand-ink hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
          >
            {COPY.openPublic}
          </Link>
        )}
      </header>

      {suppressed ? (
        <Banner variant="warning" className="rounded-lg">
          <span className="font-semibold">{COPY.auditDownTitle}.</span> {COPY.auditDown}
        </Banner>
      ) : canResolve ? (
        <Banner variant="info" className="rounded-lg">
          {COPY.platformNotice}
        </Banner>
      ) : (
        /* Aviso de privacidad, no de error: tono neutro, sin alarma. Explica
           por qué no se muestran las respuestas — un panel que no explica sus
           límites se lee como roto. */
        <div className="flex items-start gap-3 rounded-lg border border-border bg-surface-subtle px-4 py-3">
          <Lock
            size={18}
            weight="fill"
            aria-hidden="true"
            className="mt-0.5 shrink-0 text-foreground-muted"
          />
          <p className="min-w-0 flex-1 text-sm text-foreground-secondary">
            <span className="font-semibold text-foreground">{COPY.memberNoticeTitle}.</span>{" "}
            {COPY.memberNotice}
          </p>
        </div>
      )}

      <section aria-labelledby="postulaciones-title" className="flex flex-col gap-3">
        <div>
          <h3
            id="postulaciones-title"
            className="font-display text-lg font-semibold text-foreground"
          >
            {COPY.applicationsTitle}
          </h3>
          {applications.length > 0 && (
            <p className="text-xs tabular-nums text-foreground-muted">
              {COPY.countLine(detail.totals.total, detail.totals.pending)}
            </p>
          )}
        </div>

        {detail.disclosure === "member" ? (
          /* Aviso de un miembro: no hay tarjetas porque no hay filas — desde
             0042 la base no nos las da, y está bien. Lo que el panel promete
             sobre este aviso es el NÚMERO, y eso es lo que se muestra. Pintar
             un "todavía nadie se postuló" acá sería mentir. */
          <ApplicationTallyPanel total={detail.totals.total} pending={detail.totals.pending} />
        ) : applications.length === 0 ? (
          <EmptyState
            icon={<Briefcase />}
            title={COPY.emptyTitle}
            message={COPY.emptyMessage}
            className="py-8"
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {applications.map((application) => (
              <JobApplicantCard
                key={application.id}
                application={application}
                canResolve={canResolve}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/**
 * Lo único que el panel puede decir de un aviso ajeno: cuántas postulaciones
 * hay y cuántas siguen sin respuesta. Números grandes y una lectura en una
 * línea — quien opera necesita decidir "¿esto está muerto?" de un vistazo.
 */
function ApplicationTallyPanel({ total, pending }: { total: number; pending: number }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4 shadow-xs">
      <dl className="grid grid-cols-2 gap-3">
        <div>
          <dt className="text-xs text-foreground-muted">{COPY.tallyTotal}</dt>
          <dd className="mt-0.5 text-2xl font-bold tabular-nums text-foreground">
            {total.toLocaleString("es-US")}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-foreground-muted">{COPY.tallyPending}</dt>
          <dd
            className={`mt-0.5 text-2xl font-bold tabular-nums ${
              pending > 0 ? "text-warning-ink" : "text-foreground"
            }`}
          >
            {pending.toLocaleString("es-US")}
          </dd>
        </div>
      </dl>
      <p className="mt-3 text-sm text-foreground-secondary">
        {total === 0 ? COPY.tallyEmpty : pending > 0 ? COPY.tallyWaiting : COPY.tallyAnswered}
      </p>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/admin/empleos"
      className="inline-flex min-h-11 items-center gap-1.5 self-start text-sm font-medium text-foreground-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
    >
      <ArrowLeft size={16} aria-hidden="true" />
      {COPY.back}
    </Link>
  );
}
