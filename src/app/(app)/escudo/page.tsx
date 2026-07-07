import type { Metadata } from "next";
import Link from "next/link";
import {
  BookOpenText,
  CaretRight,
  Compass,
  Flag,
  IdentificationCard,
  ShieldCheck,
} from "@phosphor-icons/react/dist/ssr";
import type { Icon } from "@phosphor-icons/react";
import { BezelCard } from "@/components/ui";

/**
 * Hub del Escudo Anti-Estafa (moat §3): verificación DETERMINÍSTICA contra
 * registros oficiales + señales de la comunidad. Honestidad radical:
 * decimos qué hacemos y qué NO garantizamos — nunca "IA que promete".
 */

const COPY = {
  title: "Escudo Anti-Estafa",
  lead: "Herramientas concretas para que nadie se aproveche de vos ni de tu familia.",
  what: "Consultamos registros oficiales (con fecha de consulta) y sumamos los reportes de tu propia comunidad. Sin magia, sin promesas vacías: te mostramos lo que dice el registro, literal.",
  whatNot:
    "Ninguna verificación garantiza cómo se va a comportar una persona. Por eso la regla es una sola: nunca envíes dinero por adelantado.",
  sections: {
    verificar: {
      title: "Verificar un profesional",
      description:
        "Notarios y abogados: consultá si la matrícula que te dieron figura activa en el registro oficial de NY.",
    },
    reportar: {
      title: "Reportar una estafa",
      description:
        "¿Un aviso, perfil o mensaje te dio mala espina o ya te quisieron estafar? Contanos — protegés a los que vienen detrás.",
    },
    aprender: {
      title: "Aprender a protegerte",
      description:
        "Las 5 señales de estafa de alquiler más comunes en Nueva York, con ejemplos reales y qué hacer en cada caso.",
    },
    asistente: {
      title: "Preguntale al Asistente",
      description:
        "¿Dudas sobre un alquiler, un trámite o un aviso raro? Preguntá y te respondo desde las guías y fuentes verificadas de tu comunidad.",
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
      className="group block rounded-xl focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-brand-200)]"
    >
      <BezelCard coreClassName="flex items-center gap-4 p-5">
        <span
          aria-hidden="true"
          className="flex size-12 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700"
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
  return (
    <div className="flex flex-col gap-6">
      {/* Hero compacto */}
      <header className="flex flex-col items-center gap-3 pt-2 text-center">
        <span
          aria-hidden="true"
          className="flex size-16 items-center justify-center rounded-full bg-success-bg text-success"
        >
          <ShieldCheck size={34} weight="fill" />
        </span>
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

      {/* 4 secciones */}
      <nav aria-label="Herramientas del Escudo" className="flex flex-col gap-3">
        <SectionCard
          href="/escudo/verificar"
          icon={IdentificationCard}
          title={COPY.sections.verificar.title}
          description={COPY.sections.verificar.description}
        />
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
          href="/asistente"
          icon={Compass}
          title={COPY.sections.asistente.title}
          description={COPY.sections.asistente.description}
        />
      </nav>
    </div>
  );
}
