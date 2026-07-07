import type { Metadata } from "next";
import Link from "next/link";
import {
  ChartBar,
  HandHeart,
  Handshake,
  IdentificationBadge,
  Timer,
} from "@phosphor-icons/react/dist/ssr";
import type { Icon } from "@phosphor-icons/react";
import { BezelCard, buttonVariants } from "@/components/ui";

/**
 * Explicación educativa del Trust Score (§3.3): el "por qué" detrás del
 * número, en lenguaje claro. Honestidad radical: decimos qué mide, qué NO
 * garantiza, y que no se puede comprar. Destino del link "Leer cómo
 * funciona el Trust Score" del TrustScoreSheet.
 */

const COPY = {
  title: "Cómo funciona el Trust Score",
  lead: "Un número del 0 al 100 que resume las señales concretas de confianza de una persona en la comunidad. Nada de magia: cada punto tiene una explicación.",
  signalsTitle: "Qué señales lo componen",
  signals: [
    {
      icon: IdentificationBadge,
      title: "Identidad verificada",
      body: "La persona validó su identidad con un documento. Es la señal de más peso.",
    },
    {
      icon: Timer,
      title: "Tiempo en la comunidad",
      body: "Cuánto hace que participa. La antigüedad se construye — no se compra.",
    },
    {
      icon: Handshake,
      title: "Transacciones sin disputa",
      body: "Contactos y acuerdos que terminaron bien, sin reportes en el medio.",
    },
    {
      icon: HandHeart,
      title: "Avales de vecinos verificados",
      body: "Personas verificadas de la comunidad que la conocen y la avalan.",
    },
  ],
  honestyTitle: "Lo que el Trust Score NO es",
  honesty: [
    "No es una garantía de conducta: un número alto no asegura cómo se va a comportar alguien. Por eso la regla es una sola — nunca envíes dinero por adelantado.",
    "No se puede comprar: pagar un plan de negocio no suma ni un punto. Solo las señales reales lo mueven.",
    "Un número bajo no es un castigo: la mayoría de las cuentas nuevas arrancan abajo y suben con el tiempo. Mostramos lo que falta como \"todavía no\", nunca en rojo.",
  ],
  whereTitle: "Dónde lo ves",
  whereBody:
    "Al lado del nombre de la persona en avisos, perfiles y mensajes. Tocá el número y te mostramos el desglose completo: qué señales tiene y cuáles todavía no.",
  cta: "Ir al Escudo Anti-Estafa",
} as const;

export const metadata: Metadata = { title: COPY.title };

function SignalRow({
  icon: IconComponent,
  title,
  body,
}: {
  icon: Icon;
  title: string;
  body: string;
}) {
  return (
    <li className="flex items-start gap-3.5">
      <span
        aria-hidden="true"
        className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700"
      >
        <IconComponent size={22} />
      </span>
      <div className="min-w-0">
        <h3 className="font-display text-base font-semibold text-foreground">
          {title}
        </h3>
        <p className="mt-0.5 text-sm text-foreground-secondary">{body}</p>
      </div>
    </li>
  );
}

export default function TrustScorePage() {
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col items-center gap-3 pt-2 text-center">
        <span
          aria-hidden="true"
          className="flex size-16 items-center justify-center rounded-full bg-brand-50 text-brand"
        >
          <ChartBar size={34} weight="fill" />
        </span>
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
          {COPY.title}
        </h1>
        <p className="max-w-[38ch] text-sm text-foreground-secondary">{COPY.lead}</p>
      </header>

      <section aria-labelledby="ts-signals">
        <h2
          id="ts-signals"
          className="mb-3 font-display text-lg font-semibold text-foreground"
        >
          {COPY.signalsTitle}
        </h2>
        <BezelCard coreClassName="p-5">
          <ul className="flex flex-col gap-5">
            {COPY.signals.map((signal) => (
              <SignalRow key={signal.title} {...signal} />
            ))}
          </ul>
        </BezelCard>
      </section>

      <section aria-labelledby="ts-honesty">
        <h2
          id="ts-honesty"
          className="mb-3 font-display text-lg font-semibold text-foreground"
        >
          {COPY.honestyTitle}
        </h2>
        <div className="rounded-lg bg-surface-subtle px-4 py-3.5">
          <ul className="flex list-disc flex-col gap-2.5 pl-4 text-sm text-foreground-secondary">
            {COPY.honesty.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      </section>

      <section aria-labelledby="ts-where">
        <h2
          id="ts-where"
          className="mb-2 font-display text-lg font-semibold text-foreground"
        >
          {COPY.whereTitle}
        </h2>
        <p className="text-sm text-foreground-secondary">{COPY.whereBody}</p>
      </section>

      <Link
        href="/escudo"
        className={buttonVariants({ variant: "secondary", size: "md" })}
      >
        {COPY.cta}
      </Link>
    </div>
  );
}
