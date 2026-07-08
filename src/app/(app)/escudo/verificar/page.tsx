import type { Metadata } from "next";
import { ArrowSquareOut } from "@phosphor-icons/react/dist/ssr";
import { BackLink } from "@/components/escudo/back-link";
import { VerificadorForm } from "@/components/escudo/verificador-form";

/**
 * /escudo/verificar — Verificador de notarios y abogados (NY, v1).
 * Determinístico: el resultado sale de verification_checks (checks reales
 * contra registros oficiales), nunca de una promesa.
 */

const COPY = {
  back: "Escudo",
  title: "Verificar un profesional",
  lead: "Antes de pagarle a un notario o abogado, consultá si su matrícula figura activa en el registro oficial de Nueva York.",
  howAnchor: "¿Cómo verificamos?",
  how: {
    title: "¿Cómo verificamos?",
    intro:
      "Sin magia: consultamos registros públicos oficiales y te mostramos lo que dicen, literal y con fecha.",
    steps: [
      "Buscamos el número que ingresás en los checks que hicimos contra el registro oficial correspondiente.",
      "Te mostramos el resultado tal como figura en el registro, con la fecha de la consulta. No lo interpretamos ni lo suavizamos.",
      "Si todavía no tenemos ese registro conectado, te lo decimos con todas las letras — nunca inventamos un resultado.",
    ],
    disclaimer:
      "Importante: una licencia activa NO garantiza la conducta de nadie. Es un dato oficial, no un aval nuestro. La regla de siempre aplica: nunca envíes dinero por adelantado.",
    sourcesTitle: "Fuentes oficiales que usamos",
    sources: [
      {
        label: "Registro de Notarios Públicos — NY Department of State",
        url: "https://dos.ny.gov/notary-public",
      },
      {
        label: "Búsqueda de abogados registrados — NY State Unified Court System",
        url: "https://iapps.courts.state.ny.us/attorneyservices/search",
      },
    ],
  },
} as const;

export const metadata: Metadata = { title: COPY.title };

export default function VerificarPage() {
  return (
    <div className="flex flex-col gap-6">
      <BackLink href="/escudo" label={COPY.back} />

      <header className="flex flex-col gap-2">
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
          {COPY.title}
        </h1>
        <p className="text-sm text-foreground-secondary">{COPY.lead}</p>
        <a
          href="#como-verificamos"
          className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-ink underline-offset-4 hover:underline focus-visible:outline-none focus-visible:rounded-sm focus-visible:ring-[3px] focus-visible:ring-focus-ring"
        >
          {COPY.howAnchor}
        </a>
      </header>

      <VerificadorForm />

      <section
        id="como-verificamos"
        aria-labelledby="como-verificamos-titulo"
        className="scroll-mt-20 rounded-lg bg-surface-subtle px-5 py-5"
      >
        <h2
          id="como-verificamos-titulo"
          className="font-display text-lg font-semibold text-foreground"
        >
          {COPY.how.title}
        </h2>
        <p className="mt-2 text-sm text-foreground-secondary">
          {COPY.how.intro}
        </p>
        <ol className="mt-3 flex list-decimal flex-col gap-2 pl-5 text-sm text-foreground-secondary marker:font-semibold marker:text-foreground">
          {COPY.how.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <p className="mt-4 text-sm font-medium text-foreground">
          {COPY.how.disclaimer}
        </p>

        <h3 className="mt-5 text-sm font-semibold text-foreground">
          {COPY.how.sourcesTitle}
        </h3>
        <ul className="mt-2 flex flex-col gap-1.5">
          {COPY.how.sources.map((source) => (
            <li key={source.url}>
              <a
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center gap-1.5 text-sm text-brand-ink underline-offset-4 hover:underline focus-visible:outline-none focus-visible:rounded-sm focus-visible:ring-[3px] focus-visible:ring-focus-ring"
              >
                {source.label}
                <ArrowSquareOut size={14} aria-hidden="true" className="shrink-0" />
              </a>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
