import Link from "next/link";
import { Briefcase, CaretRight, MapPin, Megaphone } from "@phosphor-icons/react/dist/ssr";
import { BezelCard, Chip } from "@/components/ui";
import { DirectoryMedia } from "@/components/directory";
import { PhotoTap } from "@/components/media/photo-tap";
import { PublisherTrust, firstNameOf } from "@/components/listings";
import type { JobCardModel } from "@/app/(app)/empleos/queries";
import { workModeLabel } from "@/lib/creators/work-mode";
import { cn } from "@/lib/utils";
import { JobApplyInline } from "./job-apply-inline";
import { EMPLOYMENT_TYPE_LABEL } from "./helpers";
import { COPY } from "./copy";

const C = COPY.list;

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
 * TRES GESTOS, TRES RESULTADOS. Cuando el aviso SÍ trae foto, tocarla abre el
 * visor con todas (feedback 2026-07-26); sin foto el gradiente no es tocable, no
 * hay nada que mirar. "Postularme" RESUELVE en la misma pantalla —abre la hoja
 * de postulación sobre el listado, la URL no cambia— y "Ver empleo" es el único
 * que navega, ahora como acción secundaria (cliente 2026-08-20: "mientras menos
 * pasos mejor"). Ver el aviso completo dejó de ser el peaje para postularse.
 *
 * TRUST BADGE del publicador (era la única card de las 5 sin señal de
 * confianza, en un producto anti-estafa): mismo patrón que ListingCard y
 * ProfessionalCard — miembro con cuenta muestra PublisherTrust ya resuelto en
 * batch por `fetchJobsPage`; publicador externo (seed/API sin cuenta) muestra
 * solo el nombre, sin badge que no tiene detrás con qué respaldarse.
 */
/**
 * DOS DATOS QUE LA SPEC PIDE EN LA TARJETA Y `JobCardModel` TODAVÍA NO TRAE.
 *
 * Los dos existen en la base desde hace rato y sólo faltaba subirlos hasta acá:
 *
 *   · `salaryRangeLabel` — el rango completo ("US$ 18 a US$ 22/hora"). El piso
 *     está en `listings.price_amount` y el techo en `attrs.salary_max` (ver el
 *     docblock de `lib/empleos/detalles.ts`, que explica por qué NO se movió el
 *     salario entero a `attrs`). La línea que los junta es
 *     `etiquetaDeSalario()` de `lib/empleos/salario.ts`, ya escrita y pura.
 *   · `workMode` — la COLUMNA `listings.work_mode` (0087), cruda. La etiqueta la
 *     resuelve `workModeLabel`, el vocabulario canónico ("A distancia", no
 *     "Remoto"): un segundo mapa acá sería el mismo hecho con dos nombres.
 *
 * OPCIONALES A PROPÓSITO. Quien arma el modelo es `app/(app)/empleos/queries.ts`
 * —otro dueño en este lote—, así que la tarjeta se prepara para recibirlos sin
 * romper a nadie mientras tanto: sin ellos se comporta exactamente como antes.
 * Las dos líneas que faltan en `toJobCardModel` son:
 *
 *     salaryRangeLabel: etiquetaDeSalario(
 *       row.price_amount, row.price_currency, row.price_period,
 *       readJobDetails(row.attrs).salaryMax,
 *     ),
 *     workMode: row.work_mode,          // + sumar "work_mode" a JOB_LISTING_COLUMNS
 */
export interface JobCardExtras {
  /** Rango ya compuesto. Cuando viene, MANDA sobre `salaryLabel` (que es el piso solo). */
  salaryRangeLabel?: string | null;
  /** `listings.work_mode` crudo: remoto | presencial | hibrido (0087). */
  workMode?: string | null;
}

export function JobCard({ job }: { job: JobCardModel & JobCardExtras }) {
  const typeLabel = job.employmentType ? EMPLOYMENT_TYPE_LABEL[job.employmentType] : null;
  const modeLabel = workModeLabel(job.workMode);
  // El rango manda sobre el monto único: "US$ 18/hora" cuando el aviso declaró
  // hasta 22 estaría diciendo menos de lo que paga.
  const salary = job.salaryRangeLabel ?? job.salaryLabel;
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
                {/* El rango puede ser casi el doble de largo que un monto
                    único ("US$ 18 a US$ 22/hora"), así que a 375px baja un
                    escalón de tamaño en vez de partirse: sigue siendo lo
                    primero que se lee, pero entra en un renglón. */}
                <p
                  className={cn(
                    "numeric truncate font-display font-bold leading-none",
                    job.salaryRangeLabel ? "text-xl sm:text-lg" : "text-2xl sm:text-xl",
                  )}
                >
                  {salary ?? C.salaryToAgree}
                </p>
                <h3 className="mt-1.5 font-display text-base font-bold leading-snug line-clamp-2">
                  {job.title}
                </h3>
                {(job.areaLabel || modeLabel) && (
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm opacity-90">
                    {job.areaLabel && (
                      <span className="flex min-w-0 items-center gap-1.5">
                        <MapPin size={14} aria-hidden="true" className="shrink-0" />
                        <span className="min-w-0 truncate">{job.areaLabel}</span>
                      </span>
                    )}
                    {/* La MODALIDAD al lado de la zona y no en un chip aparte:
                        "Corona, Queens · A distancia" son la misma pregunta
                        (¿dónde tengo que estar?) y separarlas obligaba a
                        buscar la respuesta en dos lugares de la tarjeta.
                        Sin declarar (aviso anterior a la 0087) no se muestra
                        nada — nunca un "Presencial" por defecto. */}
                    {modeLabel && (
                      <span className="flex items-center gap-2">
                        {job.areaLabel && (
                          <span aria-hidden="true" className="opacity-60">
                            ·
                          </span>
                        )}
                        <span className="whitespace-nowrap font-semibold">{modeLabel}</span>
                      </span>
                    )}
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

          {/* DOS ACCIONES, UNA SOLA PRIMARIA (cliente 2026-08-20: "mientras
              menos pasos mejor"). Postularse es lo que la persona vino a hacer y
              se resuelve acá mismo: el botón de marca —el mismo que ve en el
              aviso— abre la hoja sobre el listado. "Ver empleo" no desaparece,
              baja de rango: quien quiera leer horarios, tareas y publicador
              sigue teniendo su camino, ahora como texto tranquilo y no como la
              única salida de la card. La píldora con el acento del módulo se
              retira a propósito: dos píldoras del mismo peso serían dos
              primarias, y una card con dos primarias no tiene ninguna. */}
          <JobApplyInline jobId={job.id} jobTitle={job.title} />

          <Link
            href={`/empleos/${job.id}`}
            aria-label={`${C.viewJob}: ${job.title}`}
            className={cn(
              "flex min-h-11 w-full items-center justify-center gap-1 rounded-full px-4",
              "text-sm font-semibold text-foreground-secondary",
              "transition-[background-color,color,transform] duration-(--duration-fast) ease-(--ease-spring)",
              "hover:bg-surface-subtle hover:text-foreground active:scale-[0.98]",
              "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
            )}
          >
            {C.viewJob}
            <CaretRight size={15} aria-hidden="true" className="shrink-0 opacity-70" />
          </Link>
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
