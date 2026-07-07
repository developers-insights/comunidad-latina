import { cn } from "@/lib/utils";

/**
 * Barra de ai_score (0-100) de la cola de moderación (§8): el color sigue los
 * umbrales del plan (0-30 auto / 31-70 revisar / 71-100 humano) con semánticos
 * fijos — nunca derivados de la marca. Ícono+número+texto, no solo color.
 */
export function ScoreBar({ score }: { score: number | null }) {
  if (score === null) {
    return (
      <span className="inline-flex items-center rounded-full bg-surface-subtle px-2.5 py-0.5 text-xs font-medium text-foreground-secondary">
        Sin puntaje de IA
      </span>
    );
  }

  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const tone =
    clamped <= 30
      ? { bar: "bg-success", text: "text-success", label: "riesgo bajo" }
      : clamped <= 70
        ? { bar: "bg-warning", text: "text-warning", label: "riesgo medio" }
        : { bar: "bg-danger", text: "text-danger", label: "riesgo alto" };

  return (
    <div className="flex items-center gap-2" aria-label={`Puntaje de IA ${clamped} de 100 — ${tone.label}`}>
      <div
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={clamped}
        className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-subtle"
      >
        <div className={cn("h-full rounded-full", tone.bar)} style={{ width: `${clamped}%` }} />
      </div>
      <span className={cn("text-xs font-semibold tabular-nums", tone.text)}>
        {clamped}
        <span className="font-normal text-foreground-muted"> / 100 · {tone.label}</span>
      </span>
    </div>
  );
}
