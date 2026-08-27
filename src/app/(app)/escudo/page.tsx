import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  BookOpenText,
  CaretRight,
  ClipboardText,
  Flag,
} from "@phosphor-icons/react/dist/ssr";
import type { Icon } from "@phosphor-icons/react";
import { BezelCard, Emblem } from "@/components/ui";
import { ESCUDO_ENABLED } from "./feature-flag";

/**
 * Hub del Escudo Anti-Estafa (moat §3): verificación DETERMINÍSTICA contra
 * registros oficiales + señales de la comunidad. Honestidad radical:
 * decimos qué hacemos y qué NO garantizamos — nunca "IA que promete".
 */

const COPY = {
  title: "Centro de seguridad",
  lead: "Herramientas concretas para cuidarte a vos y a tu familia.",
  what: "Te damos herramientas para verificar, reportar y aprender a cuidarte — con datos de fuentes oficiales cuando los tenemos.",
  whatNot:
    "Ninguna verificación garantiza cómo se va a comportar una persona. Por eso la regla es una sola: nunca envíes dinero por adelantado.",
  sections: {
    reportar: {
      title: "Reportar un problema",
      description:
        "¿Un aviso, perfil o mensaje te dio mala espina? Contanos — cuidás a los que vienen detrás.",
    },
    aprender: {
      title: "Aprender a protegerte",
      description:
        "Las 5 señales de alerta más comunes al alquilar en Nueva York, con ejemplos reales y qué hacer en cada caso.",
    },
    /**
     * La evidencia va TERCERA y no primera, y es una decisión editorial: quien
     * entra al Centro de seguridad casi siempre viene con algo concreto —algo
     * que denunciar o algo que no entiende—, y hacerlo pasar por nuestros
     * números antes de darle la herramienta sería ponernos primeros a nosotros.
     * Quien viene a evaluar la plataforma la encuentra igual: son tres tarjetas
     * en una pantalla, no un menú largo.
     */
    transparencia: {
      title: "Ver cómo viene funcionando",
      description:
        "Los números de lo que el sistema recibió y de lo que hizo con eso, y casos contados sin nombres.",
    },
  },
} as const;

export const metadata: Metadata = { title: COPY.title };

function SectionCard({
  href,
  icon: IconComponent,
  title,
  description,
}: {
  href: string;
  icon: Icon;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="group block rounded-xl focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
    >
      <BezelCard coreClassName="flex items-center gap-4 p-5">
        <span
          aria-hidden="true"
          className="flex size-12 shrink-0 items-center justify-center rounded-full bg-brand-tint text-brand-ink"
        >
          <IconComponent size={26} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-display text-base font-semibold text-foreground">
            {title}
          </span>
          <span className="mt-0.5 block text-sm text-foreground-secondary">
            {description}
          </span>
        </span>
        <CaretRight
          size={18}
          aria-hidden="true"
          className="shrink-0 text-foreground-muted transition-transform duration-(--duration-fast) ease-(--ease-out-premium) group-hover:translate-x-0.5"
        />
      </BezelCard>
    </Link>
  );
}

export default function EscudoPage() {
  if (!ESCUDO_ENABLED) notFound();

  return (
    <div className="flex flex-col gap-6">
      {/* Hero compacto */}
      <header className="flex flex-col items-center gap-3 pt-2 text-center">
        {/* El emblema del moat, en su casa. Sin el círculo verde de antes: un
            escudo verde sobre un disco verde se apelmaza. `priority` porque es
            lo único visual sobre el pliegue — son ~10 KB, no mueve el LCP. */}
        <Emblem name="escudo-check" size={88} priority />
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
          {COPY.title}
        </h1>
        <p className="max-w-[36ch] text-sm text-foreground-secondary">
          {COPY.lead}
        </p>
      </header>

      {/* Qué hace y qué NO garantiza — honestidad radical, sin letra chica */}
      <div className="rounded-lg bg-surface-subtle px-4 py-3.5 text-sm text-foreground-secondary">
        <p>{COPY.what}</p>
        <p className="mt-2 font-medium text-foreground">{COPY.whatNot}</p>
      </div>

      <nav aria-label="Herramientas de seguridad" className="flex flex-col gap-3">
        <SectionCard
          href="/escudo/reportar"
          icon={Flag}
          title={COPY.sections.reportar.title}
          description={COPY.sections.reportar.description}
        />
        <SectionCard
          href="/escudo/aprender"
          icon={BookOpenText}
          title={COPY.sections.aprender.title}
          description={COPY.sections.aprender.description}
        />
        <SectionCard
          href="/escudo/transparencia"
          icon={ClipboardText}
          title={COPY.sections.transparencia.title}
          description={COPY.sections.transparencia.description}
        />
      </nav>
    </div>
  );
}
