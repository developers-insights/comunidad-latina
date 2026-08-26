import { notFound } from "next/navigation";
import Link from "next/link";
import {
  Briefcase,
  CalendarCheck,
  CalendarDots,
  CaretRight,
  Clock,
  GraduationCap,
  Hourglass,
  MapPin,
  Question,
  Storefront,
  Translate,
  UsersThree,
} from "@phosphor-icons/react/dist/ssr";
import { Avatar, Badge, Banner, BezelCard, buttonVariants } from "@/components/ui";
import {
  DetailFacts,
  DetailTopBar,
  PublisherTrust,
  buildTrustSignals,
  firstNameOf,
  formatListingPrice,
  listingPhotoUrl,
  toTrustLevel,
  type DetailFact,
} from "@/components/listings";
// Lectura de `saves` (migración 0038): genérica por listingId, sirve igual para
// un empleo aunque el helper viva en el paquete de marketplace.
import { fetchListingSaved } from "@/components/marketplace/engagement-queries";
import { DirectoryDetailHero } from "@/components/directory";
import { ScamShieldNotice } from "@/components/trust";
import { COPY } from "@/components/empleos/copy";
import { EMPLOYMENT_TYPE_LABEL, parseJobAttrs, type JobQuestion } from "@/components/empleos/helpers";
import { JobApplicationStatus } from "@/components/empleos/job-application-status";
import { JobApplySheet } from "@/components/empleos/job-apply-sheet";
import {
  JOB_DETAILS_COPY,
  jobExperienceLabel,
  jobLanguageLabel,
  readJobDetails,
  workDayLabel,
} from "@/lib/empleos/detalles";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { VENCIMIENTO_COPY, isClosedReason } from "@/lib/listings";
import { cn, formatDate } from "@/lib/utils";
import {
  fetchApplicantProfilePreview,
  fetchJobApplicationCounts,
  fetchViewerApplication,
} from "../queries";

const C = COPY.detail;

type Params = Promise<{ id: string }>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params }: { params: Params }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return { title: C.metadataFallback };
  // Mismo scope que la página: sin esto, /empleos/<uuid-de-una-propiedad>
  // devolvería 404 con el título de la propiedad en el <title>.
  const [tenant, supabase] = await Promise.all([getTenant(), createClient()]);
  const { data } = await supabase
    .from("listings")
    .select("title")
    .eq("id", id)
    .eq("tenant_id", tenant.id)
    .eq("kind", "job")
    .maybeSingle();
  return { title: data?.title ?? C.metadataFallback };
}

