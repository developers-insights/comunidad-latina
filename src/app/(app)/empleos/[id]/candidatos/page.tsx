import { notFound } from "next/navigation";
import Link from "next/link";
import { Megaphone, UsersThree } from "@phosphor-icons/react/dist/ssr";
import { Banner, EmptyState, SectionHeading, buttonVariants } from "@/components/ui";
import { buildTrustSignals } from "@/components/listings";
import { COPY } from "@/components/empleos/copy";
import { CandidateCard } from "@/components/empleos/candidate-card";
import { parseJobAttrs } from "@/components/empleos/helpers";
import { isTerminalStatus } from "@/lib/empleos/application-status";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { cn } from "@/lib/utils";
import { fetchJobCandidates } from "../../queries";

export const metadata = { title: "Candidatos" };

const C = COPY.candidates;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Params = Promise<{ id: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

type Filter = "todos" | "sin-responder" | "entrevista" | "resueltos";

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: "todos", label: C.filterAll },
  { value: "sin-responder", label: C.filterOpen },
  { value: "entrevista", label: C.filterInterview },
  { value: "resueltos", label: C.filterResolved },
];

function parseFilter(value: string | string[] | undefined): Filter {
  const raw = (Array.isArray(value) ? value[0] : value) ?? "";
  return raw === "sin-responder" || raw === "entrevista" || raw === "resueltos" ? raw : "todos";
}

/**
 * /empleos/[id]/candidatos — la bandeja de quien PUBLICÓ el aviso.
 *
 * ── QUÉ ES Y QUÉ NO ES ─────────────────────────────────────────────────────
 * Esta es la vista del DUEÑO del aviso, no la del staff. `/admin/empleos` es
 * otra cosa: ahí un administrador del dominio mira avisos de la PLATAFORMA con
 * una barrera de divulgación propia (src/app/admin/empleos/policy.ts, migración
 * 0042), que sobre avisos de miembros solo muestra metadatos. Las dos pantallas
 * no comparten reglas ni datos, y no deben empezar a hacerlo.
 *
 * Acá el gate es simple y duro: `listings.created_by = auth.uid()`. Un aviso
 * ajeno devuelve la pantalla de "esto no es tuyo" — y aunque alguien saltara
 * este chequeo, `job_applications_select` (0042) no le devolvería una sola
 * fila.
 */
export default async function CandidatosPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const filter = parseFilter((await searchParams).estado);

  const [tenant, supabase] = await Promise.all([getTenant(), createClient()]);

  const { data: listing } = await supabase
    .from("listings")
    .select("id, tenant_id, title, status, attrs, created_by")
    .eq("id", id)
    .eq("kind", "job")
    .maybeSingle();

  if (!listing || listing.tenant_id !== tenant.id) notFound();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // El dueño, y solo el dueño. Sin rama por rol: quien publicó el aviso es el
  // destinatario de las postulaciones, y esa es toda la regla.
  if (!user || listing.created_by !== user.id) {
    return (
      <>
        <EmptyState
          icon={<UsersThree />}
          title={C.notOwnerTitle}
          message={C.notOwnerBody}
          action={
            <Link
              href={`/empleos/${id}`}
              className={buttonVariants({ variant: "primary", size: "md" })}
            >
              {C.backToJob}
            </Link>
          }
        />
      </>
    );
  }

  const { questions } = parseJobAttrs(listing.attrs);
  const { candidates, openCount } = await fetchJobCandidates({
    jobId: listing.id,
    tenantId: tenant.id,
    viewerId: user.id,
    questions,
  });

  const filtered = candidates.filter((candidate) => {
    if (filter === "sin-responder") {
      return candidate.status === "submitted" || candidate.status === "reviewing";
    }
    if (filter === "entrevista") return candidate.status === "interview";
    if (filter === "resueltos") return isTerminalStatus(candidate.status);
    return true;
  });

  // El desglose del Trust Score se arma en UN batch para todas las filas, así
  // el badge de cada persona explica su número en vez de mostrarlo mudo (§3.3).
  const signalsById = new Map(
    candidates
      .filter((candidate) => candidate.profile?.trust)
      .map((candidate) => [
        candidate.id,
        buildTrustSignals(
          (candidate.profile?.trust?.signals ?? {}) as Parameters<typeof buildTrustSignals>[0],
          candidate.profile?.identityVerified ?? false,
        ),
      ]),
  );

  return (
    <>
      <SectionHeading
        accent="var(--accent-empleos)"
        image="/icons/menu/empleos.webp"
        title={C.title}
        subtitle={C.subtitle(listing.title)}
      />

      {listing.status !== "published" && (
        <Banner variant="info" className="mb-3 mt-3 rounded-lg">
          {C.pendingMessage}
        </Banner>
      )}

      {candidates.length === 0 ? (
        <EmptyState
          illustration="/images/empty-state-search.png"
          title={listing.status === "published" ? C.emptyTitle : C.pendingTitle}
          message={listing.status === "published" ? C.emptyMessage : C.pendingMessage}
          action={
            listing.status === "published" ? (
              <Link
                href={`/impulsar/${listing.id}`}
                className={buttonVariants({ variant: "primary", size: "md" })}
              >
                <Megaphone size={18} weight="fill" aria-hidden="true" />
                {C.emptyCta}
              </Link>
            ) : (
              <Link
                href={`/empleos/${id}`}
                className={buttonVariants({ variant: "outline", size: "md" })}
              >
                {C.emptySecondary}
              </Link>
            )
          }
        />
      ) : (
        <>
          <p className="mb-3 mt-3 text-sm text-foreground-secondary">
            {C.countAll(candidates.length)}
            {openCount > 0 && (
              <>
                {" · "}
                <span className="font-semibold text-foreground">{C.countOpen(openCount)}</span>
              </>
            )}
          </p>

          <nav aria-label={C.filterAll} className="mb-4 flex flex-wrap gap-2">
            {FILTERS.map((option) => {
              const active = option.value === filter;
              return (
                <Link
                  key={option.value}
                  href={
                    option.value === "todos"
                      ? `/empleos/${id}/candidatos`
                      : `/empleos/${id}/candidatos?estado=${option.value}`
                  }
                  aria-current={active ? "page" : undefined}
                  scroll={false}
                  style={
                    active
                      ? {
                          borderColor:
                            "color-mix(in oklab, var(--accent-empleos) 55%, transparent)",
                          backgroundColor:
                            "color-mix(in oklab, var(--accent-empleos) 14%, transparent)",
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

          {filtered.length === 0 ? (
            <EmptyState
              icon={<UsersThree />}
              title={C.emptyFilterTitle}
              message={C.emptyFilterMessage}
              action={
                <Link
                  href={`/empleos/${id}/candidatos`}
                  className={buttonVariants({ variant: "outline", size: "md" })}
                >
                  {C.filterAll}
                </Link>
              }
            />
          ) : (
            <ul className="flex flex-col gap-3">
              {filtered.map((candidate) => (
                <CandidateCard
                  key={candidate.id}
                  candidate={candidate}
                  trustSignals={signalsById.get(candidate.id) ?? []}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </>
  );
}
