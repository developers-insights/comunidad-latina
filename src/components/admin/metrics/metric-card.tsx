import { ArrowDownRight, ArrowUpRight, Minus } from "@phosphor-icons/react/dist/ssr";
import { AnimatedNumber } from "@/components/motion";
import { COPY, METRIC_COPY } from "@/lib/metrics/copy";
import { deltaPercent } from "@/lib/metrics/queries";
import type { MetricKey } from "@/lib/metrics/types";
import { Sparkline } from "./sparkline";
import { METRIC_TONE } from "./tone";

/**
 * Tarjeta de una de las tres métricas del plan.
 *
 * La definición va ABAJO DEL NÚMERO, siempre visible — no en un tooltip ni en
 * un acordeón. Es el punto del encargo: el número se mira en una reunión y
 * alguien va a preguntar "¿qué cuenta eso?". La respuesta tiene que estar en la
 * misma pantalla, sin hacer clic.
 *
 * Por eso la tarjeta es alta. Es la decisión correcta acá: un tablero de tres
 * números que no se pueden interpretar es más corto y no sirve para nada.
 */

function Delta({ current, previous, days }: { current: number; previous: number; days: number }) {
  const pct = deltaPercent(current, previous);

  if (pct === null) {
    return <span className="text-xs text-foreground-muted">{COPY.noComparison}</span>;
  }

  if (pct === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-foreground-secondary">
        <Minus size={12} weight="bold" aria-hidden="true" />
        {COPY.sameAsBefore}
      </span>
    );
  }

  const up = pct > 0;
  // La flecha y el signo hacen el trabajo; el color sólo acompaña. Una caída no
  // se pinta de rojo: bajar no es un error, es un dato.
  const Icon = up ? ArrowUpRight : ArrowDownRight;

  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-medium ${
        up ? "text-success-ink" : "text-foreground-secondary"
      }`}
    >
      <Icon size={12} weight="bold" aria-hidden="true" />
      {up ? "+" : "−"}
      {Math.abs(pct)}%
      <span className="font-normal text-foreground-muted">{COPY.comparedTo(days)}</span>
    </span>
  );
}

export function MetricCard({
  metric,
  value,
  previous,
  series,
  days,
}: {
  metric: MetricKey;
  value: number;
  previous: number;
  series: number[];
  days: number;
}) {
  const copy = METRIC_COPY[metric];
  const headingId = `metrica-${metric}`;

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5 shadow-xs"
    >
      <div className="flex flex-col gap-0.5">
        {/* La pregunta del plan, textual: así el cliente reconoce lo que pidió. */}
        <p className="text-xs text-foreground-muted">{copy.question}</p>
        <h3 id={headingId} className="font-display text-base font-semibold text-foreground">
          {copy.label}
        </h3>
      </div>

      <div className="flex flex-col gap-1">
        <p className="font-display text-4xl font-bold leading-none text-foreground">
          <AnimatedNumber value={value} startOnView />
        </p>
        <Delta current={value} previous={previous} days={days} />
      </div>

      <Sparkline values={series} tone={METRIC_TONE[metric]} />

      <dl className="flex flex-col gap-2 border-t border-border-subtle pt-3 text-xs leading-relaxed">
        <div>
          <dt className="font-semibold text-foreground-secondary">{COPY.definitionCounts}</dt>
          <dd className="text-foreground-secondary">{copy.counts}</dd>
        </div>
        <div>
          <dt className="font-semibold text-foreground-muted">{COPY.definitionExcludes}</dt>
          <dd className="text-foreground-muted">{copy.excludes}</dd>
        </div>
      </dl>
    </section>
  );
}
