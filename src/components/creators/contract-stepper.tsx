import { Prohibit, Warning } from "@phosphor-icons/react/dist/ssr";
import { Badge, type BadgeProps } from "@/components/ui";
import { cn } from "@/lib/utils";
import { CONTRACT_STEPS, contractStepIndex, type ContractStatus } from "./contract-machine";
import { STATUS_COPY, STEP_COPY } from "./flow-copy";

const STATUS_VARIANT: Record<ContractStatus, NonNullable<BadgeProps["variant"]>> = {
  proposed: "neutral",
  accepted: "info",
  signed: "info",
  funded: "brand",
  delivered: "brand",
  changes_requested: "warning",
  approved: "success",
  released: "success",
  canceled: "neutral",
  disputed: "warning",
  rejected: "danger",
};

export function ContractStatusBadge({ status, className }: { status: ContractStatus; className?: string }) {
  return (
    <Badge variant={STATUS_VARIANT[status] ?? "neutral"} className={className}>
      {STATUS_COPY[status] ?? status}
    </Badge>
  );
}

export function ContractStepper({ status }: { status: ContractStatus }) {
  const idx = contractStepIndex(status);
  const offRail = status === "canceled" || status === "rejected";
  const disputed = status === "disputed";
  const complete = status === "released";

  return (
    <div>
      <ol className="flex items-stretch gap-1.5" aria-label="Progreso de la colaboración">
        {CONTRACT_STEPS.map((step, i) => {
          const reached = !offRail && idx >= 0 && i <= idx;
          const current = !offRail && !disputed && !complete && i === idx;
          return (
            <li
              key={step}
              aria-current={current ? "step" : undefined}
              className="flex flex-1 flex-col items-center gap-1.5 text-center"
            >
              <span aria-hidden="true" className="relative h-1.5 w-full overflow-hidden rounded-full bg-border">
                <span
                  className={cn(
                    "absolute inset-0 origin-left rounded-full bg-[var(--accent-creadores)] transition-transform duration-700 ease-[cubic-bezier(0.32,0.72,0,1)]",
                    reached ? "scale-x-100" : "scale-x-0",
                  )}
                />
              </span>
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
                {STEP_COPY[step]}
              </span>
            </li>
          );
        })}
      </ol>

      {offRail && (
        <p
          className={cn(
            "mt-3 flex items-center justify-center gap-1.5 text-sm font-medium",
            status === "rejected" ? "text-danger-ink" : "text-foreground-secondary",
          )}
        >
          <Prohibit size={16} aria-hidden="true" />
          {STATUS_COPY[status]}
        </p>
      )}
      {disputed && (
        <p className="mt-3 flex items-center justify-center gap-1.5 text-sm font-medium text-warning-ink">
          <Warning size={16} weight="fill" aria-hidden="true" />
          {STATUS_COPY.disputed}
        </p>
      )}
    </div>
  );
}
