import type { Metadata } from "next";
import Link from "next/link";
import {
  Flag,
  IdentificationCard,
  Scales,
  ShieldCheck,
} from "@phosphor-icons/react/dist/ssr";
import { BezelCard } from "@/components/ui";
import { ScamShieldNotice } from "@/components/trust";
import { BackLink } from "@/components/escudo/back-link";

/**
 * /escudo/aprender — guía educativa estática del Escudo (§3.3).
 * Contenido real: las 5 señales de estafa de alquiler más comunes en NY,
 * con ejemplos concretos y qué hacer. Español cálido, cero relleno.
 */

const COPY = {
  back: "Escudo",
  title: "Aprendé a protegerte",
  lead: "Las estafas de alquiler se repiten: son casi siempre las mismas 5 jugadas. Si las conocés, las ves venir de lejos.",
  noticeIntro:
    "Este aviso amarillo te va a aparecer en la app cada vez que estés por hacer algo delicado. Cuando lo veas, frená un segundo y releelo:",
  signalsTitle: "Las 5 señales de una estafa de alquiler",
  notaryTitle: "Ojo: en Estados Unidos, un “notario” NO es un abogado",
  notaryBody:
    "En muchos países un notario es un profesional del derecho. En EE. UU. no: un notary public solo certifica firmas — no puede darte consejo legal ni llevar tu caso de inmigración. Hay gente que se aprovecha de esa confusión para cobrar miles de dólares por trámites que no puede hacer.",
  notaryAction:
    "Si alguien se presenta como notario y te ofrece resolver temas legales o de inmigración, verificá su matrícula y pedí siempre un abogado.",
  ctaTitle: "¿Viste alguna de estas señales?",
  ctaVerificar: "Verificar un profesional",
  ctaReportar: "Reportar una estafa",
} as const;

type Signal = {
  title: string;
  looksLike: string;
  example: string;
  actions: string[];
};

const SIGNALS: Signal[] = [
  {
    title: "Te piden dinero antes de ver el lugar",
    looksLike:
      "Un depósito, una “seña para reservar” o el primer mes por Zelle, Venmo o transferencia — antes de que pises el apartamento.",
    example:
      "“El cuarto en Corona vuela, hay mucha gente interesada. Mandame $600 de seña hoy y te lo guardo hasta el sábado.”",
    actions: [
      "Nunca envíes dinero sin haber visto el lugar en persona o por videollamada en vivo (no un video grabado).",
      "Un dueño serio no te pide plata para “guardarte” una visita.",
    ],
  },
  {
    title: "El precio está muy por debajo del mercado",
    looksLike:
      "Un apartamento luminoso, renovado y amueblado en Queens por la mitad de lo que cuesta cualquier cosa parecida en la zona.",
    example:
      "Un 2 bedrooms en Jackson Heights por $1,100 con fotos de revista, cuando todo lo similar ronda los $2,400.",
    actions: [
      "Compará con otros avisos de la misma zona: si es demasiado bueno para ser verdad, casi siempre no es verdad.",
      "Buscá las fotos en internet — las estafas suelen usar imágenes robadas de otros avisos.",
    ],
  },
  {
    title: "El “dueño” no puede mostrarte el lugar",
    looksLike:
      "Está “de viaje”, “trabajando en otro estado” o “en el ejército”. Te ofrece mandarte las llaves por correo si pagás primero.",
    example:
      "“Estoy en Texas por trabajo. Pagá el primer mes y el depósito, y te envío las llaves por FedEx esta semana.”",
    actions: [
      "No existe alquiler real donde las llaves llegan por correo a cambio de una transferencia.",
      "Si nadie puede abrirte la puerta, no es tu apartamento — es tu dinero lo que quieren.",
    ],
  },
  {
    title: "Te apuran para decidir ya",
    looksLike:
      "“Hay cinco familias interesadas”, “si no pagás hoy lo pierdo”, mensajes a toda hora presionando. La urgencia es la herramienta favorita del estafador.",
    example:
      "“Tengo a otra persona con el efectivo en la mano. Decime en una hora o se lo doy a ella.”",
    actions: [
      "Frená. Nadie pierde un apartamento real por tomarse un día para verificar.",
      "La presión de tiempo es en sí misma una señal: cuanto más te apuran, más despacio andá.",
    ],
  },
  {
    title: "Te piden documentos o datos de más, demasiado pronto",
    looksLike:
      "Foto del pasaporte, número de Social Security o ITIN completo, datos bancarios — antes de una visita o de un contrato real.",
    example:
      "“Para la aplicación mandame foto de tu pasaporte y tu Social por WhatsApp, así te apruebo rápido.”",
    actions: [
      "Compartí documentos solo cuando haya un contrato de verdad y hayas verificado con quién estás tratando.",
      "Con tus datos pueden abrir cuentas y pedir créditos a tu nombre — cuidalos como si fueran plata.",
    ],
  },
];

