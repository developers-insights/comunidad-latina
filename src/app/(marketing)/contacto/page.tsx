import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, Clock, EnvelopeSimple } from "@phosphor-icons/react/dist/ssr";
import { getTenant } from "@/lib/tenant/resolve";
import { SUPPORT_EMAIL, SUPPORT_TOPICS, buildSupportMailto } from "@/lib/support/contact";
import { buttonVariants } from "@/components/ui";
import { JsonLd } from "@/components/marketing/json-ld";
import { LegalCallout, LegalSection, legalProse } from "@/components/legal/legal-prose";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://comunidadlatina.com";
const LEGAL_ENTITY = "Comunidad Latina LLC";

const linkClass =
  "font-medium text-brand-ink underline decoration-brand-subtle underline-offset-2 hover:decoration-brand-ink";

const TOPIC_HINTS: Partial<Record<string, string>> = {
  cuenta: "No podés entrar, querés cambiar tu correo o borrar tu cuenta.",
  problema: "Algo de la app no anda como debería.",
  seguridad: "Una persona, un aviso o un mensaje que te preocupa.",
  pagos: "Un cobro, una suscripción, una cancelación o un reembolso.",
  idea: "Algo que te gustaría que la app hiciera.",
  otro: "Cualquier otra consulta, también las legales.",
};

const DOCUMENTS = [
  { href: "/legal/reembolsos", label: "Cancelación y reembolsos" },
  { href: "/legal/terminos", label: "Términos de uso" },
  { href: "/legal/privacidad", label: "Privacidad" },
];

export async function generateMetadata(): Promise<Metadata> {
  const tenant = await getTenant();
  const title = `Contacto — ${tenant.name}`;
  const description = `Cómo escribirle al equipo de ${tenant.name}: pagos, tu cuenta, reportes o cualquier consulta. Te respondemos en hasta 3 días hábiles.`;
  return {
    title,
    description,
    alternates: { canonical: `${SITE_URL}/contacto` },
    openGraph: {
      title,
      description,
      type: "website",
      locale: "es_US",
      images: [{ url: "/brand/og-logo.png", width: 1200, height: 630 }],
    },
  };
}

export default async function ContactoPage() {
  const tenant = await getTenant();

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-12 sm:py-16">
      <article>
        <JsonLd
          data={{
            "@context": "https://schema.org",
            "@type": "ContactPage",
            name: `Contacto — ${tenant.name}`,
            inLanguage: "es",
            url: `${SITE_URL}/contacto`,
            mainEntity: {
              "@type": "Organization",
              name: LEGAL_ENTITY,
              url: SITE_URL,
              email: SUPPORT_EMAIL,
              contactPoint: {
                "@type": "ContactPoint",
                contactType: "customer support",
                email: SUPPORT_EMAIL,
                availableLanguage: ["es"],
              },
            },
          }}
        />

        <header>
          <p className="text-sm font-semibold uppercase tracking-wide text-brand-ink">Contacto</p>
          <h1 className="mt-2 font-display text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
            Escribinos, te responde una persona
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-foreground-secondary">
            {tenant.name} lo opera <strong className={legalProse.strong}>{LEGAL_ENTITY}</strong>.
            Te atendemos por correo y en español.
          </p>
        </header>

        <div className="mt-8 overflow-hidden rounded-xl border border-border-subtle bg-[radial-gradient(120%_90%_at_0%_0%,var(--color-brand-tint),transparent_60%)] p-3 sm:p-5">
          <div className="rounded-lg border border-border bg-surface p-5 shadow-[0_1px_2px_rgba(0,0,0,0.06),0_12px_32px_-16px_rgba(0,0,0,0.18)] sm:p-6">
            <div className="flex items-start gap-3">
              <span
                aria-hidden="true"
                className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-tint text-brand-ink"
              >
                <EnvelopeSimple size={22} />
              </span>
              <div className="min-w-0">
                <p className="text-sm text-foreground-secondary">Nuestro correo</p>
                <a
                  href={`mailto:${SUPPORT_EMAIL}`}
                  className="mt-0.5 block break-all font-display text-lg font-semibold text-foreground underline decoration-border underline-offset-4 hover:decoration-brand-ink sm:text-xl"
                >
                  {SUPPORT_EMAIL}
                </a>
              </div>
            </div>

            <p className="mt-4 flex items-center gap-2 text-sm text-foreground-secondary">
              <Clock size={18} aria-hidden="true" className="shrink-0 text-foreground-muted" />
              Te respondemos en hasta 3 días hábiles.
            </p>

            <div className="mt-5 flex flex-col gap-2 sm:flex-row">
              <a
                href={buildSupportMailto("pagos", "", {})}
                className={buttonVariants({ variant: "primary", size: "md" })}
              >
                Consulta sobre un pago
              </a>
              <a
                href={buildSupportMailto("otro", "", {})}
                className={buttonVariants({ variant: "outline", size: "md" })}
              >
                Otra consulta
              </a>
            </div>
          </div>
        </div>

        <div className="mt-12">
          <LegalSection id="temas" title="En qué te podemos ayudar">
            <p className={legalProse.p}>
              Tocá el tema y se abre tu correo con el asunto ya puesto. Así tu mensaje le llega
              directo a quien lo resuelve.
            </p>
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {SUPPORT_TOPICS.map((topic) => (
                <li key={topic.id}>
                  <a
                    href={buildSupportMailto(topic.id, "", {})}
                    className="group flex h-full min-h-11 items-start justify-between gap-3 rounded-lg border border-border-subtle bg-surface p-4 transition-[border-color,transform] duration-(--duration-fast) hover:-translate-y-0.5 hover:border-border active:translate-y-0"
                  >
                    <span>
                      <span className="block font-semibold text-foreground">{topic.label}</span>
                      {TOPIC_HINTS[topic.id] ? (
                        <span className="mt-1 block text-sm leading-relaxed text-foreground-secondary">
                          {TOPIC_HINTS[topic.id]}
                        </span>
                      ) : null}
                    </span>
                    <ArrowUpRight
                      size={18}
                      aria-hidden="true"
                      className="mt-0.5 shrink-0 text-foreground-muted transition-colors group-hover:text-brand-ink"
                    />
                  </a>
                </li>
              ))}
            </ul>
          </LegalSection>

          <LegalSection id="con-cuenta" title="Si ya tenés cuenta">
            <p className={legalProse.p}>
              También podés escribirnos desde{" "}
              <Link href="/ajustes/soporte" className={linkClass}>
                Ajustes › Soporte
              </Link>
              . El correo sale con los datos de tu cuenta ya cargados, así no tenemos que
              preguntarte con qué correo entrás.
            </p>
            <LegalCallout>
              Nunca te vamos a pedir tu contraseña ni los números de tu tarjeta por correo. Si
              alguien te los pide en nuestro nombre, no respondas y avisanos.
            </LegalCallout>
          </LegalSection>

          <LegalSection id="documentos" title="Antes de escribir, quizás te sirve">
            <ul className={legalProse.ul}>
              {DOCUMENTS.map((doc) => (
                <li key={doc.href}>
                  <Link href={doc.href} className={linkClass}>
                    {doc.label}
                  </Link>
                </li>
              ))}
            </ul>
          </LegalSection>
        </div>
      </article>
    </div>
  );
}
