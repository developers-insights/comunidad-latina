import Link from "next/link";
import { CheckCircle, Clock, SignIn, UserCirclePlus } from "@phosphor-icons/react/dist/ssr";
import { BezelCard, EmptyState, buttonVariants } from "@/components/ui";
import { CreatorEligibilityChecklist } from "@/components/creators/eligibility-checklist";
import { CreatorRequestForm } from "@/components/creators/creator-request-form";
import { COPY as CREATORS_COPY } from "@/components/creators";
import { configFromRow, evaluateEligibility } from "@/lib/creators/eligibility";
import { creatorTermsState } from "@/lib/creators/terms";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { fetchEligibilityConfigRow, fetchOwnCreatorFacts } from "./queries";

export const metadata = { title: "Quiero ser creador" };

/**
 * =============================================================================
 * SOLICITUD PARA SER CREADOR — el lado de quien quiere trabajar
 * =============================================================================
 *
 * La pregunta que esta pantalla tiene que contestar no es "¿sos elegible?" sino
 * "¿qué me falta y cómo lo consigo?". Un "no calificás" mudo es la peor
 * respuesta posible para alguien que recién empieza.
 *
 * Los requisitos NO están escritos acá: se leen de `creator_eligibility_config`
 * del tenant (0064), que administra el panel. Si el admin baja el mínimo de
 * seguidores esta noche, mañana la lista dice otra cosa sin tocar una línea de
 * código — que es exactamente lo que pide el pliego.
 *
 * Y solo se listan los requisitos VIGENTES. Los que la comunidad tiene apagados
 * no aparecen: mostrarlos haría creer que se pide algo que no se pide.
 */

const COPY = {
  title: "Quiero recibir trabajos pagos",
  subtitle:
    "Ser creador te deja postularte a los trabajos que publican los negocios de la comunidad y cobrar por ellos.",
  needProfileTitle: "Primero, tu perfil de creador",
  needProfileBody:
    "Es lo que ve el negocio cuando te elige: tu portfolio, tus reseñas y tu score. Se arma en un minuto y después volvés acá.",
  needProfileCta: "Crear mi perfil de creador",
  pendingTitle: "Tu solicitud está en revisión",
  pendingBody:
    "El equipo de tu comunidad la está mirando. Te avisamos apenas haya novedades — no hace falta que la mandes de nuevo.",
  approvedTitle: "Ya sos creador",
  approvedBody: "Podés postularte a los trabajos publicados y cobrar por ellos.",
  approvedCta: "Ver los trabajos",
  needsInfoTitle: "Nos falta un dato tuyo",
  needsInfoBody:
    "El equipo de tu comunidad necesita algo más para seguir. Revisá tus mensajes: te escribimos por ahí.",
  rejectedTitle: "Esta vez no salió",
  rejectedBody:
    "Tu solicitud no fue aprobada. Podés volver a intentarlo cuando completes los requisitos de abajo.",
  suspendedTitle: "Tu cuenta de creador está suspendida",
  suspendedBody: "Escribinos si creés que hubo un error: se revisa caso por caso.",
  termsPending: "Antes de mandar la solicitud, leé y aceptá los términos de creador.",
  termsCta: "Leer los términos",
} as const;

/** Estados en los que NO tiene sentido volver a mandar la solicitud. */
const STATUS_NOTICE: Record<string, { title: string; body: string }> = {
  documents_pending: { title: COPY.pendingTitle, body: COPY.pendingBody },
  stripe_review_pending: { title: COPY.pendingTitle, body: COPY.pendingBody },
  platform_review_pending: { title: COPY.pendingTitle, body: COPY.pendingBody },
  approved: { title: COPY.approvedTitle, body: COPY.approvedBody },
  needs_info: { title: COPY.needsInfoTitle, body: COPY.needsInfoBody },
  suspended: { title: COPY.suspendedTitle, body: COPY.suspendedBody },
};

