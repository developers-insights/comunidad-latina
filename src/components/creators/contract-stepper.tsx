import { Prohibit, Warning } from "@phosphor-icons/react/dist/ssr";
import { Badge, type BadgeProps } from "@/components/ui";
import { cn } from "@/lib/utils";
import { CONTRACT_STEPS, contractStepIndex, type ContractStatus } from "./contract-machine";
import { COPY } from "./copy";

const STATUS_VARIANT: Record<ContractStatus, NonNullable<BadgeProps["variant"]>> = {
  proposed: "neutral",
  funded: "info",
  delivered: "brand",
  released: "success",
  canceled: "neutral",
  disputed: "warning",
};

/** Cápsula de estado (código de color fijo del contrato). Solo lectura. */
export function ContractStatusBadge({
  status,
  className,
}: {
  status: ContractStatus;
  className?: string;
}) {
  return (
    <Badge variant={STATUS_VARIANT[status]} className={className}>
      {COPY.status[status]}
    </Badge>
  );
}

/**
 * Stepper visual del ciclo de garantía: propuesto → en garantía → entregado →
 * liberado, con el hito actual resaltado en el violeta del módulo (decorativo).
 * Las salidas (cancelado / en disputa) se muestran como estado terminal aparte.
 */
export function ContractStepper({ status }: { status: ContractStatus }) {
  const idx = contractStepIndex(status);
  const canceled = status === "canceled";
  const disputed = status === "disputed";

  return (
    <div>
      <ol className="flex items-stretch gap-1.5" aria-label="Progreso del contrato">
        {CONTRACT_STEPS.map((step, i) => {
          const reached = !canceled && idx >= 0 && i <= idx;
          const current = !canceled && !disputed && i === idx;
          return (
            <li key={step} className="flex flex-1 flex-col items-center gap-1.5 text-center">
              <span
                aria-hidden="true"
                className={cn(
                  "h-1.5 w-full rounded-full transition-colors",
                  reached ? "bg-[var(--accent-creadores)]" : "bg-border",
                )}
              />
              <span
                className={cn(
                  "text-[11px] leading-tight",
                  current
                    ? "font-bold text-foreground"
                    : reached
                      ? "font-medium text-foreground-secondary"
                      : "font-medium text-foreground-muted",
                )}
              >
                {COPY.status[step]}
              </span>
            </li>
          );
        })}
      </ol>

      {canceled && (
        <p className="mt-3 flex items-center justify-center gap-1.5 text-sm font-medium text-foreground-secondary">
          <Prohibit size={16} aria-hidden="true" />
          {COPY.status.canceled}
        </p>
      )}
      {disputed && (
        <p className="mt-3 flex items-center justify-center gap-1.5 text-sm font-medium text-warning-ink">
          <Warning size={16} weight="fill" aria-hidden="true" />
          {COPY.status.disputed}
        </p>
      )}
    </div>
  );
}
