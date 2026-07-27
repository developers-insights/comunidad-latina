import { Briefcase, MapPin } from "@phosphor-icons/react/dist/ssr";
import { AccentLink, BezelCard } from "@/components/ui";
import { DirectoryMedia } from "@/components/directory";
import { PhotoTap } from "@/components/media/photo-tap";
import type { JobCardModel } from "@/app/(app)/empleos/queries";
import { EMPLOYMENT_TYPE_LABEL } from "./helpers";
import { COPY } from "./copy";

const C = COPY.list;

/** Acento naranja del módulo (solo decorativo) para la píldora de acción. */
const ACCENT = "var(--accent-empleos)";

/**
 * Card de empleo — misma gramática que EventCard (foto 4:5 + franja de vidrio),
 * con una diferencia de diseño deliberada: acá la mayoría de los avisos NO trae
 * foto, así que el gradiente del acento + el maletín SON la card, no un parche.
 * Por eso el módulo tinta más fuerte que el resto (ACCENT_MEDIA_BG.empleos) y
 * la franja de vidrio arranca con el PAGO en grande: en un aviso de trabajo el
 * monto es lo que frena el scroll, y sin foto es lo único que compite con el
 * ícono. El título sigue siendo el encabezado real (h3) aunque el número pese
 * más — jerarquía visual y semántica no tienen por qué coincidir.
 *
 * DOS destinos, uno por gesto (feedback 2026-07-26): cuando el aviso SÍ trae
 * foto, tocarla abre el visor con todas; al detalle se entra por la píldora "Ver
 * empleo". Sin foto el gradiente no es tocable — no hay nada que mirar.
 */
export function JobCard({ job }: { job: JobCardModel }) {
  const typeLabel = job.employmentType ? EMPLOYMENT_TYPE_LABEL[job.employmentType] : null;
  const photos = job.photos?.length ? job.photos : job.photoUrl ? [job.photoUrl] : [];

  return (
    <BezelCard coreClassName="overflow-hidden p-0">
      <article aria-label={job.title}>
        <PhotoTap photos={photos} label={C.openPhotos(job.title)} authorName={job.title}>
          <DirectoryMedia
            src={job.photoUrl}
            accent="empleos"
            icon={Briefcase}
            aspect="portrait"
            overlayTopLeft={
              typeLabel ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-surface/90 px-3 py-1.5 text-xs font-bold text-foreground backdrop-blur-sm">
                  {typeLabel}
                </span>
              ) : undefined
            }
            overlayBottom={
              <div>
                {/* La escala BAJA en sm y no al revés: el shell de la app está
                    capado en max-w-lg, así que desde sm la grilla pasa a dos
                    columnas y cada card se angosta. Con 2xl fijo, "US$ 1.200/mes"
                    partía en dos renglones. `truncate` es el último seguro: un
                    monto largo se corta, nunca desarma la franja. */}
                <p className="numeric truncate font-display text-2xl font-bold leading-none sm:text-xl">
                  {job.salaryLabel ?? C.salaryToAgree}
                </p>
                <h3 className="mt-1.5 font-display text-base font-bold leading-snug line-clamp-2">
                  {job.title}
                </h3>
                {job.areaLabel && (
                  <p className="mt-1 flex items-center gap-1.5 text-sm opacity-90">
                    <MapPin size={14} aria-hidden="true" className="shrink-0" />
                    <span className="min-w-0 truncate">{job.areaLabel}</span>
                  </p>
                )}
              </div>
            }
          />
        </PhotoTap>

        <div className="flex flex-col gap-2.5 p-4">
          {job.publisherName && (
            <p className="truncate text-sm text-foreground-secondary">{job.publisherName}</p>
          )}

          <AccentLink accent={ACCENT} href={`/empleos/${job.id}`} ariaLabel={job.title}>
            {C.viewJob}
          </AccentLink>
        </div>
      </article>
    </BezelCard>
  );
}
