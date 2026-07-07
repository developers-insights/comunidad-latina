import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowLeft,
  IdentificationCard,
  LockKey,
  SealCheck,
  TrendUp,
} from "@phosphor-icons/react/dist/ssr";
import { BezelCard, ProximamentePremium, buttonVariants } from "@/components/ui";
import { isStripeConfigured } from "@/lib/config/services";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { cn, formatDate } from "@/lib/utils";
import { VerificarCta } from "./verificar-cta";

export const metadata = { title: "Verificá tu identidad" };

/** Copy local del módulo IDENTIDAD — no toca src/lib/i18n (compartido). */
const COPY = {
  volver: "Volver a tu perfil",
  titulo: "Verificá tu identidad",
  subtitulo:
    "Un tilde que le dice a tu comunidad que detrás de tu perfil hay una persona real.",
  privacidadTitulo: "Tu documento nunca lo guardamos nosotros",
  privacidadCuerpo:
    "Tu documento lo procesa Stripe y NUNCA se guarda en nuestra base — nosotros solo recibimos un sí/no. Ni la foto, ni el número, ni tu nombre legal tocan nuestros servidores. Así, aunque alguien quisiera robar esos datos, acá no hay nada para robar.",
  comoTitulo: "Cómo funciona",
  pasos: [
    "Sacale una foto a tu documento (cédula, pasaporte o licencia) desde tu teléfono.",
    "Stripe lo revisa al instante — suele tardar menos de un minuto.",
    "Listo: el tilde aparece en tu perfil y tu Trust Score sube.",
  ],
  beneficiosTitulo: "Qué ganás",
  beneficios: [
    { icon: SealCheck, texto: "El tilde de identidad verificada en tu perfil y tus publicaciones." },
    { icon: TrendUp, texto: "Tu Trust Score sube — la gente confía más al contactarte." },
    { icon: LockKey, texto: "Cero datos sensibles nuevos en la plataforma: solo un sí/no." },
  ],
  // §11: nunca "verificado" a secas — la verificación describe QUÉ se
  // verificó y no promete conducta.
  disclaimer:
    "Verificar tu identidad confirma que tu documento es real — no garantiza la conducta de nadie. Ante cualquier trato, cuidate igual: nunca envíes dinero por adelantado.",
  yaVerificadoTitulo: "Tu identidad ya está verificada",
  yaVerificadoCuerpo: (fecha: string | null) =>
    fecha
      ? `Documento validado por Stripe Identity el ${fecha}. El tilde ya aparece en tu perfil.`
      : "Documento validado por Stripe Identity. El tilde ya aparece en tu perfil.",
} as const;

export default async function VerificarIdentidadPage() {
  const [tenant, supabase] = await Promise.all([getTenant(), createClient()]);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/entrar?next=/perfil/verificar");

  const { data: profile } = await supabase
    .from("profiles")
    .select("identity_verified, identity_verified_at")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile) redirect("/bienvenida");

  return (
    <div className="flex flex-col gap-6 pb-8">
      <Link
        href="/perfil"
        className="flex min-h-11 w-fit items-center gap-1.5 text-sm font-medium text-foreground-secondary transition-colors hover:text-foreground"
      >
        <ArrowLeft size={16} aria-hidden="true" />
        {COPY.volver}
      </Link>

      <header>
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
          {COPY.titulo}
        </h1>
        <p className="mt-1 text-sm text-foreground-secondary">{COPY.subtitulo}</p>
      </header>

      {profile.identity_verified ? (
        <BezelCard
          variant="success"
          coreClassName="flex flex-col items-center gap-3 px-6 py-8 text-center"
          role="status"
        >
          <SealCheck size={48} weight="fill" aria-hidden="true" className="text-success" />
          <p className="font-display text-xl font-bold text-foreground">
            {COPY.yaVerificadoTitulo}
          </p>
          <p className="max-w-[44ch] text-sm text-foreground-secondary">
            {COPY.yaVerificadoCuerpo(
              profile.identity_verified_at
                ? formatDate(profile.identity_verified_at, {
                    locale: tenant.locale,
                    style: "long",
                  })
                : null,
            )}
          </p>
          <Link
            href="/perfil"
            className={cn(buttonVariants({ variant: "outline", size: "md" }), "mt-1")}
          >
            {COPY.volver}
          </Link>
        </BezelCard>
      ) : (
        <>
          {/* El porqué anti-honeypot — el argumento central, primero */}
          <BezelCard variant="featured" coreClassName="flex flex-col gap-3 p-5">
            <div className="flex items-center gap-2.5">
              <span
                aria-hidden="true"
                className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand"
              >
                <LockKey size={20} weight="light" />
              </span>
              <h2 className="font-display text-base font-bold text-foreground">
                {COPY.privacidadTitulo}
              </h2>
            </div>
            <p className="text-sm leading-relaxed text-foreground-secondary">
              {COPY.privacidadCuerpo}
            </p>
          </BezelCard>

          <section aria-label={COPY.comoTitulo}>
            <h2 className="mb-3 text-sm font-semibold text-foreground-secondary">
              {COPY.comoTitulo}
            </h2>
            <ol className="flex flex-col gap-3">
              {COPY.pasos.map((paso, index) => (
                <li key={paso} className="flex items-start gap-3">
                  <span
                    aria-hidden="true"
                    className="numeric flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-subtle text-sm font-bold text-foreground-secondary"
                  >
                    {index + 1}
                  </span>
                  <p className="pt-0.5 text-sm leading-relaxed text-foreground">{paso}</p>
                </li>
              ))}
            </ol>
          </section>

          <section aria-label={COPY.beneficiosTitulo}>
            <h2 className="mb-3 text-sm font-semibold text-foreground-secondary">
              {COPY.beneficiosTitulo}
            </h2>
            <ul className="flex flex-col gap-2.5">
              {COPY.beneficios.map(({ icon: Icon, texto }) => (
                <li key={texto} className="flex items-start gap-2.5 text-sm">
                  <Icon
                    size={18}
                    aria-hidden="true"
                    className="mt-0.5 shrink-0 text-brand"
                  />
                  <span className="text-foreground">{texto}</span>
                </li>
              ))}
            </ul>
          </section>

          {isStripeConfigured ? (
            <VerificarCta stripeConfigured />
          ) : (
            // Gate HOY (§5.6): sin Stripe, estado premium — nunca un botón roto.
            <ProximamentePremium
              feature="la verificación de identidad"
              icon={<IdentificationCard size={24} weight="light" />}
            />
          )}

          {/* Copy legal §11: qué verifica y qué NO promete */}
          <p className="text-center text-xs leading-relaxed text-foreground-muted">
            {COPY.disclaimer}
          </p>
        </>
      )}
    </div>
  );
}
