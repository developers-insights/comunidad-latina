import { Briefcase, MapPin, Megaphone } from "@phosphor-icons/react/dist/ssr";
import { AccentLink, BezelCard, Chip } from "@/components/ui";
import { DirectoryMedia } from "@/components/directory";
import { PhotoTap } from "@/components/media/photo-tap";
import { PublisherTrust, firstNameOf } from "@/components/listings";
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
 *
 * TRUST BADGE del publicador (era la única card de las 5 sin señal de
 * confianza, en un producto anti-estafa): mismo patrón que ListingCard y
 * ProfessionalCard — miembro con cuenta muestra PublisherTrust ya resuelto en
 * batch por `fetchJobsPage`; publicador externo (seed/API sin cuenta) muestra
 * solo el nombre, sin badge que no tiene detrás con qué respaldarse.
 */
export function JobCard({ job }: { job: JobCardModel }) {
  const typeLabel = job.employmentType ? EMPLOYMENT_TYPE_LABEL[job.employmentType] : null;
  const photos = job.photos?.length ? job.photos : job.photoUrl ? [job.photoUrl] : [];

  const card = (
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
          {job.publisher?.type === "member" ? (
            <div className="flex min-w-0 items-center gap-2 text-sm text-foreground-secondary">
              <span className="truncate">{job.publisher.displayName}</span>
              <PublisherTrust
                displayName={job.publisher.displayName}
                firstName={firstNameOf(job.publisher.displayName)}
                score={job.publisher.score}
                level={job.publisher.level}
                signals={job.publisher.signals}
                profileId={job.publisher.profileId}
                size="inline"
              />
            </div>
          ) : job.publisher?.type === "external" ? (
            <p className="truncate text-sm text-foreground-secondary">
              {C.externalPublisher(job.publisher.name)}
            </p>
          ) : null}

          <AccentLink accent={ACCENT} href={`/empleos/${job.id}`} ariaLabel={job.title}>
            {C.viewJob}
          </AccentLink>
        </div>
      </article>
    </BezelCard>
  );

  if (!job.boosted) return card;

  /**
   * Aviso IMPULSADO: anillo dorado + chip "Patrocinado", los mismos tokens
   * (`--color-sponsored`) que ya visten a Vivienda, Negocios, Eventos,
   * Profesionales y el feed. `fetchJobsPage` venía calculando `job.boosted`
   * y ordenando boosted-first desde 0050, pero esta card nunca lo pintaba:
   * Empleos era la única superficie donde pagar por aparecer primero no se
   * notaba, y una promo que no se ve ni se divulga falla dos veces — como
   * producto y como transparencia (FTC: la publicidad se declara SIEMPRE).
   *
   * El anillo lo pone la CARD y no el listado (a diferencia de /eventos, que
   * lo envuelve desde la página porque agrupa los patrocinados en su propia
   * sección con encabezado). Acá los impulsados vienen mezclados y ordenados
   * primero, así que atarlo a `job.boosted` es lo que hace que se pinte igual
   * en cualquier superficie que reuse JobCard — hoy el listado, mañana el
   * perfil o un carrusel — sin que nadie tenga que acordarse del wrapper.
   *
   * `rounded-xl` calza con el radio del BezelCard: el anillo abraza la card
   * sin dejar una esquina cuadrada asomando.
   */
  return (
    <div className="relative rounded-xl ring-2 ring-sponsored/70 shadow-[0_0_0_1px_var(--color-sponsored),0_10px_28px_-14px_var(--color-sponsored)]">
      {/* Arriba a la DERECHA: el tipo de jornada ya ocupa la esquina izquierda
          sobre la foto (overlayTopLeft), y encimarlos haría ilegibles a los dos. */}
      <Chip
        variant="neutral"
        size="sm"
        className="absolute right-3.5 top-3.5 z-10 border-[1.5px] border-sponsored bg-surface text-sponsored-ink shadow-sm"
      >
        <Megaphone size={14} weight="fill" aria-hidden="true" />
        {C.adChip}
      </Chip>
      {card}
    </div>
  );
}