export default async function SolicitudCreadorPage() {
  const [tenant, supabase] = await Promise.all([getTenant(), createClient()]);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <EmptyState
        icon={<SignIn />}
        title={CREATORS_COPY.profile.needLoginTitle}
        message={CREATORS_COPY.profile.needLoginBody}
        action={
          <Link
            href={`/entrar?next=${encodeURIComponent("/creadores/solicitud")}`}
            className={buttonVariants({ variant: "primary", size: "md" })}
          >
            {CREATORS_COPY.profile.needLoginCta}
          </Link>
        }
        className="py-20"
      />
    );
  }

  const [configRow, facts] = await Promise.all([
    fetchEligibilityConfigRow(supabase, tenant.id),
    fetchOwnCreatorFacts(supabase, tenant.id, user.id),
  ]);

  const config = configFromRow(configRow);
  const result = evaluateEligibility(config, facts.subject);
  const notice = facts.creatorStatus ? STATUS_NOTICE[facts.creatorStatus] : undefined;

  const termsState = creatorTermsState({
    acceptedAt: facts.creatorTermsAcceptedAt,
    version: facts.creatorTermsVersion,
  });
  // Los términos se ofrecen cuando la comunidad los exige. Si están apagados,
  // el enlace no aparece: no vamos a pedir una firma que nadie está pidiendo.
  const showTermsCta = config.requireCreatorTerms && termsState !== "current";

  return (
    <>
      <header className="mb-5">
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
          {COPY.title}
        </h1>
        <p className="mt-1 text-sm leading-relaxed text-foreground-secondary">{COPY.subtitle}</p>
      </header>

      {facts.creatorStatus === null ? (
        <EmptyState
          icon={<UserCirclePlus />}
          title={COPY.needProfileTitle}
          message={COPY.needProfileBody}
          action={
            <Link
              href="/creadores/perfil"
              className={buttonVariants({ variant: "primary", size: "md" })}
            >
              {COPY.needProfileCta}
            </Link>
          }
          className="py-12"
        />
      ) : (
        <div className="flex flex-col gap-5">
          {notice && (
            <BezelCard
              variant={facts.creatorStatus === "approved" ? "success" : "default"}
              coreClassName="flex items-start gap-3 p-4"
            >
              {facts.creatorStatus === "approved" ? (
                <CheckCircle
                  size={22}
                  weight="fill"
                  aria-hidden="true"
                  className="mt-0.5 shrink-0 text-success"
                />
              ) : (
                <Clock size={22} aria-hidden="true" className="mt-0.5 shrink-0 text-foreground-muted" />
              )}
              <div className="min-w-0">
                <p className="font-semibold text-foreground">{notice.title}</p>
                <p className="mt-0.5 text-sm leading-relaxed text-foreground-secondary">
                  {notice.body}
                </p>
                {facts.creatorStatus === "approved" && (
                  <Link
                    href="/creadores"
                    className={`${buttonVariants({ variant: "outline", size: "sm" })} mt-2`}
                  >
                    {COPY.approvedCta}
                  </Link>
                )}
              </div>
            </BezelCard>
          )}

          {facts.creatorStatus === "rejected" && (
            <BezelCard coreClassName="p-4">
              <p className="font-semibold text-foreground">{COPY.rejectedTitle}</p>
              <p className="mt-0.5 text-sm leading-relaxed text-foreground-secondary">
                {COPY.rejectedBody}
              </p>
            </BezelCard>
          )}

          <CreatorEligibilityChecklist result={result} />

          {showTermsCta && (
            <div className="rounded-lg border border-border bg-surface p-4 shadow-xs">
              <p className="text-sm leading-relaxed text-foreground-secondary">
                {COPY.termsPending}
              </p>
              <Link
                href="/creadores/terminos"
                className={`${buttonVariants({ variant: "secondary", size: "sm" })} mt-2`}
              >
                {COPY.termsCta}
              </Link>
            </div>
          )}

          {!notice && <CreatorRequestForm eligible={result.eligible} />}
        </div>
      )}
    </>
  );
}