export default async function EmpleoDetallePage({ params }: { params: Params }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const [tenant, supabase] = await Promise.all([getTenant(), createClient()]);

  const { data: listing } = await supabase
    .from("listings")
    .select(
      "id, tenant_id, kind, title, description, attrs, area_label, photos, status, created_by, publisher_name, price_amount, price_currency, price_period",
    )
    .eq("id", id)
    .eq("kind", "job")
    .maybeSingle();

  // RLS ya limita qué filas existen para este usuario (published | propias | staff).
  if (!listing || listing.tenant_id !== tenant.id) notFound();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const attrs = parseJobAttrs(listing.attrs);
  const isOwner = Boolean(user && listing.created_by === user.id);

  // Cierre (0117): mismo criterio que propiedades/[id] — `listings_select`
  // deja pasar `closed` por su rama pública, así que esta página también
  // puede recibir un puesto que ya no está disponible. `closed_reason` se lee
  // del jsonb crudo (no hay columna propia, doctrina 0107) y nunca de algo
  // que mandó el cliente. `closedReasonForKind` default para "job" es
  // "filled", de ahí `bannerFilled`.
  const isClosed = listing.status === "closed";
  const closedAttrsRaw =
    listing.attrs && typeof listing.attrs === "object" && !Array.isArray(listing.attrs)
      ? (listing.attrs as Record<string, unknown>)
      : {};
  const closedReason = isClosed && isClosedReason(closedAttrsRaw.closed_reason)
    ? closedAttrsRaw.closed_reason
    : null;
  const CIERRE = VENCIMIENTO_COPY.cerrado;
  const salaryLabel = formatListingPrice(
    listing.price_amount,
    listing.price_currency,
    listing.price_period,
    tenant.locale,
  );
  const employmentLabel = attrs.employmentType
    ? EMPLOYMENT_TYPE_LABEL[attrs.employmentType]
    : C.employmentUnknown;

  /**
   * La ficha del puesto: días, horario, experiencia, idiomas, desde cuándo y
   * hasta cuándo se puede postular.
   *
   * `readJobDetails` ya existía y esta pantalla usaba UNA sola cosa de él
   * —`salaryMax`, y encima desde `queries.ts` para la tarjeta del listado—:
   * todo lo demás se guardaba al publicar y no se veía en ningún lado. Es el
   * mismo agujero que Propiedades y Eventos, y se cierra igual: una fila por
   * dato DECLARADO, ninguna por dato ausente.
   *
   * `applyBy` es el único con carga emocional: es una fecha límite, así que va
   * último y con su rótulo en imperativo. No se pinta en rojo ni se compara
   * contra hoy — un aviso vencido lo cierra la consulta, no un color de alarma
   * sobre algo que la persona no puede cambiar.
   */
  const details = readJobDetails(listing.attrs);
  const jobFacts: DetailFact[] = [];
  if (details.days.length > 0) {
    jobFacts.push({
      id: "days",
      icon: CalendarDots,
      label: JOB_DETAILS_COPY.days,
      value: details.days
        .map((day) => workDayLabel(day))
        .filter(Boolean)
        .join(" · "),
    });
  }
  if (details.schedule) {
    jobFacts.push({
      id: "schedule",
      icon: Clock,
      label: JOB_DETAILS_COPY.schedule,
      value: details.schedule,
    });
  }
  if (details.experience) {
    const experience = jobExperienceLabel(details.experience);
    if (experience) {
      jobFacts.push({
        id: "experience",
        icon: GraduationCap,
        label: JOB_DETAILS_COPY.experience,
        value: experience,
      });
    }
  }
  if (details.languages.length > 0) {
    jobFacts.push({
      id: "languages",
      icon: Translate,
      label: JOB_DETAILS_COPY.languages,
      value: details.languages
        .map((language) => jobLanguageLabel(language))
        .filter(Boolean)
        .join(" · "),
    });
  }
  if (details.startsOn) {
    jobFacts.push({
      id: "starts-on",
      icon: CalendarCheck,
      label: JOB_DETAILS_COPY.startsOn,
      // `YYYY-MM-DD` sin hora: `formatDate` lo detecta y lo formatea en UTC
      // para que no se corra un día al oeste de Greenwich.
      value: formatDate(details.startsOn, { locale: tenant.locale, style: "long" }),
    });
  }
  if (details.applyBy) {
    jobFacts.push({
      id: "apply-by",
      icon: Hourglass,
      label: JOB_DETAILS_COPY.applyBy,
      value: formatDate(details.applyBy, { locale: tenant.locale, style: "long" }),
    });
  }

  // ¿Ya lo guardé? (`saves`, 0038 — false si la migración todavía no corrió.)
  const initialSaved = await fetchListingSaved(supabase, tenant.id, listing.id, user?.id);

  // -------------------------------------------------------------------------
  // Quién ofrece el trabajo: perfil con Trust Score, o fuente externa atribuida
  // -------------------------------------------------------------------------
  let publisherCard: React.ReactNode = null;
  if (listing.created_by) {
    const [{ data: profile }, { data: trust }] = await Promise.all([
      supabase
        .from("profiles")
        .select("id, display_name, avatar_url, identity_verified")
        .eq("id", listing.created_by)
        .maybeSingle(),
      supabase
        .from("trust_scores")
        .select("score, level, signals")
        .eq("profile_id", listing.created_by)
        .maybeSingle(),
    ]);

    const displayName = profile?.display_name ?? C.fallbackPublisher;
    publisherCard = (
      <BezelCard coreClassName="flex items-center gap-3 p-4">
        <Avatar src={profile?.avatar_url} name={displayName} size="lg" />
        <div className="min-w-0">
          <p className="truncate font-display text-base font-bold text-foreground">
            {displayName}
          </p>
          <PublisherTrust
            displayName={displayName}
            firstName={firstNameOf(displayName)}
            score={trust?.score ?? 0}
            level={toTrustLevel(trust?.level)}
            signals={buildTrustSignals(trust?.signals ?? {}, profile?.identity_verified ?? false)}
            size="inline"
            profileId={profile?.id ?? null}
          />
        </div>
      </BezelCard>
    );
  } else if (listing.publisher_name) {
    publisherCard = (
      <BezelCard coreClassName="flex items-center gap-3 p-4">
        <span
          aria-hidden="true"
          className="flex size-12 shrink-0 items-center justify-center rounded-full bg-surface-subtle text-foreground-muted"
        >
          <Storefront size={24} />
        </span>
        <div className="min-w-0">
          <p className="truncate font-display text-base font-bold text-foreground">
            {listing.publisher_name}
          </p>
          <p className="text-xs text-foreground-muted">{C.externalSourceNote}</p>
        </div>
      </BezelCard>
    );
  }

  return (
    <div className="pb-28">
      <DetailTopBar title={listing.title} listingId={listing.id} initialSaved={initialSaved} />

      {isClosed ? (
        // Visible para CUALQUIERA (dueño o no) — mismo criterio que
        // propiedades/[id]: un link guardado tiene que decir "ya no está
        // disponible" en vez de ofrecer postularse a un puesto que ya se
        // cubrió.
        <Banner variant="warning" className="mb-3 rounded-lg">
          <p className="font-semibold">{CIERRE.bannerTitulo}</p>
          {closedReason === "filled" && <p className="mt-0.5">{CIERRE.bannerFilled}</p>}
        </Banner>
      ) : (
        listing.status !== "published" &&
        isOwner && (
          <Banner variant="info" className="mb-3 rounded-lg">
            {C.pendingBanner}
          </Banner>
        )
      )}

      <DirectoryDetailHero
        photos={(listing.photos ?? []).map(listingPhotoUrl)}
        title={listing.title}
        accent="empleos"
        icon={Briefcase}
        className="mb-4"
      />

      {/* Cabecera editorial: acá manda el PAGO. Es lo que decide si alguien
          sigue leyendo un aviso de trabajo. */}
      <BezelCard variant="featured" coreClassName="p-4">
        <h1 className="font-display text-xl font-bold leading-snug text-foreground">
          {listing.title}
        </h1>
        <p className="mt-3 text-xs font-medium text-foreground-secondary">{C.salaryTitle}</p>
        <p className="numeric font-display text-3xl font-bold leading-none text-brand">
          {salaryLabel ?? C.salaryToAgree}
        </p>
        {!salaryLabel && (
          <p className="mt-1 text-xs text-foreground-muted">{C.salaryToAgreeHint}</p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Badge variant="neutral">
            <Clock size={14} aria-hidden="true" />
            {employmentLabel}
          </Badge>
          {listing.area_label && (
            <Badge variant="neutral">
              <MapPin size={14} aria-hidden="true" />
              {listing.area_label}
            </Badge>
          )}
        </div>
      </BezelCard>

      {listing.description && (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold text-foreground-secondary">
            {C.descriptionTitle}
          </h2>
          <p className="whitespace-pre-line text-base leading-relaxed text-foreground">
            {listing.description}
          </p>
        </section>
      )}

      {/* La ficha del puesto va entre la descripción y las preguntas: primero
          de qué se trata el trabajo, después las condiciones concretas, y
          recién ahí lo que te van a preguntar para entrar. */}
      <DetailFacts
        title={JOB_DETAILS_COPY.title}
        facts={jobFacts}
        footnote={JOB_DETAILS_COPY.footnote}
      />

      {/* Transparencia: las preguntas del aviso se ven ANTES de postularse.
          Nadie abre la hoja para descubrir que le piden cosas que no puede dar. */}
      {attrs.questions.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold text-foreground-secondary">
            {C.questionsTitle}
          </h2>
          <BezelCard coreClassName="p-4">
            <ul className="flex flex-col gap-3">
              {attrs.questions.map((question) => (
                <li key={question.id} className="flex items-start gap-2.5">
                  <Question
                    size={18}
                    aria-hidden="true"
                    className="mt-0.5 shrink-0 text-[var(--accent-empleos)]"
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground">{question.label}</p>
                    <p className="mt-0.5 text-xs text-foreground-muted">
                      {question.type === "yes_no"
                        ? C.questionYesNoHint
                        : (question.options ?? []).join(" · ")}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-foreground-muted">{C.questionsHint}</p>
          </BezelCard>
        </section>
      )}

      {publisherCard && (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold text-foreground-secondary">{C.publishedBy}</h2>
          {publisherCard}
        </section>
      )}

      {/* Escudo Anti-Estafa con el copy propio de empleos ("ningún trabajo
          serio te pide dinero por adelantado") — posición fija en todo vertical. */}
      <ScamShieldNotice variant="job" className="mt-6" />

      {/* Postularse queda deshabilitado si `closed` (0117) — el banner de
          arriba ya explica por qué. Al dueño SÍ se le sigue mostrando su
          bandeja: cerrar el aviso no le borra las candidaturas que ya
          recibió, sólo corta la entrada de gente nueva. */}
      {(isOwner || !isClosed) && (
        <div className="mt-6">
          {isOwner ? (
            <OwnerApplications
              jobId={listing.id}
              tenantId={tenant.id}
              // Cerrado ≠ pendiente: un empleo que el dueño marcó "Cubierto"
              // no está "en revisión" — el banner de cierre ya lo explica.
              isPending={!isClosed && listing.status !== "published"}
            />
          ) : (
            <ApplicantAction
              jobId={listing.id}
              userId={user?.id ?? null}
              questions={attrs.questions}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Quien mira el aviso: entrar / postularse / estado de su postulación
// ---------------------------------------------------------------------------

async function ApplicantAction({
  jobId,
  userId,
  questions,
}: {
  jobId: string;
  userId: string | null;
  questions: JobQuestion[];
}) {
  if (!userId) {
    return (
      <JobApplySheet jobId={jobId} questions={questions} isLoggedIn={false} profile={null} />
    );
  }

  const application = await fetchViewerApplication(jobId, userId);
  if (application) {
    return <JobApplicationStatus application={application} />;
  }

  // El autocompletado se lee UNA vez, acá, y viaja como props a la hoja: así el
  // bloque "esto va a ver quien contrata" ya está armado cuando se abre, sin un
  // spinner adentro del formulario.
  const profile = await fetchApplicantProfilePreview(userId);
  return <JobApplySheet jobId={jobId} questions={questions} isLoggedIn profile={profile} />;
}

// ---------------------------------------------------------------------------
// Vista de quien publicó: el acceso a su bandeja de candidatos
//
// El detalle NO lista las candidaturas: cada una trae respuestas, mensaje,
// currículum, enlaces y una nota privada, y apilarlas debajo del aviso hace una
// página infinita donde lo importante —responderle a alguien— queda enterrado.
// Acá va el titular ("cuántos hay, cuántos esperan") y el camino a la pantalla
// que sí está hecha para trabajar: /empleos/[id]/candidatos.
// ---------------------------------------------------------------------------

async function OwnerApplications({
  jobId,
  tenantId,
  isPending,
}: {
  jobId: string;
  tenantId: string;
  isPending: boolean;
}) {
  const { total, open } = await fetchJobApplicationCounts({ jobId, tenantId });
  const A = C.applications;

  return (
    <section className="flex flex-col gap-3">
      {isPending && (
        <BezelCard coreClassName="p-4">
          <p className="text-sm leading-relaxed text-foreground-secondary">{A.pendingNote}</p>
        </BezelCard>
      )}

      <h2 className="font-display text-lg font-bold text-foreground">{A.title}</h2>

      {total === 0 ? (
        <p className="rounded-lg border border-dashed border-border bg-surface-subtle px-4 py-6 text-center text-sm text-foreground-muted">
          <span className="block font-semibold text-foreground-secondary">{A.emptyTitle}</span>
          <span className="mt-1 block">{A.emptyMessage}</span>
        </p>
      ) : (
        <Link
          href={`/empleos/${jobId}/candidatos`}
          className={cn(
            "group flex items-center gap-3 rounded-lg border border-border-subtle bg-surface p-4",
            "transition-colors duration-(--duration-fast) hover:bg-surface-subtle",
            "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
          )}
        >
          <span
            aria-hidden="true"
            className="flex size-11 shrink-0 items-center justify-center rounded-full bg-surface-subtle text-[var(--accent-empleos)] group-hover:bg-surface"
          >
            <UsersThree size={22} weight="fill" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold text-foreground">{A.count(total)}</span>
            <span className="block text-sm text-foreground-secondary">
              {open > 0 ? A.openCount(open) : A.allAnswered}
            </span>
          </span>
          <span className={cn(buttonVariants({ variant: "outline", size: "sm" }), "shrink-0")}>
            {A.open}
            <CaretRight size={14} weight="bold" aria-hidden="true" />
          </span>
        </Link>
      )}
    </section>
  );
}
