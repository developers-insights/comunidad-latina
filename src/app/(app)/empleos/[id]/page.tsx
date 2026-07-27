import { notFound } from "next/navigation";
import { Briefcase, Clock, MapPin, Question, Storefront } from "@phosphor-icons/react/dist/ssr";
import { Avatar, Badge, Banner, BezelCard } from "@/components/ui";
import {
  DetailTopBar,
  PublisherTrust,
  buildTrustSignals,
  firstNameOf,
  formatListingPrice,
  listingPhotoUrl,
  toTrustLevel,
} from "@/components/listings";
// Lectura de `saves` (migración 0038): genérica por listingId, sirve igual para
// un empleo aunque el helper viva en el paquete de marketplace.
import { fetchListingSaved } from "@/components/marketplace/engagement-queries";
import { DirectoryDetailHero } from "@/components/directory";
import { ScamShieldNotice } from "@/components/trust";
import { COPY } from "@/components/empleos/copy";
import { EMPLOYMENT_TYPE_LABEL, parseJobAttrs, type JobQuestion } from "@/components/empleos/helpers";
import { JobApplicationRow } from "@/components/empleos/job-application-row";
import { JobApplicationStatus } from "@/components/empleos/job-application-status";
import { JobApplySheet } from "@/components/empleos/job-apply-sheet";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { fetchJobApplications, fetchViewerApplication } from "../queries";

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
  const salaryLabel = formatListingPrice(
    listing.price_amount,
    listing.price_currency,
    listing.price_period,
    tenant.locale,
  );
  const employmentLabel = attrs.employmentType
    ? EMPLOYMENT_TYPE_LABEL[attrs.employmentType]
    : C.employmentUnknown;

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

      {listing.status !== "published" && isOwner && (
        <Banner variant="info" className="mb-3 rounded-lg">
          {C.pendingBanner}
        </Banner>
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

      <div className="mt-6">
        {isOwner ? (
          <OwnerApplications
            jobId={listing.id}
            questions={attrs.questions}
            isPending={listing.status !== "published"}
          />
        ) : (
          <ApplicantAction
            jobId={listing.id}
            userId={user?.id ?? null}
            questions={attrs.questions}
          />
        )}
      </div>
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
    return <JobApplySheet jobId={jobId} questions={questions} isLoggedIn={false} />;
  }

  const application = await fetchViewerApplication(jobId, userId);
  if (!application) {
    return <JobApplySheet jobId={jobId} questions={questions} isLoggedIn />;
  }

  return <JobApplicationStatus application={application} />;
}

// ---------------------------------------------------------------------------
// Vista de quien publicó: las postulaciones recibidas
// ---------------------------------------------------------------------------

async function OwnerApplications({
  jobId,
  questions,
  isPending,
}: {
  jobId: string;
  questions: JobQuestion[];
  isPending: boolean;
}) {
  const applications = await fetchJobApplications(jobId, questions);
  const A = C.applications;

  // El desglose del Trust Score (buildTrustSignals) no viaja en el modelo de
  // lectura: se arma acá en UN batch para todas las filas, así el badge de cada
  // postulante explica su número en vez de mostrarlo mudo (§3.3).
  const applicantIds = [...new Set(applications.map((row) => row.applicantId))];
  const supabase = await createClient();
  const [{ data: profiles }, { data: trusts }] = await Promise.all([
    applicantIds.length > 0
      ? supabase.from("profiles").select("id, identity_verified").in("id", applicantIds)
      : Promise.resolve({ data: [] as { id: string; identity_verified: boolean }[] }),
    applicantIds.length > 0
      ? supabase.from("trust_scores").select("profile_id, signals").in("profile_id", applicantIds)
      : Promise.resolve({ data: [] as { profile_id: string; signals: unknown }[] }),
  ]);
  const verifiedById = new Map((profiles ?? []).map((row) => [row.id, row.identity_verified]));
  const signalsById = new Map((trusts ?? []).map((row) => [row.profile_id, row.signals]));

  return (
    <section className="flex flex-col gap-3">
      {isPending && (
        <BezelCard coreClassName="p-4">
          <p className="text-sm leading-relaxed text-foreground-secondary">{A.pendingNote}</p>
        </BezelCard>
      )}

      <h2 className="font-display text-lg font-bold text-foreground">
        {A.title(applications.length)}
      </h2>

      {applications.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border bg-surface-subtle px-4 py-6 text-center text-sm text-foreground-muted">
          <span className="block font-semibold text-foreground-secondary">{A.emptyTitle}</span>
          <span className="mt-1 block">{A.emptyMessage}</span>
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {applications.map((application) => (
            <JobApplicationRow
              key={application.id}
              application={application}
              trustSignals={buildTrustSignals(
                (signalsById.get(application.applicantId) ?? {}) as Parameters<
                  typeof buildTrustSignals
                >[0],
                verifiedById.get(application.applicantId) ?? false,
              )}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
