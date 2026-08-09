import Link from "next/link";
import { CaretRight } from "@phosphor-icons/react/dist/ssr";
import { Badge, type BadgeProps } from "@/components/ui";
import type { AdminJobRow } from "@/app/admin/empleos/queries";

/**
 * Una fila del listado de Empleos del panel: metadatos de moderación + cuántas
 * postulaciones entraron. Server component puro (sin estado) — abre el detalle.
 *
 * NO muestra nada de quien se postula: el listado trabaja con CONTEOS, que no
 * identifican a nadie (ver app/admin/empleos/policy.ts).
 */

const COPY = {
  statusLabel: {
    published: "Activo",
    pending_review: "En revisión",
    draft: "Borrador",
    removed: "Dado de baja",
  } as Record<string, string>,
  platform: "De la plataforma",
  none: "Sin postulaciones",
  applications: (n: number) => (n === 1 ? "1 postulación" : `${n} postulaciones`),
  pending: (n: number) => (n === 1 ? "1 sin responder" : `${n} sin responder`),
  open: "Ver postulaciones",
} as const;

const STATUS_VARIANT: Record<string, NonNullable<BadgeProps["variant"]>> = {
  published: "success",
  pending_review: "warning",
  draft: "neutral",
  removed: "neutral",
};

export function JobListingRow({
  job,
  /**
   * Sin detalle ni conteos: el súper admin está mirando OTRA comunidad. La
   * bandeja de un aviso muestra datos de personas y su lectura se gatea (y se
   * audita) contra el tenant del JWT, así que desde acá no se entra.
   */
  readOnly = false,
}: {
  job: AdminJobRow;
  readOnly?: boolean;
}) {
  const body = (
    <>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={STATUS_VARIANT[job.status] ?? "neutral"}>
            {COPY.statusLabel[job.status] ?? job.status}
          </Badge>
          {job.isPlatformJob && <Badge variant="brand">{COPY.platform}</Badge>}
          {job.pending > 0 && <Badge variant="info">{COPY.pending(job.pending)}</Badge>}
        </div>

        <h3 className="mt-1.5 truncate text-sm font-semibold text-foreground">{job.title}</h3>

        <p className="mt-0.5 truncate text-xs text-foreground-muted">
          {job.publisherLabel} · {job.createdAtLabel} ·{" "}
          <span className="tabular-nums">
            {job.applications === 0 ? COPY.none : COPY.applications(job.applications)}
          </span>
        </p>
      </div>

      {!readOnly && (
        <CaretRight size={18} aria-hidden="true" className="shrink-0 text-foreground-muted" />
      )}
    </>
  );

  const shell =
    "flex min-h-11 items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3 shadow-xs";

  return (
    <li>
      {readOnly ? (
        <div className={shell}>{body}</div>
      ) : (
        <Link
          href={`/admin/empleos/${job.id}`}
          aria-label={`${COPY.open}: ${job.title}`}
          className={`${shell} transition-colors duration-(--duration-fast) hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring`}
        >
          {body}
        </Link>
      )}
    </li>
  );
}
