import Link from "next/link";
import { SignIn } from "@phosphor-icons/react/dist/ssr";
import { Badge, BezelCard, EmptyState, buttonVariants } from "@/components/ui";
import { CreatorTermsAccept } from "@/components/creators/creator-terms-accept";
import { COPY as CREATORS_COPY } from "@/components/creators";
import { CREATOR_TERMS, creatorTermsState } from "@/lib/creators/terms";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";

export const metadata = { title: "Términos de creador" };

/**
 * =============================================================================
 * TÉRMINOS DE CREADOR
 * =============================================================================
 *
 * Son un contrato APARTE de los términos generales de la plataforma —hablan de
 * plata, entregas y sanciones— y por eso 0064 les dio columnas propias en
 * `creator_profiles`. Esta pantalla es donde se leen y se aceptan.
 *
 * VERSIONADO REAL, no decorativo: se guarda QUÉ versión se aceptó, no solo que
 * "aceptó". El día que el texto cambie, a quien firmó la versión anterior se le
 * vuelve a pedir la aceptación —con un aviso de que cambió— y su firma vieja
 * NO se borra ni lo deja inelegible: el gate de la base solo mira que exista
 * una aceptación. Ver el docblock de `lib/creators/terms.ts`.
 *
 * El texto es plano y se renderiza como texto: nada de HTML de terceros, nada
 * de `dangerouslySetInnerHTML` (ARQUITECTURA §9).
 */

const COPY = {
  back: "Volver a mi solicitud",
  intro: "Leelos antes de aceptar. Si algo no se entiende, escribinos: lo explicamos.",
} as const;

export default async function TerminosCreadorPage() {
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
            href={`/entrar?next=${encodeURIComponent("/creadores/terminos")}`}
            className={buttonVariants({ variant: "primary", size: "md" })}
          >
            {CREATORS_COPY.profile.needLoginCta}
          </Link>
        }
        className="py-20"
      />
    );
  }

  const { data: creator } = await supabase
    .from("creator_profiles")
    .select("creator_terms_accepted_at, creator_terms_version")
    .eq("profile_id", user.id)
    .maybeSingle();

  const acceptance = {
    acceptedAt: creator?.creator_terms_accepted_at ?? null,
    version: creator?.creator_terms_version ?? null,
  };
  const state = creatorTermsState(acceptance);
  const acceptedAtLabel = acceptance.acceptedAt
    ? new Intl.DateTimeFormat(tenant.locale, { dateStyle: "long" }).format(
        new Date(acceptance.acceptedAt),
      )
    : null;

  return (
    <>
      <header className="mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
            Términos de creador
          </h1>
          <Badge variant={state === "current" ? "success" : "neutral"}>{CREATOR_TERMS.label}</Badge>
        </div>
        <p className="mt-1 text-sm leading-relaxed text-foreground-secondary">{COPY.intro}</p>
      </header>

      <BezelCard coreClassName="flex flex-col gap-5 p-5">
        <p className="text-sm leading-relaxed text-foreground-secondary">{CREATOR_TERMS.summary}</p>

        <ol className="flex flex-col gap-5">
          {CREATOR_TERMS.sections.map((section, index) => (
            <li key={section.title} className="flex flex-col gap-1.5">
              <h2 className="flex items-baseline gap-2 font-display text-base font-bold text-foreground">
                <span className="numeric text-sm font-semibold text-foreground-muted">
                  {index + 1}.
                </span>
                {section.title}
              </h2>
              {section.body.map((paragraph) => (
                <p key={paragraph} className="text-sm leading-relaxed text-foreground-secondary">
                  {paragraph}
                </p>
              ))}
            </li>
          ))}
        </ol>
      </BezelCard>

      <div className="mt-5">
        <CreatorTermsAccept
          version={CREATOR_TERMS.version}
          state={state}
          acceptedAtLabel={acceptedAtLabel}
        />
      </div>
    </>
  );
}