export const metadata: Metadata = { title: COPY.title };

function SignalCard({ signal, index }: { signal: Signal; index: number }) {
  return (
    <BezelCard coreClassName="flex flex-col gap-3 p-5">
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-tint font-display text-sm font-bold tabular-nums text-brand-ink"
        >
          {index + 1}
        </span>
        <h3 className="font-display text-base font-semibold text-foreground">
          {signal.title}
        </h3>
      </div>
      <p className="text-sm text-foreground-secondary">{signal.looksLike}</p>
      <blockquote className="rounded-lg bg-surface-subtle px-4 py-3 text-sm italic text-foreground-secondary">
        {signal.example}
      </blockquote>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">
          Qué hacer
        </p>
        <ul className="mt-1.5 flex list-disc flex-col gap-1 pl-5 text-sm text-foreground-secondary marker:text-brand-ink">
          {signal.actions.map((action) => (
            <li key={action}>{action}</li>
          ))}
        </ul>
      </div>
    </BezelCard>
  );
}

export default function AprenderPage() {
  return (
    <div className="flex flex-col gap-6">
      <BackLink href="/escudo" label={COPY.back} />

      <header className="flex flex-col gap-2">
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
          {COPY.title}
        </h1>
        <p className="text-sm text-foreground-secondary">{COPY.lead}</p>
      </header>

      {/* El aviso del Escudo, ejemplificado: el usuario aprende a reconocerlo */}
      <section aria-label="El aviso de seguridad de la app">
        <p className="mb-2 text-sm text-foreground-secondary">
          {COPY.noticeIntro}
        </p>
        <ScamShieldNotice variant="rental" learnHref="#senales" />
      </section>

      <section
        id="senales"
        aria-labelledby="senales-titulo"
        className="scroll-mt-20 flex flex-col gap-3"
      >
        <h2
          id="senales-titulo"
          className="font-display text-lg font-semibold text-foreground"
        >
          {COPY.signalsTitle}
        </h2>
        {SIGNALS.map((signal, index) => (
          <SignalCard key={signal.title} signal={signal} index={index} />
        ))}
      </section>

      {/* La trampa clásica del "notario" — clave para la diáspora */}
      <BezelCard variant="warning" coreClassName="flex flex-col gap-2 p-5">
        <div className="flex items-start gap-3">
          <Scales
            size={24}
            aria-hidden="true"
            className="mt-0.5 shrink-0 text-warning"
          />
          <h2 className="font-display text-base font-semibold text-foreground">
            {COPY.notaryTitle}
          </h2>
        </div>
        <p className="text-sm text-foreground-secondary">{COPY.notaryBody}</p>
        <p className="text-sm font-medium text-foreground">
          {COPY.notaryAction}
        </p>
      </BezelCard>

      {/* Cierre: a dónde ir con lo aprendido */}
      <section
        aria-label={COPY.ctaTitle}
        className="flex flex-col items-center gap-3 rounded-lg bg-surface-subtle px-5 py-6 text-center"
      >
        <ShieldCheck
          size={28}
          aria-hidden="true"
          className="text-success"
        />
        <h2 className="font-display text-base font-semibold text-foreground">
          {COPY.ctaTitle}
        </h2>
        <div className="flex w-full flex-col gap-2">
          <Link
            href="/escudo/verificar"
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-brand px-5 text-sm font-semibold text-brand-foreground shadow-xs transition-colors duration-(--duration-fast) hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
          >
            <IdentificationCard size={18} aria-hidden="true" />
            {COPY.ctaVerificar}
          </Link>
          <Link
            href="/escudo/reportar"
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md border border-border bg-transparent px-5 text-sm font-semibold text-foreground transition-colors duration-(--duration-fast) hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
          >
            <Flag size={18} aria-hidden="true" />
            {COPY.ctaReportar}
          </Link>
        </div>
      </section>
    </div>
  );
}
