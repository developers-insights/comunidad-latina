import { CheckCircle, Info, Question } from "@phosphor-icons/react/dist/ssr";
import { Badge, BezelCard, ProgressBar } from "@/components/ui";
import { cn } from "@/lib/utils";
import { COPY } from "./copy";
import {
  formatRequirementGap,
  formatRequirementValue,
  type CreatorRequirementsResult,
  type Requirement,
} from "./requirements";

/**
 * REQUISITOS PARA RECIBIR TRABAJOS, con progreso (spec §6).
 *
 * Lo que esta tarjeta NO hace: decir "no calificás". Ese cartel es el que hace
 * que alguien cierre la app y no vuelva — no dice cuánto falta, no dice qué
 * hacer, y suena a un juicio sobre la persona en vez de a una cuenta de
 * números. Acá cada requisito muestra el valor actual, el objetivo, una barra
 * y la frase exacta de cuánto falta.
 *
 * Accesibilidad: el estado NUNCA se comunica sólo con color. Cada fila lleva
 * el ícono de cumplido y el número en texto ("820 de 1.000"), y la barra tiene
 * su `aria-label` con ese mismo dato — quien usa lector de pantalla escucha
 * exactamente lo que ve quien mira.
 *
 * Server Component: son datos que la página ya resolvió, sin interacción.
 */
export function CreatorRequirementsCard({
  result,
  locale = "es-US",
  className,
}: {
  result: CreatorRequirementsResult;
  locale?: string;
  className?: string;
}) {
  const { requirements, meetsAll, metCount, measurableCount, unmeasured } = result;

  return (
    <BezelCard
      variant={meetsAll ? "success" : "default"}
      coreClassName={cn("flex flex-col gap-5 p-5", className)}
    >
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-lg font-bold text-foreground">
            {COPY.requirements.title}
          </h2>
          {measurableCount > 0 && (
            <Badge variant={meetsAll ? "success" : "neutral"} className="shrink-0">
              {meetsAll && <CheckCircle size={13} weight="fill" aria-hidden="true" />}
              {COPY.requirements.progressLabel(metCount, measurableCount)}
            </Badge>
          )}
        </div>
        <p className="text-sm leading-relaxed text-foreground-secondary">
          {meetsAll ? COPY.requirements.subtitleMet : COPY.requirements.subtitlePending}
        </p>
      </header>

      <ul className="flex flex-col gap-4">
        {requirements.map((requirement) => (
          <RequirementRow key={requirement.id} requirement={requirement} locale={locale} />
        ))}
      </ul>

      {unmeasured.length > 0 && (
        <p className="flex items-start gap-2 rounded-md bg-surface-subtle px-3 py-2.5 text-sm leading-relaxed text-foreground-secondary">
          <Info size={16} weight="fill" aria-hidden="true" className="mt-0.5 shrink-0 text-info" />
          {COPY.requirements.unmeasuredNote}
        </p>
      )}

      <details className="group">
        <summary
          className={cn(
            "flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-sm font-semibold text-brand-ink",
            "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
          )}
        >
          <Question size={16} aria-hidden="true" />
          {COPY.requirements.whyTitle}
        </summary>
        <p className="mt-1 text-sm leading-relaxed text-foreground-secondary">
          {COPY.requirements.whyBody}
        </p>
      </details>
    </BezelCard>
  );
}

function RequirementRow({
  requirement,
  locale,
}: {
  requirement: Requirement;
  locale: string;
}) {
  const value = formatRequirementValue(requirement, locale);
  const gap = formatRequirementGap(requirement, locale);

  return (
    <li className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          {requirement.met && (
            <CheckCircle
              size={15}
              weight="fill"
              aria-hidden="true"
              className="shrink-0 text-success"
            />
          )}
          {requirement.label}
        </p>
        <p
          className={cn(
            "numeric text-sm font-medium",
            requirement.unmeasured ? "text-foreground-muted" : "text-foreground-secondary",
          )}
        >
          {value}
        </p>
      </div>

      <ProgressBar
        value={requirement.progress * 100}
        label={COPY.requirements.barLabel(requirement.label, value)}
      />

      <p
        className={cn(
          "text-xs",
          requirement.met
            ? "font-medium text-success-ink"
            : requirement.unmeasured
              ? "text-foreground-muted"
              : "text-foreground-secondary",
        )}
      >
        {gap}
        {!requirement.met && !requirement.unmeasured && (
          <>
            {" · "}
            <span className="text-foreground-muted">{requirement.hint}</span>
          </>
        )}
      </p>
    </li>
  );
}
