import type { Metadata } from "next";
import Link from "next/link";
import { DeviceMobile, PaperPlaneTilt } from "@phosphor-icons/react/dist/ssr";
import { BRAND_NAME } from "@/lib/brand";
import { verificationSmsBody } from "@/lib/phone/sms";
import { SUPPORT_EMAIL } from "@/lib/support/contact";
import {
  SMS_CONSENT_EN,
  SMS_CONSENT_ES,
  SMS_POLICY_HREF,
  SMS_SEND_CTA,
  SMS_SENDER_NUMBER,
} from "@/lib/phone/sms-consent";
import { buttonVariants } from "@/components/ui";
import { JsonLd } from "@/components/marketing/json-ld";
import {
  LegalCallout,
  LegalHeader,
  LegalSection,
  LegalToc,
  legalProse,
} from "@/components/legal/legal-prose";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://comunidadlatina.com";
const UPDATED = "27 de septiembre de 2026";
const LEGAL_ENTITY = "Comunidad Latina LLC";

const TOC = [
  { id: "que-mensajes", label: "Qué mensajes enviamos" },
  { id: "consentimiento", label: "Cómo das tu consentimiento" },
  { id: "frecuencia", label: "Frecuencia y costos" },
  { id: "stop", label: "Cómo dejar de recibirlos" },
  { id: "help", label: "Ayuda" },
  { id: "tu-numero", label: "Tu número no se comparte" },
  { id: "english", label: "English version" },
];

export const metadata: Metadata = {
  title: "Política de mensajes de texto (SMS)",
  description:
    "Solo usamos SMS para mandarte códigos de verificación que vos pedís. Cómo das tu consentimiento, cuántos mensajes llegan, cómo cortarlos con STOP y cómo pedir ayuda con HELP.",
  alternates: { canonical: `${SITE_URL}${SMS_POLICY_HREF}` },
};

const linkClass =
  "font-medium text-brand-ink underline decoration-brand-subtle underline-offset-2 hover:decoration-brand-ink";

function Mail() {
  return (
    <a href={`mailto:${SUPPORT_EMAIL}`} className={linkClass}>
      {SUPPORT_EMAIL}
    </a>
  );
}

function Keyword({ children }: { children: string }) {
  return (
    <kbd className="rounded-sm border border-border bg-surface-subtle px-1.5 py-0.5 font-mono text-[0.85em] font-semibold text-foreground">
      {children}
    </kbd>
  );
}

function ConsentScreen() {
  return (
    <figure className="overflow-hidden rounded-xl border border-border-subtle bg-[radial-gradient(120%_90%_at_0%_0%,var(--color-brand-tint),transparent_60%)] p-3 sm:p-5">
      <div className="mx-auto max-w-sm rounded-lg border border-border bg-surface p-5 shadow-[0_1px_2px_rgba(0,0,0,0.06),0_12px_32px_-16px_rgba(0,0,0,0.18)]">
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-tint text-brand-ink"
          >
            <DeviceMobile size={22} />
          </span>
          <div>
            <p className="font-display text-base font-semibold text-foreground">
              Verificá tu teléfono
            </p>
            <p className="mt-0.5 text-sm leading-relaxed text-foreground-secondary">
              Es opcional. Te mandamos un código por SMS para confirmar que el número es tuyo.
            </p>
          </div>
        </div>
        <p className="mt-4 text-sm font-medium text-foreground">Tu número de teléfono</p>
        <p
          aria-hidden="true"
          className="mt-1.5 flex h-11 items-center rounded-md border border-border px-4 text-base text-placeholder"
        >
          (917) 555-0142
        </p>
        <span
          aria-hidden="true"
          className={buttonVariants({ variant: "primary", size: "md", className: "pointer-events-none mt-4" })}
        >
          <PaperPlaneTilt size={18} />
          {SMS_SEND_CTA}
        </span>
        <p className="mt-3 text-xs leading-relaxed text-foreground-muted">
          {SMS_CONSENT_ES} <span className="font-semibold text-brand-ink underline">Ver la Política de SMS</span>.
        </p>
      </div>
      <figcaption className="mt-3 text-center text-xs text-foreground-muted">
        Así se ve la pantalla <span className="font-mono">Ajustes › Tu teléfono</span>, el único
        lugar donde se pide un código. / The only screen where a code can be requested.
      </figcaption>
    </figure>
  );
}

export default function SmsPolicyPage() {
  return (
    <article>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "WebPage",
          name: `Política de mensajes de texto (SMS) — ${BRAND_NAME}`,
          inLanguage: ["es", "en"],
          url: `${SITE_URL}${SMS_POLICY_HREF}`,
          publisher: { "@type": "Organization", name: LEGAL_ENTITY, url: SITE_URL },
        }}
      />

      <LegalHeader
        title="Política de mensajes de texto (SMS)"
        updated={UPDATED}
        intro={
          <>
            <strong className={legalProse.strong}>En pocas palabras:</strong> te mandamos un SMS
            solo cuando vos pedís un código para verificar tu teléfono. Nada de publicidad. Podés
            cortarlo cuando quieras respondiendo <Keyword>STOP</Keyword>.{" "}
            <a href="#english" className={linkClass} lang="en">
              Read in English
            </a>
            .
          </>
        }
      />

      <LegalToc items={TOC} />

      <LegalSection id="que-mensajes" title="Qué mensajes enviamos">
        <p className={legalProse.p}>
          {BRAND_NAME} ({LEGAL_ENTITY}) envía por SMS solo códigos de verificación de un solo uso,
          desde el número {SMS_SENDER_NUMBER}. El código sirve para confirmar que el teléfono que
          cargaste en tu cuenta es tuyo, y vence a los 10 minutos. Un mensaje se ve así:
        </p>
        <LegalCallout>
          <span className="font-mono text-foreground">
            {verificationSmsBody({ code: "482913" })}
          </span>
        </LegalCallout>
        <p className={legalProse.p}>
          No usamos este número para publicidad, ofertas, promociones, boletines ni avisos de
          ningún otro tipo.
        </p>
      </LegalSection>

      <LegalSection id="consentimiento" title="Cómo das tu consentimiento">
        <p className={legalProse.p}>
          Verificar tu teléfono es <strong className={legalProse.strong}>opcional</strong>: no
          hace falta para crear tu cuenta ni para usar {BRAND_NAME}. Si querés hacerlo, entrás a
          tu cuenta, vas a <em>Ajustes › Tu teléfono</em>, escribís tu número y tocás «
          {SMS_SEND_CTA}». Justo debajo del botón está este aviso:
        </p>
        <ConsentScreen />
        <p className={legalProse.p}>
          Solo te escribimos al número que vos cargaste y cuando vos lo pedís. Nunca te anotamos
          por tu cuenta, no compramos listas de números y no usamos números sacados de otro lado.
        </p>
      </LegalSection>

      <LegalSection id="frecuencia" title="Frecuencia y costos">
        <ul className={legalProse.ul}>
          <li>
            La frecuencia varía: llega un mensaje por cada código que pidas. Como tope, no se
            pueden pedir más de 3 códigos por hora ni más de 10 por día para un mismo número.
          </li>
          <li>
            Pueden aplicarse tarifas de mensajes y datos, según el plan de tu compañía de
            teléfono. {BRAND_NAME} no te cobra nada por estos mensajes.
          </li>
          <li>Las compañías de teléfono no son responsables por mensajes demorados o que no lleguen.</li>
        </ul>
      </LegalSection>

      <LegalSection id="stop" title="Cómo dejar de recibirlos">
        <p className={legalProse.p}>
          Respondé <Keyword>STOP</Keyword> a cualquiera de nuestros mensajes (también sirven{" "}
          <Keyword>CANCEL</Keyword>, <Keyword>END</Keyword>, <Keyword>QUIT</Keyword> y{" "}
          <Keyword>UNSUBSCRIBE</Keyword>). Te llega un último mensaje confirmando la baja y
          después no te escribimos más. Si cambiás de idea, respondé <Keyword>START</Keyword>.
        </p>
        <p className={legalProse.p}>
          También podés borrar tu número cuando quieras desde <em>Ajustes › Tu teléfono</em>, y se
          borra de verdad.
        </p>
      </LegalSection>

      <LegalSection id="help" title="Ayuda">
        <p className={legalProse.p}>
          Respondé <Keyword>HELP</Keyword> a cualquiera de nuestros mensajes y te contestamos con
          cómo contactarnos, o escribinos directo a <Mail />.
        </p>
      </LegalSection>

      <LegalSection id="tu-numero" title="Tu número no se comparte">
        <p className={legalProse.p}>
          Tu número de teléfono y tu consentimiento para recibir SMS no se comparten con terceros
          ni se venden, ni para marketing ni para ningún fin promocional. Para entregar el mensaje
          usamos a Twilio, que recibe el número y el texto del SMS solo para enviarlo.
        </p>
        <p className={legalProse.p}>
          El resto de lo que hacemos con tus datos está en la{" "}
          <Link href="/legal/privacidad" className={linkClass}>
            Política de Privacidad
          </Link>
          , y las reglas de uso de la plataforma en los{" "}
          <Link href="/legal/terminos" className={linkClass}>
            Términos de Uso
          </Link>
          .
        </p>
      </LegalSection>

      <section
        id="english"
        lang="en"
        className="mt-16 scroll-mt-24 rounded-xl border border-border-subtle bg-surface p-6 sm:p-8"
      >
        <p className="text-sm font-semibold uppercase tracking-wide text-brand-ink">
          English version · Last updated September 27, 2026
        </p>
        <h2 className="mt-2 font-display text-2xl font-bold tracking-tight text-foreground">
          SMS Terms and Policy
        </h2>
        <div className="mt-5 space-y-4">
          <p className={legalProse.p}>
            <strong className={legalProse.strong}>Program.</strong> {BRAND_NAME} ({LEGAL_ENTITY})
            sends only one-time verification codes by text message, from {SMS_SENDER_NUMBER}, when
            a registered user asks to verify their phone number. Codes expire after 10 minutes. We
            never send marketing, offers, promotions or newsletters by SMS.
          </p>
          <p className={legalProse.p}>
            <strong className={legalProse.strong}>Consent (web form).</strong> Phone
            verification is optional and is not required to create an account or use{" "}
            {BRAND_NAME}. A signed-in user opens Settings › Your phone, types their number and
            taps “{SMS_SEND_CTA}” (Send code). Right below the button they see: “{SMS_CONSENT_EN}”
            We only text the number the user entered themselves, only when they request a code.
          </p>
          <p className={legalProse.p}>
            <strong className={legalProse.strong}>Frequency and cost.</strong> Message frequency
            varies: one message per code requested, capped at 3 per hour and 10 per day per number.
            Message and data rates may apply. Carriers are not liable for delayed or undelivered
            messages.
          </p>
          <p className={legalProse.p}>
            <strong className={legalProse.strong}>Opt out.</strong> Reply <Keyword>STOP</Keyword>{" "}
            (or CANCEL, END, QUIT, UNSUBSCRIBE) at any time to stop receiving messages; you will
            get one final confirmation. Reply <Keyword>START</Keyword> to opt back in. Users can
            also delete their number from Settings.
          </p>
          <p className={legalProse.p}>
            <strong className={legalProse.strong}>Help.</strong> Reply <Keyword>HELP</Keyword>{" "}
            for help, or email <Mail />.
          </p>
          <p className={legalProse.p}>
            <strong className={legalProse.strong}>Privacy.</strong> Phone numbers and SMS consent
            will not be shared with third parties or affiliates for marketing or promotional
            purposes, and are never sold. Twilio receives the number and message text only to
            deliver the SMS. See our{" "}
            <Link href="/legal/privacidad" className={linkClass}>
              Privacy Policy
            </Link>{" "}
            and{" "}
            <Link href="/legal/terminos" className={linkClass}>
              Terms of Use
            </Link>{" "}
            (in Spanish).
          </p>
        </div>
      </section>
    </article>
  );
}
